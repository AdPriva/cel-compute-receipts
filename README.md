# Computational Effort Layer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-339933.svg)](https://nodejs.org/)
[![Status: experimental](https://img.shields.io/badge/status-experimental-orange.svg)](#status)

Computational Effort Layer, or CEL, is a lightweight reference implementation
for compute receipts: work-bound artifacts that show a client spent a defined
amount of sequential computation for a specific action.

CEL is meant for systems that want to price actions with local computation:
public API calls, anonymous form submissions, decentralized messages, agent
requests, queue admission, and other places where identity is weak or
undesirable.

Read the full paper: [Verifiable Inevitability of Computation](./docs/CEL-paper.pdf).

## Status

This repository is experimental research code. It is not audited, it is not a
drop-in CAPTCHA replacement, and it should not be used as the only defense for
high-value abuse surfaces.

The v0 implementation supports direct verification, which means the verifier
recomputes the same chain as the prover. That is simple and transparent, but it
also means high difficulty values can be expensive for servers. Use strict
maximum depths and cheap request prefilters.

## What CEL Proves

CEL proves that a receipt is bound to:

- a policy, including the required sequential depth
- an epoch, such as a short validity window or challenge scope
- an application context, such as an action or resource
- a final assembly root derived from a hash chain

CEL does not prove that the caller is human, honest, unique, authorized, or
well-intentioned. It only proves that a specific amount of work was performed
for a specific context.

## Could This Replace CAPTCHA?

For some flows, yes. If the job of the CAPTCHA is really "make spam more
expensive," CEL can be a cleaner and more privacy-preserving primitive.

For flows that need human detection, fraud classification, reputation, or risk
scoring, CEL should be treated as a supporting control rather than a full
replacement.

| Mechanism | Main Question Answered | Tradeoff |
| --- | --- | --- |
| CAPTCHA | Does this look like a human? | Accessibility, privacy, and user friction |
| Proof of work | Did the client win a probabilistic puzzle? | Variable cost and lucky wins |
| VDF | Did a sequential delay likely elapse? | Specialized assumptions and constructions |
| CEL | Was work performed for this action context? | Direct verification is linear in depth |

## Installation

From a local checkout:

```bash
npm install
npm test
```

After publishing this package to npm:

```bash
npm install cel-compute-receipts
```

Use the package API:

```js
import { createReceipt, verifyReceipt } from "cel-compute-receipts";

const receipt = createReceipt({
  depth: 10000,
  epoch: "cel:300:5941344",
  context: {
    action: "agent.message",
    resource: "/api/agent",
    method: "POST"
  }
});

const result = verifyReceipt(receipt, { maxDepth: 10000 });
console.log(result.ok);
```

For local development before npm publication, import from `./src/cel.js`.

## Quick Start

Create a receipt locally:

```bash
node ./src/cli.js prove \
  --depth 10000 \
  --epoch demo-2026-07-08 \
  --context '{"action":"comment.create","resource":"/posts/123"}' \
  --output receipt.json
```

Verify the receipt:

```bash
node ./src/cli.js verify --receipt receipt.json --max-depth 10000
```

When installed as a package, the CLI binary is `cel`:

```bash
cel prove --depth 10000 --epoch demo --context '{"action":"agent.message"}'
cel verify --receipt receipt.json --max-depth 10000
```

## CLI

```bash
node ./src/cli.js epoch --window-seconds 300
node ./src/cli.js challenge --depth 10000 --action agent.message --resource /api/agent
node ./src/cli.js prove --depth 10000 --epoch cel:300:5941344 --context '{"action":"agent.message"}'
node ./src/cli.js verify --receipt receipt.json --max-depth 10000
node ./src/cli.js bench --depth 100000
```

## Epochs and Max Depth

An epoch scopes a receipt to a bounded validity window or challenge. It can be a
time window, block height, server-issued nonce, release identifier, or any other
application-defined string.

The helper `deriveEpoch()` produces strings like:

```text
cel:300:5941344
```

That means "CEL epoch using 300-second windows, window number 5941344."

Verifiers should always pass `maxDepth` to `verifyReceipt()`. This prevents a
malicious receipt from forcing the server to recompute an unexpectedly large
chain.

## Receipt Format

A CEL receipt is plain JSON:

```json
{
  "version": "cel/v0",
  "algorithm": "sha256",
  "depth": 10000,
  "epoch": "cel:300:5941344",
  "context": {
    "action": "agent.message",
    "resource": "/api/agent",
    "method": "POST"
  },
  "root": "base64url-encoded-root",
  "elapsedMs": 30.5
}
```

The `context` should include enough application data to prevent reuse across
unrelated actions.

## AI Agent Use Case

An agent can attach a CEL receipt to each outbound request. A receiving service
can require receipts for anonymous or low-trust actions, making mass automation
more expensive without requiring a human challenge.

See [examples/agent-gateway.js](./examples/agent-gateway.js) for a minimal HTTP
gateway.

## Security Considerations

- CEL is a compute-pricing primitive, not an identity or trust primitive.
- Direct verification costs the verifier about as much CPU as the prover.
- Verifiers must enforce maximum depth before recomputing a receipt.
- Receipts should be bound to action, resource, method, audience, and epoch.
- Short epochs or server-issued challenges help reduce replay.
- Browser support is not implemented yet; this version uses Node.js `crypto`.

See [SECURITY.md](./SECURITY.md) and [docs/threat-model.md](./docs/threat-model.md)
for more deployment guidance.

## Performance

The current Node.js reference implementation scales linearly with `depth`.
These are single-run local measurements from the development machine and should
be treated as rough guidance, not a portable benchmark.

| Depth | Create Receipt | Direct Verify |
| ---: | ---: | ---: |
| 10,000 | ~32 ms | ~22 ms |
| 100,000 | ~215 ms | ~216 ms |
| 1,000,000 | ~2,160 ms | ~2,200 ms |

Run your own benchmark:

```bash
npm run bench
```

## Repository Layout

- [src/cel.js](./src/cel.js) - core CEL implementation
- [src/cli.js](./src/cli.js) - command-line tool
- [test/cel.test.js](./test/cel.test.js) - unit tests
- [docs/CEL-paper.pdf](./docs/CEL-paper.pdf) - full paper
- [docs/protocol.md](./docs/protocol.md) - protocol notes
- [docs/threat-model.md](./docs/threat-model.md) - deployment risks and limits
- [docs/research-review.md](./docs/research-review.md) - positioning and critique
- [docs/github-launch.md](./docs/github-launch.md) - launch checklist
- [examples/agent-gateway.js](./examples/agent-gateway.js) - HTTP example

## Development

Requirements:

- Node.js 18 or newer
- npm

Commands:

```bash
npm install
npm test
npm run bench
```

There are no runtime dependencies. `npm test` currently runs the Node.js unit
test suite. This repository does not yet enforce a separate linter, formatter,
or type checker.

## Roadmap

Near-term:

- Browser/WebCrypto implementation
- adaptive difficulty policy examples
- replay-resistant challenge examples
- benchmark table across phones, laptops, and servers

Longer-term:

- WASM/Rust implementation for higher throughput
- receipt batching and aggregation experiments
- succinct verification research prototype
- memory-hard variant to reduce hardware advantage

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
