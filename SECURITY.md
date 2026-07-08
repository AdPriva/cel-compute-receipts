# Security Policy

CEL is experimental research software. This implementation is not audited and
should not be used as the sole protection for critical systems.

## Supported Versions

Only the latest commit on the `main` branch receives security updates. There
are no long-term support releases at this experimental stage.

## What Counts as a Vulnerability

For CEL, a security vulnerability is an implementation bug or protocol flaw that
allows an adversary to:

- produce a valid receipt without performing the required sequential work
- make verification accept a receipt for the wrong context, epoch, action, or
  policy
- bypass `maxDepth` enforcement
- force a verifier to spend substantially more CPU than the declared receipt
  depth
- exploit malformed receipt input to crash or hang a verifier
- break the intended constant-time comparison of receipt roots

Security-sensitive areas include hash selection, canonical encoding, context
binding, epoch handling, receipt parsing, depth validation, and verification
logic.

## Out of Scope

The following are known limitations or deployment concerns rather than
vulnerabilities in this reference implementation:

- hardware performance differences between phones, laptops, servers, GPUs, or
  specialized hardware
- using CEL as a complete CAPTCHA, identity, fraud, reputation, or trust system
- replay caused by deployments that do not bind receipts to an action, resource,
  audience, and short epoch or challenge
- verifier CPU exposure caused by deployments that do not enforce `maxDepth` or
  cheap request prefilters
- social engineering, phishing, or compromise of downstream services that use
  CEL

If you are unsure whether something is in scope, please report it privately and
we will triage it.

## Reporting a Vulnerability

Please do not open a public GitHub issue for security-sensitive reports.

Preferred reporting channels:

1. Use GitHub private vulnerability reporting if it is enabled for this
   repository.
2. If private reporting is unavailable, email the maintainer at
   `cem@adpriva.com`.

Please include:

- a short description of the issue
- affected version or commit
- steps to reproduce
- expected behavior and actual behavior
- proof-of-concept code or receipt data, if available
- any suggested mitigation

Do not include secrets, private keys, access tokens, or third-party personal
data in the report.

## Response Timeline

We aim to:

- acknowledge receipt within 48 hours
- provide an initial assessment within 7 days
- coordinate a disclosure timeline with the reporter
- credit reporters in release notes unless anonymity is requested

There is no paid bug bounty program at this time.

## Deployment Safeguards

Direct verification is intentionally simple, but it can make verifiers spend as
much CPU as provers. Even with valid receipts, production deployments should
enforce:

- strict maximum depths through `maxDepth`
- short epoch windows
- context binding for action, resource, method, and audience
- request size limits
- cheap rejection before expensive verification
- ordinary rate limits around CEL verification
- logging and alerting for verification latency and rejection spikes

See [docs/threat-model.md](./docs/threat-model.md) for a detailed discussion of
deployment risks and mitigations.
