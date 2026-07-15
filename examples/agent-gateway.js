/**
 * Minimal HTTP gateway that requires a CEL receipt for each request.
 *
 * Demonstrates the AI-agent use case end to end:
 *
 *   1. The agent POSTs without a receipt and gets 402 + a challenge
 *      (depth, epoch, context including a server-issued nonce).
 *   2. The agent performs the work, producing a receipt bound to that
 *      challenge, and retries with the receipt in a header.
 *   3. The gateway verifies cheaply first (size, depth, context fields,
 *      issued-nonce check, replay cache), then runs the expensive chain
 *      recomputation.
 *   4. Nonces are server-issued and single-use: a self-minted nonce is
 *      rejected with 403, and a replayed receipt fails because its nonce
 *      was consumed on first use (verified roots are also cached as
 *      defense in depth).
 *
 * Run the server:
 *   node examples/agent-gateway.js
 *
 * In another terminal, act as the agent:
 *   node examples/agent-gateway.js --client "hello from an agent"
 *
 * Configuration via environment variables:
 *   CEL_GATEWAY_PORT, CEL_REQUIRED_DEPTH, CEL_MAX_DEPTH,
 *   CEL_WINDOW_SECONDS, CEL_AUDIENCE
 *
 * Production notes (see docs/threat-model.md):
 *   - keep MAX_DEPTH low: direct verification costs the server CPU
 *   - put ordinary rate limits and body-size limits in front of this
 *   - the nonce store and replay cache are in-process memory; multi-instance
 *     deployments need a shared TTL store (e.g. Redis)
 *   - receipts travel in an HTTP header here for simplicity; some proxies cap
 *     header sizes (~8 KB), so large-context deployments should move the
 *     receipt into the request body
 *   - browser-based agents would additionally need CORS headers; this example
 *     is Node-to-Node only
 *   - verifyReceipt() below runs synchronously and blocks Node's single
 *     event loop for its full duration (tens of ms at realistic depths) —
 *     every other connection on this process stalls until it returns. This
 *     example accepts that for clarity; a production gateway should run
 *     verification in a worker_threads pool (or a separate process) instead
 *     of calling it inline in the request handler.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  createReceipt,
  verifyReceipt,
  deriveEpoch,
  currentEpochs
} from "../src/cel.js";

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const v = Number(raw);
  if (!Number.isSafeInteger(v) || v < 1) {
    console.error(`error: ${name}=${raw} must be a positive integer`);
    process.exit(2);
  }
  return v;
}

const PORT = readPositiveIntEnv("CEL_GATEWAY_PORT", 8787);
const REQUIRED_DEPTH = readPositiveIntEnv("CEL_REQUIRED_DEPTH", 20000); // ~a few ms of client compute
const MAX_DEPTH = readPositiveIntEnv("CEL_MAX_DEPTH", 50000);           // hard verifier ceiling
const WINDOW_SECONDS = readPositiveIntEnv("CEL_WINDOW_SECONDS", 300);
const MAX_RECEIPT_BYTES = 8192;
const MAX_BODY_BYTES = 65536;

if (REQUIRED_DEPTH > MAX_DEPTH) {
  console.error(`error: CEL_REQUIRED_DEPTH (${REQUIRED_DEPTH}) must not exceed CEL_MAX_DEPTH (${MAX_DEPTH})`);
  process.exit(2);
}

const ACTION = "agent.message";
const RESOURCE = "/api/agent";
const METHOD = "POST";
const AUDIENCE = process.env.CEL_AUDIENCE || `localhost:${PORT}`;

/* ------------------------------------------------------------------ */
/* Issued-nonce store and replay cache                                 */
/*                                                                     */
/* The server records every nonce it issues and consumes it on first   */
/* successful verification, enforcing real challenge-response: clients */
/* cannot skip the 402 and mint their own nonces, and a verified       */
/* receipt cannot be replayed. The root cache is defense in depth.     */
/* Both stores are in-process memory with a TTL of two epoch windows;  */
/* multi-instance deployments need a shared store.                     */
/* ------------------------------------------------------------------ */

const TTL_MS = 2 * WINDOW_SECONDS * 1000;
const issuedNonces = new Map(); // nonce -> expiry timestamp (ms)
const seenRoots = new Map();    // root  -> expiry timestamp (ms)

function prune(map) {
  const now = Date.now();
  for (const [key, expiry] of map) {
    if (expiry <= now) map.delete(key);
  }
}

function issueNonce() {
  prune(issuedNonces);
  const nonce = randomUUID();
  issuedNonces.set(nonce, Date.now() + TTL_MS);
  return nonce;
}

/** Returns true (and consumes the nonce) only if the server issued it. */
function consumeNonce(nonce) {
  prune(issuedNonces);
  return issuedNonces.delete(nonce);
}

function isReplay(root) {
  prune(seenRoots);
  return seenRoots.has(root);
}

