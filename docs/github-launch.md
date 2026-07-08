# GitHub Launch Checklist

This document is the operational runbook for launching CEL as a public
open-source project. The goal is to make the first public version credible,
easy to evaluate, and honest about its experimental status.

## Repository Metadata

Recommended repository name:

```text
computational-effort-layer
```

Other good options:

- `cel-compute-receipts`
- `compute-receipts`
- `cel-protocol`

Suggested GitHub description:

```text
Compute receipts for pricing digital actions without identity or behavioral classification.
```

Suggested topics:

- `proof-of-work`
- `client-puzzles`
- `anti-abuse`
- `rate-limiting`
- `ai-agents`
- `captcha-alternative`
- `distributed-systems`
- `cryptography`

## Launch Execution Checklist

### Before Pressing Publish

- [ ] Back up the paper PDF and source repository.
- [ ] Push the repository to GitHub.
- [ ] Confirm `LICENSE` exists in the repository root.
- [ ] Confirm `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, and
  `docs/threat-model.md` are present.
- [ ] Link the paper PDF prominently from the README.
- [ ] Enable GitHub Discussions for community questions.
- [ ] Enable private vulnerability reporting in the repository security
  settings.
- [ ] Create branch protection rules for `main`.
- [ ] Require pull requests before merging to `main`.
- [ ] Require passing checks before merging to `main`.
- [ ] Prefer linear history on `main`.
- [ ] Add a GitHub Actions workflow that runs `npm test` on push and pull
  request.
- [ ] Add a CI badge to the README after the workflow is live.
- [ ] Create issue templates for bug reports, feature requests, and research
  questions.
- [ ] Create a pull request template that reminds contributors to run tests and
  update docs.

### Package Publishing

- [ ] Decide whether the npm package should be `cel-compute-receipts` or a
  scoped package such as `@adpriva/cel`.
- [ ] Check that the package name is available on npm.
- [ ] Confirm `package.json` has correct `name`, `version`, `main`, `bin`,
  `license`, `keywords`, and `engines`.
- [ ] Add a `files` field to `package.json` before publishing, if needed, to
  keep the package contents intentional.
- [ ] Run `npm test`.
- [ ] Run `npm pack --dry-run` and inspect the included files.
- [ ] Publish with `npm publish`, or `npm publish --access public` for a scoped
  public package.
- [ ] Update the README install command if the final package name changes.

### Launch Day

- [ ] Tag the first release as `v0.1.0`.
- [ ] Create a GitHub release from the tag.
- [ ] Include the release notes below.
- [ ] Publish the npm package, if applicable.
- [ ] Confirm the README renders correctly on GitHub.
- [ ] Confirm the paper PDF link works on GitHub.
- [ ] Confirm `npm test` passes in GitHub Actions.
- [ ] Post a launch announcement.
- [ ] Submit to selected communities only where the project is relevant.

### Week One

- [ ] Monitor issues and discussions daily.
- [ ] Triage security reports quickly and privately.
- [ ] Respond to first-time contributors quickly.
- [ ] Label issues as `good first issue`, `help wanted`, `research`, `security`,
  or `documentation`.
- [ ] Watch for repeated confusion and adjust README wording.
- [ ] Record common questions for an FAQ or follow-up blog post.

## First Release

Tag the first release as:

```text
v0.1.0
```

Release title:

```text
CEL v0.1.0: Initial compute receipt reference implementation
```

Release notes:

```text
Initial experimental release of CEL.

- dependency-free Node.js reference implementation
- command-line receipt generation and verification
- direct verification mode
- HTTP agent-gateway example
- protocol notes, threat model, and security policy
- full paper included under docs/
```

## Announcement Copy

Short version:

```text
CEL is an experimental compute receipt protocol for pricing digital actions
without identity, clocks, or behavioral classification.
```

Longer version:

```text
I am open-sourcing CEL, the Computational Effort Layer: a small reference
implementation of compute receipts for abuse-resistant APIs, agent requests,
forms, and decentralized messaging.

CEL does not prove humanity or identity. It proves that a specific amount of
sequential work was performed for a specific action context.
```

Good places to share:

- personal site or blog
- Hacker News
- relevant cryptography or distributed systems forums
- AI agent developer communities
- security engineering communities

Avoid describing CEL as a complete CAPTCHA replacement. Use "CAPTCHA
alternative for cost-based throttling" only when the distinction is clear.

## Good First Issues

Low-barrier issues:

- Add mobile and low-power device benchmark results.
- Add a browser/WebCrypto receipt generation example.
- Add a comparison document for Hashcash, client puzzles, VDFs, and CEL.
- Add more deployment examples.
- Add an FAQ from launch feedback.

Help wanted:

- Add adaptive difficulty policy examples.
- Add replay-resistant challenge-response examples.
- Add Cloudflare Workers or edge gateway examples.
- Add TypeScript declarations.

Advanced projects:

- Add a Rust implementation.
- Add a WASM build.
- Explore receipt batching or aggregation.
- Prototype succinct verification.
- Explore memory-hard policy variants.

## Suggested Issue Labels

- `good first issue`
- `help wanted`
- `bug`
- `documentation`
- `research`
- `protocol`
- `security`
- `performance`
- `browser`
- `agent-use-case`

## GitHub Settings Checklist

- [ ] Discussions enabled.
- [ ] Private vulnerability reporting enabled.
- [ ] Issues enabled.
- [ ] Wiki disabled unless there is a clear reason to use it.
- [ ] Branch protection enabled for `main`.
- [ ] Default branch set to `main`.
- [ ] Delete head branches after pull requests are merged.
- [ ] Require status checks once CI is configured.

## Pre-Publish Sanity Commands

Run these locally before tagging:

```bash
npm test
npm run bench
npm pack --dry-run
git status --short
```

The final `git status --short` should be empty before tagging the release.
