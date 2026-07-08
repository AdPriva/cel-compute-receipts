# Contributing to CEL

Thanks for helping improve CEL. Contributions are welcome across code,
documentation, examples, benchmarks, and research notes.

CEL is security-adjacent research software, so the most valuable contributions
are clear, scoped, tested, and careful about claims.

## Quick Start

Requirements:

- Node.js 18 or newer
- npm

Set up the project:

```bash
npm install
npm test
```

`npm test` currently runs the Node.js unit test suite. This project does not
yet enforce a separate linter, formatter, or type checker.

## Good First Contributions

- Add deployment examples
- Benchmark CEL on different devices
- Improve browser support
- Document threat models
- Implement alternative policy modules
- Add replay-resistant challenge examples
- Compare CEL with Hashcash, client puzzles, and VDFs

## Scope Reminder

Please keep claims precise. CEL proves compute expenditure for a context. It
does not prove identity, humanity, intent, authorization, reputation, or
trustworthiness.

Pull requests that present CEL as a complete CAPTCHA replacement, fraud system,
identity layer, or trust layer should be rewritten before review.

## Reporting Issues

Before opening an issue, please check whether a similar issue already exists.

For bugs, include:

- Node.js version from `node -v`
- operating system and CPU architecture
- steps to reproduce the problem
- expected behavior
- actual behavior
- a minimal code snippet or receipt when possible

For research or protocol concerns, include the assumption or claim you think is
affected, plus any relevant references.

## Pull Requests

1. Open an issue first for new features, protocol changes, public API changes,
   or security-sensitive work.
2. Target the `main` branch.
3. Keep the change focused.
4. Add or update tests for behavior changes.
5. Update README, examples, or docs when public behavior changes.
6. Run `npm test` before submitting.
7. Use clear commit messages. Conventional Commits are welcome, for example
   `feat: add browser receipt generation` or `fix: reject stale epochs`.

If your change affects performance, include before-and-after benchmark results
in the pull request description. At minimum, include the command used, hardware,
Node.js version, depth, and timings.

## Security-Sensitive Changes

Security-sensitive changes include, but are not limited to:

- changing hash algorithms or encoding rules
- changing receipt verification logic
- changing epoch or context binding behavior
- changing maximum-depth handling
- adding challenge-response or replay-prevention logic
- adding alternative policy modules
- modifying constant-time comparison behavior

These changes should include tests and a short security note in the pull request
description explaining:

- what assumption or invariant changed
- why the change is needed
- what new failure modes were considered

If you believe you found a vulnerability, follow [SECURITY.md](./SECURITY.md)
instead of opening a public issue.

## Benchmarks

Performance is part of CEL's security and usability story. Benchmarks should be
reported with enough detail to reproduce them:

- device and CPU
- operating system
- Node.js version
- CEL depth
- command or script used
- average, minimum, and maximum timings when available

Use the existing benchmark helper as a starting point:

```bash
npm run bench
```

## Code Style

The current codebase is dependency-free JavaScript. Please match the existing
style:

- use modern ES modules
- keep public APIs small and explicit
- validate inputs at module boundaries
- prefer readable names over clever shortcuts
- avoid adding dependencies unless they clearly pay for themselves

If you add formatting, linting, or type-checking tooling, update this file and
`package.json` in the same pull request.

## Documentation

Documentation changes are first-class contributions. Please update docs when a
change affects:

- public API behavior
- receipt format
- security assumptions
- deployment guidance
- examples
- benchmark expectations

Avoid overclaiming. The project should describe CEL as a compute-receipt or
compute-pricing primitive, not as a full abuse-prevention system by itself.

## Getting Help

Use GitHub Issues for bugs and concrete proposals. Use GitHub Discussions for
open-ended questions once discussions are enabled for the repository.

## Code of Conduct

Please be respectful, precise, and constructive. Until this repository has a
dedicated `CODE_OF_CONDUCT.md`, contributors are expected to follow the spirit
of the [Contributor Covenant](https://www.contributor-covenant.org/).
