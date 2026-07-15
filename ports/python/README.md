# CEL Python Port (Reference)

**Status: reference port validating cross-language interop, not an
officially maintained SDK.** It is not kept in lockstep with every future
protocol change, has no CI job of its own yet, and should not be treated as
a second supported implementation the way `src/cel.js` (Node) and
`src/cel-browser.js` (WebCrypto) are.

## Why this exists

`docs/protocol.md` claims independent implementations can interoperate.
Until this port existed, that claim was untested — the only two
implementations in this repo share an author and, more importantly, share
every JavaScript-specific canonicalization quirk (UTF-16 key sort order,
`JSON.stringify` number formatting) that the spec explicitly warns other
languages will get wrong.

This port was written directly against `docs/protocol.md`, not against the
JS source, then cross-checked against live `src/cel.js` output for several
vectors, including non-ASCII and supplementary-plane-unicode contexts. It
matches the pinned interop vector and all cross-checked vectors exactly.

Along the way it caught a real, concrete interop bug: Python's `json.dumps`
escapes non-ASCII characters by default (`"sé"` → `"s\u00e9"`), while
JavaScript's `JSON.stringify` does not. `cel.py` explicitly works around
this (`ensure_ascii=False`) — see the comment at that call site.

## Usage

```python
from cel import create_receipt, verify_receipt, derive_epoch

receipt = create_receipt(depth=10000, epoch=derive_epoch(), context={"action": "test"})
result = verify_receipt(receipt, max_depth=10000)
```

## Running the tests

```bash
python3 -m unittest test_cel -v
```

## Known limitations

See the module docstring in `cel.py` for the full detail, but briefly:
this port does not replicate ECMA-262's exact Number-to-string algorithm for
arbitrary floats, nor IEEE-754 double rounding for integers outside
JavaScript's safe integer range. `docs/protocol.md` itself recommends
avoiding non-integer numbers in protocol-bound contexts for exactly this
reason. Values this port cannot faithfully cross-canonicalize are rejected
outright rather than silently mis-encoded.
