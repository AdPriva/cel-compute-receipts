# Mode B (Succinct Verification) — Feasibility Assessment

Status: research note, not a commitment. Mode B is not implemented. This
document exists to give an evidence-based answer to "what would it take,"
before any circuit code is written.

## The problem Mode B is supposed to solve

Mode A (the only mode implemented today) makes the verifier redo the entire
sequential assembly: `O(depth)` hash evaluations, exactly matching the
prover's cost. `docs/threat-model.md` already names this "Verifier CPU
Amplification" as the primary risk of the whole protocol. Mode B's promise is
a proof `π` the verifier can check in `O(log depth)` or `O(1)` time,
regardless of how deep the assembly was.

## The core finding: the hash function CEL already chose is the wrong one for this

This is the load-bearing fact for everything below, and it's not a detail —
it determines whether Mode B is a few weeks of engineering or a dead end.

SHA-256 and SHA-512 (the only two algorithms `docs/protocol.md` currently
allows) were designed for cheap evaluation on real CPUs: word-sized XOR,
rotate, and modular-add operations. Those operations are exactly the ones
that are *expensive* to express as arithmetic constraints over a finite
field, which is what SNARK/STARK circuits are built from. Concretely:

- One SHA-256 compression costs roughly **25,000–30,000 R1CS constraints**
  in a Groth16-style circuit.
- A SNARK-native hash like **Poseidon2** costs roughly **240–300
  constraints** for comparable security — about **100x cheaper**.
- In STARK-based provers (e.g. Plonky2), Poseidon-style permutations prove
  roughly **20x faster** than SHA-256 for the same circuit, because the
  underlying arithmetization overhead per hash is so much lower.

Source: constraint-count comparisons collected in ["Why We Chose
Poseidon2"](https://medium.com/@trusts-stack-network/why-we-chose-poseidon2-a-hash-function-that-actually-understands-math-9422204f6caf)
and the ZoKrates hashing-algorithm benchmarks
(<a href="https://zk-plus.github.io/tutorials/basics/hashing-algorithms-benchmarks">zk-plus.github.io</a>).

**Implication:** proving CEL's current SHA-256/SHA-512 assembly succinctly is
possible, but it will always be dramatically more expensive per hash than
proving an assembly built on a SNARK-friendly permutation. Mode B realistically
needs a *third* algorithm identifier reserved for succinct-eligible receipts —
not a retrofit of the existing two.

## What the actual numbers look like

Direct (Mode A) hashing is absurdly cheap relative to any form of proving.
From the CEL paper's own Table 1: creating a depth=100,000 receipt (which is
~200,000 individual hash calls, since each step does `e_i = H(...)` and
`s_i = H(...)`) takes **~219ms** on ordinary hardware — roughly 914,000
hashes/second.

Compare that to proving throughput for the same 200,000 hashes:

| Approach | Measured throughput | Time to prove depth=100,000 (≈200k hashes) |
| --- | --- | --- |
| Mode A, direct SHA-256 (baseline) | ~914,000 hashes/sec | 0.22 s |
| Plonky2 STARK, SHA-256, M1 laptop | ~142 hashes/sec | ~23.5 minutes |
| RISC Zero general-purpose zkVM, SHA-256 | ~0.34 hashes/sec | ~6.8 **days** |
| Plonky2-style STARK, Poseidon (~20x SHA-256) | ~2,840 hashes/sec (estimated) | ~70 seconds |

