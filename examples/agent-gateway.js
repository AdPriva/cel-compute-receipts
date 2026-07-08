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
 *      replay cache), then runs the expensive chain recomputation.
 *   4. A replayed receipt is rejected with 409: the nonce makes every
 *      receipt unique, and verified roots are cached for two epoch windows.
 *
 * Run the server:
 *   node examples/agent-gateway.js
 *
 * In another terminal, act as the agent:
 *   node examples/agent-gateway.js --client "hello from an agent"
 *
 * Configuration via environment variables:
 *   CEL_GATEWAY_PORT, CEL_REQUIRED_DEPTH, CEL_MAX_DEPTH, CEL_WINDOW_SECONDS
 *
 * Production notes (see docs/threat-model.md):
 *   - keep MAX_DEPTH low: direct verification costs the server CPU
 *   - put ordinary rate limits and body-size limits in front of this
 *   - the replay cache here is in-process memory; multi-instance deployments
 *     need a shared TTL store (e.g. Redis) or a Bloom filter per window
 *   - a stricter deployment would also track which nonces it actually issued
 *   - receipts travel in an HTTP header here for simplicity; some proxies cap
 *     header sizes (~8 KB), so large-context deployments should move the
 *     receipt into the request body
 *   - browser-based agents would additionally need CORS headers; this example
 *     is Node-to-Node only
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  createReceipt,
  verifyReceipt,
  deriveEpoch,
  currentEpochs
} from "../src/cel.js";

const PORT = Number(process.env.CEL_GATEWAY_PORT) || 8787;
const REQUIRED_DEPTH = Number(process.env.CEL_REQUIRED_DEPTH) || 20000; // ~a few ms of client compute
const MAX_DEPTH = Number(process.env.CEL_MAX_DEPTH) || 50000;           // hard verifier ceiling
const WINDOW_SECONDS = Number(process.env.CEL_WINDOW_SECONDS) || 300;
const MAX_RECEIPT_BYTES = 8192;
const MAX_BODY_BYTES = 65536;

const ACTION = "agent.message";
const RESOURCE = "/api/agent";

/* ------------------------------------------------------------------ */
/* Replay cache                                                        */
/*                                                                     */
/* Receipts are deterministic, so the challenge nonce makes each one   */
/* unique; caching verified roots for two epoch windows then gives     */
/* strict single-use semantics without a database.                     */
/* ------------------------------------------------------------------ */

const seenRoots = new Map(); // root -> expiry timestamp (ms)

function isReplay(root) {
  pruneSeenRoots();
  return seenRoots.has(root);
}

function markSeen(root) {
  seenRoots.set(root, Date.now() + 2 * WINDOW_SECONDS * 1000);
}

function pruneSeenRoots() {
  const now = Date.now();
  for (const [root, expiry] of seenRoots) {
    if (expiry <= now) seenRoots.delete(root);
  }
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

function challenge() {
  return {
    depth: REQUIRED_DEPTH,
    epoch: deriveEpoch({ windowSeconds: WINDOW_SECONDS }),
    context: { action: ACTION, resource: RESOURCE, nonce: randomUUID() }
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
    // The nonce must be present so every receipt is unique. A stricter
    // deployment would also check the nonce against a store of issued ones.
    const ctx = receipt.context;
    if (ctx?.action !== ACTION || ctx?.resource !== RESOURCE || typeof ctx?.nonce !== "string" || ctx.nonce.length > 128) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "context mismatch" }) + "\n");
      return;
    }

    if (typeof receipt.root !== "string" || isReplay(receipt.root)) {
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "receipt already used" }) + "\n");
      return;
    }

    /* Expensive verification last. */

    const result = verifyReceipt(receipt, {
      maxDepth: MAX_DEPTH,
      allowedEpochs: currentEpochs({ windowSeconds: WINDOW_SECONDS })
    });

    if (!result.ok) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: result.error }) + "\n");
      return;
    }

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
