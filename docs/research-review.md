# Research Review

## Summary Assessment

As an open-source abuse-throttling primitive, CEL is a strong fit: the scope
is honest and the primitive is simple to reason about.

As a complete CAPTCHA replacement, it is not one and should not be positioned
as one; it replaces CAPTCHAs only where the real goal is throttling.

As an AI-agent web primitive, it has strong potential if paired with clear
policies and cheap verification.

## What Is Strong

CEL has a clean product story: do not classify the actor, price the action.
That is privacy-friendly, understandable, and useful for environments where
identity is weak or expensive.

The context binding is also important. A receipt should not mean "I did some
work somewhere." It should mean "I did this work for this action, resource, and
validity window."

The AI-agent angle is credible. Agents can attach compute receipts to requests,
and services can treat those receipts as an admission cost for anonymous or
low-trust traffic.

## What Needs Care

Direct verification costs the verifier about as much work as the prover. That
is the biggest practical weakness. It is fine for small depths and controlled
systems, but dangerous as a public unauthenticated hot path.

The cryptographic paper should be careful with novelty claims. The construction
is close to iterated hash-chain work and client-puzzle literature. The framing
of "verifiable inevitability" may be useful, but reviewers will expect precise
comparisons to proof of sequential work, repeated squaring, VDFs, and classic
client puzzles.

The security proof should avoid relying on preimage resistance alone if the
claim is about sequential unskippability. A tighter model may need random-oracle
or query-complexity assumptions, because proving that no shortcut exists for an
iterated function is stronger than ordinary preimage resistance.

Hardware asymmetry remains. CEL can increase marginal cost, but it does not
make a phone and a server-grade machine equal.

## Best Public Positioning

Use this language:

> CEL is a compute-receipt protocol for pricing digital actions without
> identity, clocks, or behavioral classification.

Avoid this language:

> CEL replaces CAPTCHA.

Better:

> CEL can replace CAPTCHA-like challenges in flows where the real goal is
> throttling abuse rather than proving humanity.

## Suggested Next Research Steps

- benchmark browser, phone, desktop, and server devices
- add a memory-hard policy variant
- define a replay-resistant challenge format
- design a verifier-safe deployment profile
- prototype succinct verification separately
- rewrite the proof around a more precise sequential-work assumption
