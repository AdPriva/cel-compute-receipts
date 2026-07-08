# GitHub Launch Checklist

## Recommended Repository Name

`computational-effort-layer`

Other good options:

- `compute-receipts` (best for discoverability)
- `cel-compute-receipts`

Note: the acronym CEL collides with Google's Common Expression Language, a
large established project. Prefer names that include `compute` or `receipts`,
and say "not affiliated with Google's CEL" in the README.

## Suggested Description

Compute receipts for pricing digital actions without identity or behavioral
classification.

## Topics

- proof-of-work
- client-puzzles
- anti-abuse
- rate-limiting
- ai-agents
- captcha-alternative
- distributed-systems

## First Release

Tag the first release as `v0.1.0`.

Release notes:

```text
Initial experimental release of CEL.

- dependency-free Node.js reference implementation
- command-line receipt generation and verification
- direct verification mode
- HTTP agent-gateway example
- protocol notes and threat model
```

## Good First Issues

- Add browser/WebCrypto receipt generation
- Add Rust/WASM implementation
- Add mobile benchmark table
- Add adaptive difficulty policy
- Add replay-resistant challenge examples
- Compare CEL with Hashcash and client puzzles