Sources: Plonky2 SHA-256 figures from
<a href="https://github.com/Sladuca/sha256-prover-comparison">sha256-prover-comparison</a>
(80–142 hashes/sec across 2019 MacBook Pro and M1 hardware); RISC Zero figure
from the [Lita SHA-256 vs. RISC Zero
benchmark](https://lita.gitbook.io/lita-documentation/architecture/benchmarks/sha-256-vs.-risc-zero)
(~2.9s to prove one 32-byte SHA-256 in a general-purpose zkVM); Poseidon
speedup factor from the Poseidon2 sources above, applied as a multiplier to
the measured Plonky2 SHA-256 rate as a rough estimate, not a direct
benchmark — this row should be re-measured before being relied on.

Two things fall out of this table immediately:

1. **A general-purpose zkVM (RISC Zero, SP1-style) is not viable here.**
   Interpreting SHA-256 through a general RISC-V execution trace multiplies
   the already-bad SHA-256-in-circuit cost by the overhead of the VM itself.
   Days to prove a receipt that takes 220ms to compute directly is not a
   throttling mechanism anyone would deploy.
2. **Even a dedicated SHA-256 STARK circuit is unusable for interactive use
   cases.** 23 minutes to prove a receipt that an agent-gateway example
   currently expects synchronously (`examples/agent-gateway.js`'s
   `REQUIRED_DEPTH` default of 20,000 takes single-digit milliseconds to
   prove today) is a different product, not a mode switch.
3. **Switching to a SNARK-friendly hash brings it into "maybe async, still
   not interactive" territory** — tens of seconds, not milliseconds. That's
   usable for some use cases (see below) but changes what Mode B is *for*.

## What Mode B would actually be good for, given this

Given the latency floor above, Mode B stops looking like "the same protocol,
but the verifier does less work" and starts looking like a distinct policy
for a distinct class of use case:

- **Good fit:** high-value, non-interactive admission — e.g. a batch job, a
  background agent task, or a one-time registration cost — where the prover
  can spend tens of seconds to minutes producing a receipt once, and many
  verifiers (or one verifier, many times) benefit from checking it in
  milliseconds thereafter. This matches `docs/threat-model.md`'s own
  "Dedicated attacker... CEL should sit behind ordinary rate limits" framing:
  Mode B receipts could be the *expensive* tier above Mode A's cheap tier.
- **Bad fit:** the flagship AI-agent example in this repo
  (`examples/agent-gateway.js`, `REQUIRED_DEPTH=20000`, sub-10ms prove time).
  Mode B at any currently-benchmarked proving rate would turn a fast
  challenge-response flow into a multi-second-to-multi-minute one. Mode B
  should not be framed as a drop-in replacement for Mode A's current use
  cases; it's a different point on the cost/verification-speed tradeoff
  curve, for different traffic.

## Recommended approach, if this is pursued

1. **New algorithm identifier, not a SHA-256 circuit.** Introduce something
   like `"poseidon2"` (or whatever permutation is chosen) as a new value for
   the receipt's `algorithm` field, valid only for Mode-B-eligible policies.
   Keep `sha256`/`sha512` as Mode-A-only; don't try to make them succinct.
2. **STARK over SNARK, and specifically a FRI-based system (Plonky2/Plonky3
   lineage) over Groth16/Halo2-style circuits.** Reasons: no trusted-setup
   ceremony (matches this project's existing "no special hardware, no
   synchronized assumptions" positioning), a sequential hash assembly maps
   naturally onto a STARK's execution-trace (AIR) model step-for-step, and
   these systems support recursive proof composition — which matters because
   it opens the door to *incremental* proving (prove step 1..k, then extend
   to 1..k+n) instead of requiring the entire depth to be computed before
   proving starts.
3. **Prototype scope: depth ≈ 1,000–10,000, not production depths.** Validate
   the mechanism (a STARK proof of a short Poseidon-based sequential
   assembly verifies correctly and quickly) before spending effort on
   proving-time optimization at the depths Mode A uses today.
4. **Re-benchmark on real hardware before trusting the Poseidon row above.**
   That number is a multiplier applied to someone else's SHA-256 benchmark,
   not a direct measurement of a Poseidon-based sequential assembly. It's
   directionally right (Poseidon-in-STARK is well established as roughly an
   order of magnitude cheaper than SHA-256-in-STARK) but should not be
   treated as a real latency budget until measured on the actual candidate
   circuit.

## What this document is not

It is not a decision to build Mode B, and it is not a circuit design. It's
the evidence needed to make that decision honestly: the biggest risk to
Mode B was never "can we write a STARK circuit" — frameworks for that exist
and are mature — it was "does proving a CEL receipt succinctly stay fast
enough to be useful for the traffic this project actually targets." The
answer, at today's benchmarked proving speeds and with CEL's current hash
choice, is no for the interactive AI-agent case this repo leads with, and
maybe for a slower, higher-value admission tier if a SNARK-friendly hash is
adopted for it.

## Sources

- <a href="https://github.com/Sladuca/sha256-prover-comparison">sha256-prover-comparison</a> — Plonky2/Halo2/Groth16 SHA-256 proving benchmarks
- <a href="https://lita.gitbook.io/lita-documentation/architecture/benchmarks/sha-256-vs.-risc-zero">SHA-256 vs. RISC Zero — Lita benchmarks</a>
- <a href="https://medium.com/@trusts-stack-network/why-we-chose-poseidon2-a-hash-function-that-actually-understands-math-9422204f6caf">Why We Chose Poseidon2</a> — constraint-count comparison
- <a href="https://zk-plus.github.io/tutorials/basics/hashing-algorithms-benchmarks">ZoKrates hashing-algorithm benchmarks</a>
- <a href="https://eprint.iacr.org/2023/1503.pdf">zk-Bench: A Toolset for Comparative Evaluation of ZK proof systems</a>
