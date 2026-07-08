# CEL v0 Protocol Notes

CEL v0 creates a receipt by running a sequential hash assembly for a specific
policy, epoch, and context. This document describes the byte-level behavior of
the reference implementation so independent implementations can interoperate.

The full paper is available at [docs/CEL-paper.pdf](./CEL-paper.pdf).

## Status

This is an experimental protocol note for the v0 reference implementation. The
implemented verification mode is direct recomputation only.

## Receipt

A receipt is JSON with these fields:

```json
{
  "version": "cel/v0",
  "algorithm": "sha256",
  "depth": 10000,
  "epoch": "cel:300:5941344",
  "context": {
    "action": "agent.message",
    "resource": "/api/agent",
    "method": "POST"
  },
  "root": "base64url-encoded-root",
  "elapsedMs": 30.5
}
```

Required verification fields:

- `version`: must be `"cel/v0"`
- `algorithm`: `"sha256"` by default; this implementation also accepts
  `"sha512"`
- `depth`: positive safe integer
- `epoch`: non-empty string
- `context`: application-defined value
- `root`: base64url-encoded final state

`elapsedMs` is informational and is not verified. Unknown extra fields are not
part of the receipt root.

Unknown versions and algorithms must be rejected.

## Canonicalization

The policy and non-string contexts are serialized with deterministic JSON:

- object keys are sorted lexicographically as strings (byte-wise by UTF-16
  code unit; numeric-looking keys such as `"10"` and `"2"` sort as strings,
  so `"10"` precedes `"2"` — cross-language implementations must match this)
- arrays preserve order
- strings and booleans use normal JSON encoding
- numbers must be finite JSON numbers
- `null` is allowed
- object fields with `undefined` values are omitted
- unsupported values such as functions, symbols, and bigints are rejected
- JavaScript `Date` values are serialized to ISO 8601 strings by the reference
  implementation

For portability, protocol users should prefer plain JSON values and avoid
language-specific values such as JavaScript `Date`.

The policy string is:

```json
{"algorithm":"sha256","depth":10000,"version":"cel/v0"}
```

with the selected `algorithm` and `depth`.

The context is canonicalized as follows:

- if `context` is a string, the raw string is used directly
- otherwise, deterministic JSON serialization is used

## Binary Encoding

All strings are encoded as UTF-8 bytes.

`uint64be(x)` is the 8-byte big-endian encoding of the unsigned integer `x`.

`frame(x)` is:

```text
uint64be(byte_length(x)) || utf8(x)
```

The assembly never concatenates variable-length strings without framing.

## Assembly

Let:

```text
policy = canonical_json({ "version": "cel/v0", "algorithm": algorithm, "depth": depth })
context_bytes_input = context if context is a string else canonical_json(context)
```

The initial state is:

```text
s0 = H(frame(policy) || frame(epoch) || frame(context_bytes_input))
```

For each step `i` from `1` to `depth`:

```text
e_i = H(s_(i-1) || uint64be(i))
s_i = H(s_(i-1) || e_i)
```

The final receipt root is:

```text
base64url(s_depth)
```

The reference implementation currently supports `sha256` and `sha512`, using
Node.js `crypto.createHash(algorithm)`.

## Verification

The verifier:

1. Parses the receipt.
2. Rejects unsupported `version` or `algorithm` values.
3. Rejects invalid `depth`, empty `epoch`, or empty `root`.
4. Rejects immediately if `depth > maxDepth`.
5. Recomputes the assembly using the receipt fields.
6. Decodes `root` from base64url.
7. Compares the decoded root to the recomputed root.

The reference implementation uses Node.js `crypto.timingSafeEqual` after
checking that both buffers have equal length. Mode A verification is
intentionally transparent but expensive: verification cost is linear in `depth`.

## Epochs

Epochs are opaque strings. Applications can derive them from five-minute
windows, block heights, server-issued nonces, release identifiers, or any other
local policy.

This package includes `deriveEpoch()` as a convenience helper:

```text
cel:<window_seconds>:<window_number>
```

where:

```text
window_number = floor(unix_timestamp_seconds / window_seconds)
```

The helper uses Unix time and does not apply timezone conversion. Leap seconds
are ignored in the usual Unix timestamp model.

## Context Binding

The context should include enough application data to prevent receipt reuse
across actions. For example:

```json
{
  "action": "comment.create",
  "resource": "/posts/123",
  "method": "POST",
  "audience": "api.example.com"
}
```

An empty object is valid but usually unsafe because it does not bind the receipt
to a meaningful action.

## Error Conditions

Implementations should reject:

- `depth < 1`
- non-integer or unsafe integer `depth` values
- `depth` above the verifier's local `maxDepth`
- empty or non-string `epoch`
- empty or non-string `root`
- unsupported `version` values
- unsupported `algorithm` values
- malformed base64url roots
- contexts that cannot be canonicalized

The reference implementation's default maximum depth is `5,000,000`, but
applications should set a lower `maxDepth` for interactive or unauthenticated
traffic.

## Test Vector

This vector uses `sha256`, `depth = 1`, `epoch = "test-epoch"`, and:

```json
{
  "action": "test",
  "resource": "/demo"
}
```

Canonical values:

| Name | Value |
| --- | --- |
| policy | `{"algorithm":"sha256","depth":1,"version":"cel/v0"}` |
| context | `{"action":"test","resource":"/demo"}` |
| `uint64be(1)` | `0000000000000001` |

Frames:

| Name | Hex |
| --- | --- |
| `frame(policy)` | `00000000000000337b22616c676f726974686d223a22736861323536222c226465707468223a312c2276657273696f6e223a2263656c2f7630227d` |
| `frame(epoch)` | `000000000000000a746573742d65706f6368` |
| `frame(context)` | `00000000000000247b22616374696f6e223a2274657374222c227265736f75726365223a222f64656d6f227d` |

Assembly outputs:

| Name | Hex |
| --- | --- |
| `s0` | `51f5ec7a34da3047187b1205aa83128cc3f754b6ec0f4813d7f780a49647d77a` |
| `e1` | `d11dc3788cb40bbf70674bdd6ddb6fdbbe82bfcd40327cf9e913911e87e86d7a` |
| `s1` | `c2c1ccab6633e161fda50427d78953e1c2c7372300c45519f5ca7a9a1d92f36b` |

Final receipt root:

```text
wsHMq2Yz4WH9pQQn14lT4cLHNyMAxFUZ9cp6mh2S82s
```

## Important Caveat

This repository implements the direct verification mode only. Succinct
verification, where the verifier checks a compact proof instead of recomputing
the chain, is a research and engineering project of its own.
