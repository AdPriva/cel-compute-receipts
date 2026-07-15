"""
CEL v0 - Computational Effort Layer, Python reference implementation.

Independent-language port of src/cel.js, written against docs/protocol.md
only (not against the JS source), to test the spec's own claim that
"independent implementations can interoperate." Validated against the pinned
test vector in docs/protocol.md - see test_cel.py.

Deliberately reproduces the JS-specific canonicalization behavior the
protocol spec calls out, rather than using Python's more natural defaults:

  - object keys are sorted by UTF-16 *code unit* order, matching
    JavaScript's default string sort. This is NOT the same as Python's
    default str comparison (which compares Unicode code points and
    disagrees with JS for characters outside the Basic Multilingual Plane,
    where JS compares surrogate-pair halves instead of the combined code
    point), and NOT UTF-8 byte order.
  - booleans must be checked before integers: Python's bool is a subclass
    of int, so `isinstance(True, int)` is True. Checking int first would
    silently encode True as the number 1.

NUMBER LIMITATIONS (read before using non-integer or very large numeric
context values): this module does not replicate ECMA-262's exact
Number-to-string algorithm for arbitrary floats, nor IEEE-754 double
rounding for integers outside JavaScript's safe integer range
(+/-(2**53 - 1)). docs/protocol.md itself recommends avoiding non-integer
numbers in protocol-bound contexts for exactly this reason. Integers outside
the safe range are rejected outright here rather than silently canonicalized
to a string a real JS peer might not agree with.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import re
import struct
import time
from typing import Any, Optional

VERSION = "cel/v0"
DEFAULT_ALGORITHM = "sha256"

# Supported hash algorithms and their digest sizes in bytes.
ALGORITHMS = {"sha256": 32, "sha512": 64}

# Default verifier depth ceiling. Applications should set a much lower
# max_depth for interactive or unauthenticated traffic.
DEFAULT_MAX_DEPTH = 5_000_000

MAX_CONTEXT_BYTES = 4096
MAX_EPOCH_BYTES = 256

# JavaScript's safe integer range (Number.MAX_SAFE_INTEGER). Integers outside
# this range are rejected during canonicalization rather than guessed at -
# see NUMBER LIMITATIONS above.
_JS_MAX_SAFE_INTEGER = 2**53 - 1

_B64URL_RE = re.compile(r"^[A-Za-z0-9_-]+$")


# --------------------------------------------------------------------- #
# Encoding helpers
# --------------------------------------------------------------------- #

def _hash(algorithm: str, *chunks: bytes) -> bytes:
    h = hashlib.new(algorithm)
    for c in chunks:
        h.update(c)
    return h.digest()


def _uint64be(n: int) -> bytes:
    return struct.pack(">Q", n)


def _frame(s: str) -> bytes:
    """frame(x) = uint64be(byte_length(x)) || utf8(x)"""
    b = s.encode("utf-8")
    return _uint64be(len(b)) + b


def _utf16_sort_key(s: str):
    """
    Sort key matching JavaScript's default string comparison: by UTF-16
    code unit, not by Python's code-point comparison and not by UTF-8 bytes.
    A character outside the BMP is compared as its two surrogate halves,
    exactly as JS does, which can disagree with code-point order.
    """
    b = s.encode("utf-16-be")
    return tuple(b[i] * 256 + b[i + 1] for i in range(0, len(b), 2))


def canonicalize(value: Any) -> str:
    """Deterministic JSON canonicalization matching docs/protocol.md."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        # Must be checked before int: bool is an int subclass in Python.
        return "true" if value else "false"
    if isinstance(value, int):
        if abs(value) > _JS_MAX_SAFE_INTEGER:
            raise ValueError(
                f"integer {value} exceeds JS safe integer range; "
                "cross-language canonical form is not guaranteed for it"
            )
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("context numbers must be finite")
        if value == 0:
            return "0"  # matches JSON.stringify(-0) === "0"
        if value == int(value) and abs(value) <= _JS_MAX_SAFE_INTEGER:
            return str(int(value))  # 1.0 -> "1", matching JSON.stringify
        return repr(value)
    if isinstance(value, str):
        # ensure_ascii=False: JSON.stringify only escapes control characters,
        # quotes, and backslashes - it does NOT escape non-ASCII characters
        # the way Python's json.dumps does by default. Without this, e.g.
        # "sé" would canonicalize as "sé" here but "sé" in JS, breaking
        # cross-language interop for any non-ASCII context value.
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canonicalize(v) for v in value) + "]"
    if isinstance(value, dict):
        parts = []
        for k in sorted(value.keys(), key=_utf16_sort_key):
            v = value[k]
            if v is None and k not in value:
                continue  # unreachable in practice; dicts have no "omitted" state
            parts.append(json.dumps(k, ensure_ascii=False) + ":" + canonicalize(v))
        return "{" + ",".join(parts) + "}"
    raise TypeError(f"{type(value).__name__} values cannot be canonicalized")