function markSeen(root) {
  seenRoots.set(root, Date.now() + TTL_MS);
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

function challenge() {
  return {
    depth: REQUIRED_DEPTH,
    epoch: deriveEpoch({ windowSeconds: WINDOW_SECONDS }),
    context: {
      action: ACTION,
      resource: RESOURCE,
      method: METHOD,
      audience: AUDIENCE,
      nonce: issueNonce()
    }
  };
}

function startServer() {
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== RESOURCE) {
      res.writeHead(404).end("not found\n");
      return;
    }

    const header = req.headers["x-cel-receipt"];
    if (typeof header !== "string") {
      res.writeHead(402, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "compute receipt required", challenge: challenge() }) + "\n");
      return;
    }

    /* Cheap rejections first — before any decoding or hashing. */

    if (header.length > MAX_RECEIPT_BYTES) {
      res.writeHead(413).end("receipt too large\n");
      return;
    }

    // Declared body size check before hashing; the streaming check below
    // still covers chunked requests that omit content-length.
    const declaredLength = Number(req.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      res.writeHead(413).end("body too large\n");
      return;
    }

    // Reject obviously non-base64 content early; Buffer.from is lenient and
    // would silently ignore invalid chars, producing a wrong parse result.
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(header)) {
      res.writeHead(400).end("malformed receipt\n");
      return;
    }

    let receipt;
    try {
      receipt = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    } catch {
      res.writeHead(400).end("malformed receipt\n");
      return;
    }

    // A receipt that openly declares insufficient depth is rejected before
    // the server spends any CPU recomputing its chain.
    if (typeof receipt?.depth !== "number" || receipt.depth < REQUIRED_DEPTH) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "insufficient depth" }) + "\n");
      return;
    }

    // Context field checks are string comparisons; do them before hashing.
    const ctx = receipt.context;
    if (ctx?.action !== ACTION || ctx?.resource !== RESOURCE || ctx?.method !== METHOD ||
        ctx?.audience !== AUDIENCE || typeof ctx?.nonce !== "string" || ctx.nonce.length > 128) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "context mismatch" }) + "\n");
      return;
    }

    // The nonce must be one this server issued (via a 402 challenge) and
    // not yet used. Checking membership here is cheap; it is consumed only
    // after the expensive verification succeeds.
    if (!issuedNonces.has(ctx.nonce)) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unknown or expired nonce; request a challenge" }) + "\n");
      return;
    }

    if (typeof receipt.root !== "string" || isReplay(receipt.root)) {
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "receipt already used" }) + "\n");
      return;
    }

    /* Expensive verification last. This call is synchronous and blocks the
     * event loop for its full duration — see the "Production notes" comment
     * at the top of this file. Offload to a worker thread in production. */

    const result = verifyReceipt(receipt, {
      maxDepth: MAX_DEPTH,
      allowedEpochs: currentEpochs({ windowSeconds: WINDOW_SECONDS })
    });

    if (!result.ok) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: result.error }) + "\n");
      return;
    }

    // The receipt is consumed here. If the body later fails size checks, the
    // receipt is still spent — by design: this is admission control, not a
    // transactional commit. Clients must re-challenge on a 413.
    consumeNonce(ctx.nonce);
    markSeen(receipt.root);

    let body = "";
    let receivedBytes = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      receivedBytes += chunk.length; // Buffer length = bytes, not UTF-16 units
      if (receivedBytes > MAX_BODY_BYTES) {
        rejected = true;
        // Respond before destroying so the client sees a 413, not ECONNRESET.
        res.writeHead(413, { connection: "close" }).end("body too large\n");
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (rejected) return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, echo: body, verifiedDepth: receipt.depth }) + "\n");
    });
  });

  server.listen(PORT, () => {
    console.log(`CEL agent gateway listening on http://localhost:${PORT}${RESOURCE}`);
    console.log(`required depth: ${REQUIRED_DEPTH}, epoch window: ${WINDOW_SECONDS}s`);
  });
}

/* ------------------------------------------------------------------ */
/* Client (agent side): automatic 402 challenge-retry loop             */
/* ------------------------------------------------------------------ */

async function runClient(message) {
  const url = `http://localhost:${PORT}${RESOURCE}`;

  // 1. Try without a receipt; expect a 402 challenge.
  let res = await fetch(url, { method: "POST", body: message });
  if (res.status !== 402) {
    console.log(res.status, await res.text());
    return;
  }
  const { challenge: ch } = await res.json();
  console.error(`402 challenge: depth=${ch.depth} epoch=${ch.epoch} nonce=${ch.context.nonce}`);

  // 2. Perform the work bound to the server's challenge.
  const receipt = createReceipt({ depth: ch.depth, epoch: ch.epoch, context: ch.context });
  console.error(`proved in ${receipt.elapsedMs} ms, retrying with receipt`);

  // 3. Retry with the receipt attached.
  const headers = {
    "x-cel-receipt": Buffer.from(JSON.stringify(receipt)).toString("base64"),
    "content-type": "text/plain"
  };
  res = await fetch(url, { method: "POST", headers, body: message });
  console.log(res.status, await res.text());

  // 4. Demonstrate single-use semantics: replaying the same receipt fails.
  res = await fetch(url, { method: "POST", headers, body: message });
  console.error(`replay attempt: ${res.status} ${(await res.text()).trim()}`);
}

const clientIndex = process.argv.indexOf("--client");
if (clientIndex !== -1) {
  runClient(process.argv[clientIndex + 1] ?? "hello");
} else {
  startServer();
}
