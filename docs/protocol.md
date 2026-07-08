# Protocol Notes

CEL v0 creates a receipt by running a sequential hash assembly for a specific
policy, epoch, and context.

## Receipt

```json
{
  "version": "cel/v0",
  "algorithm": "sha256",
  "depth": 10000,
  "epoch": "cel:300:5941344",
  "context": {
    "action": "agent.message",
    "resource": "/api/agent"
  },
  "root": "base64url-encoded-root"
}
```

## Assembly

The implementation canonicalizes the policy and context, then derives:

```text
s0 = H(frame(policy) || frame(epoch) || frame(context))
```

Definitions:

- `H` is SHA-256.
- `frame(x) = uint32be(byte_length(x)) || utf8(x)` - length-prefixed framing
  prevents ambiguity when fields are concatenated.
- `policy` is the canonical JSON of
  `{"algorithm":"sha256","depth":<depth>,"version":"cel/v0"}`.
- Canonical JSON: object keys sorted lexicographically at every level, no
  whitespace, arrays in order, numbers must be finite.

For each step `i` from `1` to `depth`:

```text
e_i = H(s_(i-1) || uint64be(i))
s_i = H(s_(i-1) || e_i)
```

The final receipt root is `base64url(s_depth)`.

## Verification

The verifier recomputes the assembly and compares the expected root with the
receipt root using a constant-time comparison.

Mode A verification is intentionally transparent but expensive: verification
cost is linear in `depth`.

## Epochs

Epochs are opaque strings. Applications can derive them from five-minute
windows, block heights, release identifiers, or any other local policy.

This package includes `deriveEpoch()` as a convenience helper:

```text
cel:<window_seconds>:<window_number>
```

## Context Binding

The context should include enough application data to prevent receipt reuse
across actions. For example:

```json
{
  "action": "comment.create",
  "resource": "/posts/123",
  "method": "POST"
}
```

## Test Vectors

Any conforming implementation must reproduce these roots.

Vector 1 (`depth=3`, `epoch="cel-test"`, `context={"action":"vector"}`):

```text
root = SUa6CzV6VNZnDfweGuysAn6xy8t5KjCaU7g3ApFCB1g
```

Vector 2 (`depth=10000`, `epoch="cel-test"`, `context={"action":"vector"}`):

```text
root = mgEA_H5SuqfxzcjpgMfavrEb0_URx7Wl8UCPFedtg30
```

## Important Caveat

This repository implements the direct verification mode only. Succinct
verification, where the verifier checks a compact proof instead of recomputing
the chain, is a research and engineering project of its own.