def _context_input(context: Any) -> str:
    """Raw string if context is a string, canonical JSON otherwise."""
    return context if isinstance(context, str) else canonicalize(context)


def _base64url_encode(b: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _base64url_decode(s: str) -> bytes:
    import base64

    padded = s + "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(padded)


# --------------------------------------------------------------------- #
# Core assembly
# --------------------------------------------------------------------- #

def _derive_seed(algorithm: str, depth: int, epoch: str, ctx_input: str) -> bytes:
    policy = canonicalize({"algorithm": algorithm, "depth": depth, "version": VERSION})
    return _hash(algorithm, _frame(policy), _frame(epoch), _frame(ctx_input))


def _assemble(algorithm: str, seed: bytes, depth: int) -> bytes:
    s = seed
    for i in range(1, depth + 1):
        index_bytes = _uint64be(i)
        e = _hash(algorithm, s, index_bytes)
        s = _hash(algorithm, s, e)
    return s


# --------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------- #

def _check_algorithm(algorithm: str) -> None:
    if algorithm not in ALGORITHMS:
        raise ValueError(f"unsupported algorithm: {algorithm}")


def _check_depth(depth: Any) -> None:
    if not isinstance(depth, int) or isinstance(depth, bool) or depth < 1:
        raise ValueError("depth must be a positive safe integer")
    if depth > _JS_MAX_SAFE_INTEGER:
        raise ValueError("depth must be a positive safe integer")


def _check_epoch(epoch: Any) -> None:
    if not isinstance(epoch, str) or len(epoch) == 0:
        raise TypeError("epoch must be a non-empty string")
    if len(epoch.encode("utf-8")) > MAX_EPOCH_BYTES:
        raise ValueError(f"epoch exceeds {MAX_EPOCH_BYTES} bytes")


def _check_context_size(ctx_input: str) -> None:
    if len(ctx_input.encode("utf-8")) > MAX_CONTEXT_BYTES:
        raise ValueError(f"context exceeds {MAX_CONTEXT_BYTES} bytes")


# --------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------- #

def create_receipt(
    depth: int,
    epoch: str,
    context: Any,
    algorithm: str = DEFAULT_ALGORITHM,
) -> dict:
    """Create a compute receipt. Mirrors createReceipt() in src/cel.js."""
    _check_algorithm(algorithm)
    _check_depth(depth)
    _check_epoch(epoch)
    ctx_input = _context_input(context)
    _check_context_size(ctx_input)

    t0 = time.perf_counter()
    seed = _derive_seed(algorithm, depth, epoch, ctx_input)
    root = _assemble(algorithm, seed, depth)
    elapsed_ms = (time.perf_counter() - t0) * 1000

    return {
        "version": VERSION,
        "algorithm": algorithm,
        "depth": depth,
        "epoch": epoch,
        "context": context,
        "root": _base64url_encode(root),
        "elapsedMs": round(elapsed_ms, 2),
    }


def verify_receipt(
    receipt: Any,
    max_depth: int = DEFAULT_MAX_DEPTH,
    required_epoch: Optional[str] = None,
    allowed_epochs: Optional[list] = None,
    required_context: Any = "__cel_unset__",
) -> dict:
    """
    Verify a compute receipt by direct recomputation (Mode A). Mirrors
    verifyReceipt() in src/cel.js, including its check ordering: every cheap
    rejection happens before the expensive chain recomputation.

    Sentinel default for required_context (rather than None) because None is
    itself a valid context value and must be distinguishable from "not
    supplied".
    """
    if not isinstance(max_depth, int) or isinstance(max_depth, bool) or max_depth < 1:
        return {"ok": False, "error": "maxDepth must be a positive safe integer"}
    if receipt is None or not isinstance(receipt, dict):
        return {"ok": False, "error": "receipt must be an object"}
    if receipt.get("version") != VERSION:
        return {"ok": False, "error": f"unsupported version (expected {VERSION})"}
    algorithm = receipt.get("algorithm")
    if not isinstance(algorithm, str) or algorithm not in ALGORITHMS:
        return {"ok": False, "error": "unsupported algorithm"}
    depth = receipt.get("depth")
    if not isinstance(depth, int) or isinstance(depth, bool) or depth < 1:
        return {"ok": False, "error": "depth must be a positive safe integer"}
    if depth > max_depth:
        return {"ok": False, "error": f"depth {depth} exceeds maxDepth {max_depth}"}
    epoch = receipt.get("epoch")
    if not isinstance(epoch, str) or len(epoch) == 0:
        return {"ok": False, "error": "epoch must be a non-empty string"}
    if len(epoch.encode("utf-8")) > MAX_EPOCH_BYTES:
        return {"ok": False, "error": "epoch too large"}
    if required_epoch is not None and epoch != required_epoch:
        return {"ok": False, "error": "epoch mismatch"}
    if allowed_epochs is not None:
        if not isinstance(allowed_epochs, list):
            return {"ok": False, "error": "allowedEpochs must be an array"}
        if epoch not in allowed_epochs:
            return {"ok": False, "error": "epoch not in allowed set"}
    root = receipt.get("root")
    if not isinstance(root, str) or len(root) == 0:
        return {"ok": False, "error": "root must be a non-empty base64url string"}

    try:
        ctx_input = _context_input(receipt.get("context"))
        _check_context_size(ctx_input)
    except (TypeError, ValueError) as err:
        return {"ok": False, "error": f"invalid context: {err}"}

    if required_context != "__cel_unset__":
        try:
            required_input = _context_input(required_context)
        except (TypeError, ValueError) as err:
            return {"ok": False, "error": f"invalid requiredContext: {err}"}
        if required_input != ctx_input:
            return {"ok": False, "error": "context mismatch"}

    if not _B64URL_RE.match(root):
        return {"ok": False, "error": "root is not valid base64url"}
    claimed = _base64url_decode(root)
    # Round-trip check enforces canonical unpadded base64url: naive decoders
    # accept multiple final characters that decode to the same bytes;
    # re-encoding and comparing ensures only the canonical form is accepted.
    if _base64url_encode(claimed) != root:
        return {"ok": False, "error": "root is not canonical base64url"}
    if len(claimed) != ALGORITHMS[algorithm]:
        return {"ok": False, "error": "root has wrong length for algorithm"}

    seed = _derive_seed(algorithm, depth, epoch, ctx_input)
    expected = _assemble(algorithm, seed, depth)

    if not hmac.compare_digest(expected, claimed):
        return {"ok": False, "error": "root mismatch"}
    return {"ok": True}


def derive_epoch(window_seconds: int = 300, now_ms: Optional[float] = None) -> str:
    """cel:<window_seconds>:<window_number>, window_number = floor(unix_s / window_seconds)."""
    if not isinstance(window_seconds, int) or isinstance(window_seconds, bool) or window_seconds < 1:
        raise ValueError("windowSeconds must be a positive integer")
    if now_ms is None:
        now_ms = time.time() * 1000
    if not isinstance(now_ms, (int, float)) or isinstance(now_ms, bool) or not math.isfinite(now_ms):
        raise ValueError("nowMs must be a finite number")
    window_number = math.floor(now_ms / 1000 / window_seconds)
    return f"cel:{window_seconds}:{window_number}"


def current_epochs(window_seconds: int = 300, now_ms: Optional[float] = None) -> list:
    """Current and previous epoch for a window - the usual verifier allow-set."""
    if now_ms is None:
        now_ms = time.time() * 1000
    current = derive_epoch(window_seconds, now_ms)
    previous = derive_epoch(window_seconds, now_ms - window_seconds * 1000)
    return [current, previous]
