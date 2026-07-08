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

## Main Risks

### Verifier CPU amplification

In direct verification mode, the server spends CPU proportional to the receipt
depth. Always set a low `maxDepth`, reject malformed requests cheaply, and keep
ordinary rate limits in front of CEL verification.

### Hardware asymmetry

Fast desktops, GPUs, or specialized hardware may produce receipts faster than
phones or low-power devices. CEL increases marginal cost, but it does not make
cost equal for everyone.

### Receipt reuse

Receipts are reusable unless the context and epoch prevent reuse. Bind receipts
to an action, resource, method, audience, and short epoch where possible.

### Overclaiming

CEL should be described as a compute-pricing primitive. Calling it a complete
CAPTCHA replacement will invite the wrong security review.

## Production Checklist

- set a strict `maxDepth`
- require current or previous epoch only
- bind context to the exact action
- reject oversized receipts before verification
- log verification latency
- test on mobile and low-power devices
- combine with reputation, account limits, or payment where appropriate
