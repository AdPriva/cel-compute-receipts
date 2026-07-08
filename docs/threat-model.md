# Threat Model

CEL is useful when the defender wants to make an action cost computation.

It is not useful when the defender must prove that a caller is a human, a unique
person, authorized, reputable, or economically fair.

## Good Fits

- anonymous API throttling
- low-value form submission throttling
- public queue admission
- AI agent request admission
- decentralized message spam resistance
- disposable-identity environments

## Weak Fits

- account takeover prevention
- payment fraud prevention
- high-value signups by itself
- legal identity checks
- human-only access gates
- adversaries with much better hardware than honest users

## Adversary Profiles

Use these profiles to calibrate policy. Depth values are illustrative; benchmark
on your own devices before deploying.

- Casual spammer: runs basic scripts on consumer hardware. Small depths may be
  enough to make low-value spam unattractive.
- Dedicated attacker: uses cloud machines, GPUs, rented proxies, or botnets.
  Larger depths and short epochs may be needed, and CEL should sit behind
  ordinary rate limits.
- Well-funded adversary: uses specialized hardware or large-scale parallel
  infrastructure. CEL raises marginal cost but will not stop this actor by
  itself; combine it with reputation, accounts, payment, quotas, or review.

## Main Risks

### Verifier CPU Amplification

In direct verification mode, the server spends CPU proportional to the receipt
depth. Always set a low `maxDepth`, reject malformed requests cheaply, and keep
ordinary rate limits in front of CEL verification.

### Hardware Asymmetry

Fast desktops, GPUs, or specialized hardware may produce receipts faster than
phones or low-power devices. CEL increases marginal cost, but it does not make
cost equal for everyone. Test the chosen depth on the slowest hardware your
legitimate users are likely to use.

For example, if honest users are on low-power phones or small edge devices while
attackers use cloud servers, CEL may feel unfair unless depths are conservative
or alternative paths exist.

### Receipt Reuse and Precomputation

Receipts are reusable unless the context and epoch prevent reuse. Bind receipts
to an action, resource, method, audience, and short epoch where possible.

Attackers can also generate receipts in advance for known future epochs or
known contexts, then spend them later. Short epoch windows, server-issued
nonces, or challenge-response flows reduce this risk.

### Storage and Network Amplification

Large receipts or `context` objects can exhaust bandwidth, memory, or parser
time before hash verification begins. Enforce strict request size limits at the
edge, such as 10-50 KB for simple API actions, and reject oversized receipts
before parsing whenever possible.

### Epoch Drift and Expiration

Clients and servers may disagree about the active epoch because of clock skew,
delays, or stale cached challenges. Accepting too many old epochs increases
replay risk.

For time-window epochs, prefer accepting only the current and immediately
previous window. For nonce-based epochs, reject each nonce after use or after a
short expiration.

### Overclaiming

CEL should be described as a compute-pricing primitive. Calling it a complete
CAPTCHA replacement will invite the wrong security review.

## Production Checklist

- set a strict `maxDepth`
- accept at most the current and immediately previous time-window epoch
- use server-issued nonces for higher-risk actions
- bind context to the exact action, resource, method, and audience
- reject oversized receipts before verification
- enforce request size limits at the edge
- log verification latency
- monitor verification failure rates and alert on spikes
- test on mobile and low-power devices
- test chosen depths against your slowest legitimate client profile
- combine with reputation, account limits, quotas, or payment where appropriate
