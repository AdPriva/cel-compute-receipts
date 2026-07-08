# Computational Effort Layer

Computational Effort Layer, or CEL, is a tiny reference implementation for
compute receipts: work-bound artifacts that show a client spent a defined
amount of sequential computation for a specific action.

CEL is meant for systems that want to price actions with local computation:
public API calls, anonymous form submissions, decentralized messages, agent
requests, queue admission, and other places where identity is weak or
undesirable.

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
- an epoch, such as a short validity window
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

## Quick Start

Create a receipt:

```bash
node ./src/cli.js prove \
  --depth 10000 \
  --epoch demo-2026-07-06 \
  --context '{"action":"comment.create","resource":"/posts/123"}'
```

Verify a receipt:

```bash
node ./src/cli.js prove --depth 10000 --epoch demo --context hello > receipt.json
node ./src/cli.js verify --receipt receipt.json --max-depth 10000
```

Use it from code:

```js
import { createReceipt, verifyReceipt } from "./src/cel.js";

const receipt = createReceipt({
  depth: 10000,
  epoch: "demo",
  context: {
    action: "agent.message",
    resource: "/api/agent"
  }
});

const result = verifyReceipt(receipt, { maxDepth: 10000 });
console.log(result.ok);
```

## CLI

```bash
node ./src/cli.js epoch --window-seconds 300
node ./src/cli.js challenge --depth 10000 --action agent.message --resource /api/agent
node ./src/cli.js prove --depth 10000 --epoch cel:300:5941344 --context '{"action":"agent.message"}'
node ./src/cli.js verify --receipt receipt.json --max-depth 10000
node ./src/cli.js bench --depth 100000
```

## Benchmarks

Single core, Node.js 22 (x86-64 container). Run `npm run bench` on your own
hardware; mobile and low-power numbers are welcome contributions.

| Depth   | Prove time | Throughput      |
| ------- | ---------- | --------------- |
| 1,000   | ~8 ms      | ~120k steps/s   |
| 10,000  | ~26 ms     | ~380k steps/s   |
| 100,000 | ~212 ms    | ~470k steps/s   |

In direct verification mode, verifying costs roughly the same as proving.
Choose depths accordingly.

## How CEL Compares

| Mechanism      | Cost model              | Needs clock | Needs identity | Verify cost      | Proves human |
| -------------- | ----------------------- | ----------- | -------------- | ---------------- | ------------ |
| Hashcash / PoW | probabilistic search    | no          | no             | O(1)             | no           |
| Client puzzles | interactive challenge   | server-side | no             | O(1)             | no           |
| VDF            | sequential (time-bound) | assumption  | no             | O(1) w/ proof    | no           |
| CAPTCHA        | human attention         | no          | no             | service call     | approximately|
| CEL v0         | deterministic sequential| no          | no             | O(depth)         | no           |

CEL trades verification efficiency for determinism and simplicity: cost is
exact rather than sampled from a distribution, and receipts are self-contained
artifacts bound to an action. Succinct verification (O(1) verify) is on the
roadmap and is what would make CEL viable on public unauthenticated hot paths.

Related projects worth knowing: Hashcash, mCaptcha, Friendly Captcha, Anubis,
and Privacy Pass. CEL is not affiliated with Google's Common Expression
Language, which shares the acronym.

## AI Agent Use Case

An agent can attach a CEL receipt to each outbound request. A receiving service
can require receipts for anonymous or low-trust actions, making mass automation
more expensive without requiring a human challenge.

See [examples/agent-gateway.js](./examples/agent-gateway.js) for a minimal HTTP
gateway.

## Repository Layout

- [src/cel.js](./src/cel.js) - core CEL implementation
- [src/cli.js](./src/cli.js) - command-line tool
- [test/cel.test.js](./test/cel.test.js) - unit tests
- [docs/protocol.md](./docs/protocol.md) - protocol notes
- [docs/threat-model.md](./docs/threat-model.md) - deployment risks and limits
- [docs/research-review.md](./docs/research-review.md) - positioning and critique
- [docs/github-launch.md](./docs/github-launch.md) - launch checklist
- [examples/agent-gateway.js](./examples/agent-gateway.js) - HTTP example

## Development

```bash
npm test
```

There are no runtime dependencies.

## Roadmap

- Browser/WebCrypto implementation
- WASM/Rust implementation for higher throughput
- adaptive difficulty policy examples
- receipt batching and aggregation experiments
- succinct verification research prototype
- memory-hard variant to reduce hardware advantage

## License

MIT
