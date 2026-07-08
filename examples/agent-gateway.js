/**
 * Minimal HTTP gateway that requires a CEL receipt for each request.
 *
 * Demonstrates the AI-agent use case: an agent attaches a compute receipt to
 * each outbound request; the gateway admits requests whose receipts verify
 * against the expected action, resource, and current epoch window.
 *
 * Run the server:
 *   node examples/agent-gateway.js
 *
 * In another terminal, act as the agent:
 *   node examples/agent-gateway.js --client "hello from an agent"
 *
 * Production notes (see docs/threat-model.md):
 *   - keep MAX_DEPTH low: direct verification costs the server CPU
 *   - put ordinary rate limits and body-size limits in front of this
 *   - receipts here are bound to action + resource + epoch; add a nonce or
 *     request hash to the context for strict single-use semantics
 *   - receipts travel in an HTTP header here for simplicity; some proxies cap
 *     header sizes (~8 KB), so large-context deployments should move the
 *     receipt into the request body
 *   - browser-based agents would additionally need CORS headers; this example
 *     is Node-to-Node only
 */

import { createServer } from "node:http";
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

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

function startServer() {
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/api/agent") {
      res.writeHead(404).end("not found\n");
      return;
    }

    const header = req.headers["x-cel-receipt"];
    if (typeof header !== "string") {
      res.writeHead(402, { "content-type": "application/json" });
      res.end(JSON.stringify({
        error: "compute receipt required",
        challenge: {
          depth: REQUIRED_DEPTH,
          epoch: deriveEpoch({ windowSeconds: WINDOW_SECONDS }),
          context: { action: "agent.message", resource: "/api/agent" }
        }
      }) + "\n");
      return;
    }

    // Cheap rejections first — before any hashing.
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

    const result = verifyReceipt(receipt, {
      maxDepth: MAX_DEPTH,
      allowedEpochs: currentEpochs({ windowSeconds: WINDOW_SECONDS }),
      requiredContext: { action: "agent.message", resource: "/api/agent" }
    });

    if (!result.ok || receipt.depth < REQUIRED_DEPTH) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: result.error ?? "insufficient depth" }) + "\n");
      return;
    }

    let body = "";
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        rejected = true;
        // Respond before destroying so the client sees a 413, not ECONNRESET.
        res.writeHead(413, { connection: "close" }).end("body too large\n");
        req.destroy();
      }
    });
    req.on("end", () => {
      if (rejected) return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, echo: body, verifiedDepth: receipt.depth }) + "\n");
    });
  });

  server.listen(PORT, () => {
    console.log(`CEL agent gateway listening on http://localhost:${PORT}/api/agent`);
    console.log(`required depth: ${REQUIRED_DEPTH}, epoch window: ${WINDOW_SECONDS}s`);
  });
}

/* ------------------------------------------------------------------ */
/* Client (agent side)                                                 */
/* ------------------------------------------------------------------ */

async function runClient(message) {
  const receipt = createReceipt({
    depth: REQUIRED_DEPTH,
    epoch: deriveEpoch({ windowSeconds: WINDOW_SECONDS }),
    context: { action: "agent.message", resource: "/api/agent" }
  });

  const res = await fetch(`http://localhost:${PORT}/api/agent`, {
    method: "POST",
    headers: {
      "x-cel-receipt": Buffer.from(JSON.stringify(receipt)).toString("base64"),
      "content-type": "text/plain"
    },
    body: message
  });

  console.log(res.status, await res.text());
}

const clientIndex = process.argv.indexOf("--client");
if (clientIndex !== -1) {
  runClient(process.argv[clientIndex + 1] ?? "hello");
} else {
  startServer();
}
