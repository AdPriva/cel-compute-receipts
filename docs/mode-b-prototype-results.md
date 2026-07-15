# Mode B Prototype — Results

Companion to `docs/mode-b-feasibility.md`. That document is a research
survey with one estimated data point (Poseidon-in-STARK, extrapolated from a
SHA-256 benchmark). This document reports what was actually built and
measured: a real, working, end-to-end succinct proof of a small CEL-style
sequential assembly, using circom + snarkjs + Groth16 + Poseidon.

**This is a proof of concept for depth=4, not a production design.** The
feasibility doc's recommendation (STARK/FRI-based, for no-trusted-setup and
recursive composition) still stands for a real implementation — Groth16 was
used here because circom/snarkjs is the most mature, fastest-to-stand-up
toolchain for validating the *mechanism* quickly. See "What this changes
about the recommendation" below for the honest tradeoff this surfaced.

## What was built

`assembly.circom`: a circuit reproducing CEL's sequential assembly structure
(`e_i = H(s_{i-1}, i)`, `s_i = H(s_{i-1}, e_i)`) for a fixed depth, using
Poseidon as `H` instead of SHA-256/512. Public input: the seed `s0`. Public
output: the final root `s_depth`. Depth 4 for this prototype.

Full pipeline run: circuit compilation → Powers of Tau ceremony → Groth16
circuit-specific setup → witness generation from a real seed → proof
generation → verification → tamper test.

## Measured results (depth = 4, 8 Poseidon calls, BN128 curve, M-series Mac)

| Metric | Value |
| --- | --- |
| Circuit constraints | 1,944 non-linear + 2,192 linear |
| Constraints per Poseidon call | ~243 (1944 / 8) |
| Proof generation (wall clock) | 1.14 s |
| Proof verification (wall clock, cold process) | 0.88 s |
| Proof size | 806 bytes as JSON (a handful of curve points; constant regardless of depth) |
| Verification key size | 3,112 bytes (constant regardless of depth) |

The constraints-per-Poseidon-call figure (~243) independently confirms the
~240–300 constraint estimate cited in `docs/mode-b-feasibility.md` from
external sources — this prototype's own circuit landed right in that range
without being tuned to match it.

**On the verification time:** 0.88s wall-clock is almost entirely Node.js
process startup and snarkjs module loading, not the actual Groth16 pairing
check, which is a handful of elliptic-curve pairings and normally completes
in low single-digit milliseconds in a warm process. This prototype invoked
`snarkjs` fresh via `npx` for each step; a real verifier would keep the
library loaded, making steady-state verification latency essentially flat
and fast regardless of depth — which is the entire point of Mode B.

**Soundness check:** flipping one bit of the claimed public output and
re-running verification against the same proof correctly fails
("Invalid proof"). The circuit isn't just accepting anything.

## What this changes about the recommendation

Two things this prototype surfaced that the feasibility doc's desk research
didn't fully capture:

1. **Depth must be fixed at circuit-compile time.** This circuit only proves
   depth=4 receipts; a depth=1000 receipt needs a different, separately
   compiled circuit (and separately generated proving/verification keys).
   Mode A's `depth` is a free runtime field on every receipt; Mode B's
   isn't, for a plain (non-recursive) circuit. This is exactly the reason
   `mode-b-feasibility.md` flagged recursive proof composition as
   important — without it, "Mode B" really means "a fixed menu of allowed
   depths, each with its own circuit," not "prove any depth."
2. **Groth16's proof size (hundreds of bytes, flat regardless of depth) is
   a genuine advantage over STARKs**, which typically produce proofs in the
   tens-to-hundreds of KB range. If receipts need to travel in an HTTP
   header (as `examples/agent-gateway.js` does today) or a size-constrained
   channel, Groth16-style constant tiny proofs are attractive independent of
   the trusted-setup tradeoff. This wasn't weighted heavily enough in the
   original feasibility doc, which focused on proving/verification time and
   the trusted-setup question. A real Mode B decision should weigh proof
   size too, not just latency and setup ceremony.

The feasibility doc's core conclusion is unchanged: SHA-256/512 (Mode A's
hash choice) are impractical to prove succinctly, and a real Mode B needs a
SNARK/STARK-friendly hash reserved for a distinct algorithm identifier. This
prototype used Poseidon for exactly that reason and it worked cleanly.

## What would be needed to go further

- A depth-flexible design: either recursive proof composition (prove depth
  1..k, extend to depth 1..k+n without re-proving from scratch) or an
  explicit, small, published menu of supported depths, each its own circuit.
- A real (multi-party) trusted-setup ceremony if Groth16 is the final
  choice, or a switch to a transparent-setup system (e.g. a STARK, or
  Groth16's more modern relatives like Plonk/Halo2 with universal setup)
  to remove the "someone must be trusted to destroy toxic waste" dependency
  this prototype's ceremony has (its own contribution entropy was a demo
  string, not real randomness — fine for a prototype, not for production).
- Re-running this same measurement at realistic depths (1,000+) to see how
  proving time actually scales, rather than relying on the depth=4 numbers
  above extrapolated linearly.
