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
- replay caused by deployments that do not stop it at the deployment layer. CEL
  binds a receipt to its context, but context binding only prevents *cross-context*
  reuse; it does not stop replay of an *identical* request. Preventing that is
  the deployment's responsibility via a server-issued per-request challenge nonce
  or a seen-root cache scoped to the epoch (see Deployment Safeguards).
- precomputation caused by deployments that use fixed time-window epochs with no
  per-request challenge. An attacker can compute valid receipts for an upcoming
  window offline and spend them in a burst; preventing this is a deployment
  choice (server-issued challenge epochs), not an implementation bug.
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
- short epoch windows, and server-issued challenge epochs rather than pure time
  windows wherever burst-precomputation matters
- context binding for action, resource, method, audience, and a hash of the
  request payload, so a receipt cannot be reused across different requests that
  share the same action or resource
- a replay defense: a server-issued per-request challenge nonce, or a seen-root
  cache scoped to the epoch. Context binding alone does not stop replay of an
  identical request
- request size limits
- cheap rejection before expensive verification
- ordinary rate limits around CEL verification
- logging and alerting for verification latency and rejection spikes

See [docs/threat-model.md](./docs/threat-model.md) for a detailed discussion of
deployment risks and mitigations.
