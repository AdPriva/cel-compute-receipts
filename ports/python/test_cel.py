"""
Test suite for the Python CEL port. Mirrors the key properties tested in
test/cel.test.js and test/cel-browser.test.js so the port's correctness
claim rests on the same evidence, not just the single pinned vector.
"""

import unittest

from cel import (
    canonicalize,
    create_receipt,
    current_epochs,
    derive_epoch,
    verify_receipt,
)

CTX = {"action": "comment.create", "resource": "/posts/123"}


class TestPinnedVector(unittest.TestCase):
    def test_pinned_interop_vector(self):
        receipt = create_receipt(
            depth=1, epoch="test-epoch", context={"action": "test", "resource": "/demo"}
        )
        self.assertEqual(receipt["root"], "wsHMq2Yz4WH9pQQn14lT4cLHNyMAxFUZ9cp6mh2S82s")
        self.assertTrue(verify_receipt(receipt, max_depth=1)["ok"])

    def test_canonicalize_test_vector(self):
        self.assertEqual(
            canonicalize({"b": [1, "x", None], "a": {"z": True, "y": 2}}),
            '{"a":{"y":2,"z":true},"b":[1,"x",null]}',
        )


class TestRoundtrip(unittest.TestCase):
    def test_prove_verify_roundtrip(self):
        receipt = create_receipt(depth=1000, epoch="test-epoch", context=CTX)
        self.assertEqual(receipt["version"], "cel/v0")
        self.assertEqual(receipt["algorithm"], "sha256")
        self.assertTrue(verify_receipt(receipt, max_depth=1000)["ok"])

    def test_sha512_roundtrip(self):
        receipt = create_receipt(depth=500, epoch="e", context=CTX, algorithm="sha512")
        self.assertEqual(receipt["algorithm"], "sha512")
        self.assertTrue(verify_receipt(receipt, max_depth=500)["ok"])

    def test_determinism(self):
        a = create_receipt(depth=500, epoch="e", context=CTX)
        b = create_receipt(depth=500, epoch="e", context=CTX)
        self.assertEqual(a["root"], b["root"])


class TestCanonicalization(unittest.TestCase):
    def test_key_order_does_not_matter(self):
        a = create_receipt(depth=100, epoch="e", context={"a": 1, "b": 2})
        b = create_receipt(depth=100, epoch="e", context={"b": 2, "a": 1})
        self.assertEqual(a["root"], b["root"])

    def test_string_context_used_raw(self):
        receipt = create_receipt(depth=100, epoch="e", context="hello")
        self.assertTrue(
            verify_receipt(receipt, max_depth=100, required_context="hello")["ok"]
        )

    def test_bool_is_not_treated_as_int(self):
        # Python's bool is an int subclass; True must canonicalize as `true`,
        # not `1`, or a JS peer sending {"flag": true} would produce a
        # different root than this port sending {"flag": True}.
        self.assertEqual(canonicalize({"flag": True}), '{"flag":true}')
        self.assertNotEqual(canonicalize({"flag": True}), canonicalize({"flag": 1}))

    def test_float_whole_numbers_match_js_json_stringify(self):
        # JSON.stringify(1.0) === "1" in JS since there is no int/float
        # distinction; this port must agree even though Python does
        # distinguish 1 and 1.0.
        self.assertEqual(canonicalize(1.0), "1")
        self.assertEqual(canonicalize(1), "1")

    def test_non_finite_numbers_rejected(self):
        with self.assertRaises(ValueError):
            canonicalize(float("inf"))
        with self.assertRaises(ValueError):
            canonicalize(float("nan"))

    def test_unsafe_integer_rejected(self):
        with self.assertRaises(ValueError):
            canonicalize(2**60)

    def test_utf16_sort_order_matches_js_not_codepoint_order(self):
        # U+FFFF (BMP, private-use-adjacent) vs U+10000 (first char outside
        # the BMP). By raw code point, U+10000 > U+FFFF. But JS compares by
        # UTF-16 code unit: U+10000 is encoded as the surrogate pair
        # (0xD800, 0xDC00), and 0xD800 < 0xFFFF, so JS sorts U+10000 BEFORE
        # U+FFFF - the opposite of code-point order. This is the exact
        # cross-language hazard docs/protocol.md calls out.
        keys_codepoint_order = sorted(["￿", "\U00010000"])
        self.assertEqual(keys_codepoint_order, ["￿", "\U00010000"])  # Python's default

        result = canonicalize({"￿": 1, "\U00010000": 2})
        # JS puts \U00010000 first because its lead surrogate (0xD800) sorts
        # below ￿ (0xFFFF) as a bare code unit. Cross-checked directly
        # against cel.js's own canonicalize({'￿': 1, '\u{10000}': 2}),
        # which produces this exact string - note neither character is
        # \u-escaped, since JSON.stringify only escapes control characters,
        # quotes, and backslashes, not non-ASCII text.
        self.assertEqual(result, '{"𐀀":2,"￿":1}')


class TestTamperDetection(unittest.TestCase):
    def test_tampered_root_fails(self):
        receipt = create_receipt(depth=200, epoch="e", context=CTX)
        bad = {**receipt, "root": receipt["root"][:-2] + "AA"}
        self.assertFalse(verify_receipt(bad, max_depth=200)["ok"])

    def test_tampered_context_fails(self):
        receipt = create_receipt(depth=200, epoch="e", context=CTX)
        bad = {**receipt, "context": {**CTX, "resource": "/posts/999"}}
        self.assertFalse(verify_receipt(bad, max_depth=200)["ok"])

    def test_tampered_depth_fails(self):
        receipt = create_receipt(depth=200, epoch="e", context=CTX)
        bad = {**receipt, "depth": 100}
        self.assertFalse(verify_receipt(bad, max_depth=200)["ok"])


class TestPolicyEnforcement(unittest.TestCase):
    def test_max_depth_enforced(self):
        receipt = create_receipt(depth=200, epoch="e", context=CTX)
        result = verify_receipt(receipt, max_depth=100)
        self.assertFalse(result["ok"])
        self.assertIn("exceeds maxDepth", result["error"])

    def test_non_array_allowed_epochs_rejected_not_substring_matched(self):
        receipt = create_receipt(depth=50, epoch="e1", context=CTX)
        for bad in ["e1x", "e1", {}, 42]:
            result = verify_receipt(receipt, max_depth=50, allowed_epochs=bad)
            self.assertFalse(result["ok"])
            self.assertIn("must be an array", result["error"])

    def test_required_context_is_strict_whole_match_not_partial(self):
        receipt = create_receipt(depth=50, epoch="e", context=CTX)
        # A subset context must NOT match.
        result = verify_receipt(
            receipt, max_depth=50, required_context={"action": "comment.create"}
        )
        self.assertFalse(result["ok"])

    def test_wrong_digest_length_rejected(self):
        r256 = create_receipt(depth=10, epoch="e", context=CTX)
        r512 = create_receipt(depth=10, epoch="e", context=CTX, algorithm="sha512")
        bad = {**r256, "root": r512["root"]}
        result = verify_receipt(bad, max_depth=10)
        self.assertFalse(result["ok"])
        self.assertIn("wrong length", result["error"])

    def test_non_canonical_base64url_root_rejected(self):
        receipt = create_receipt(depth=1, epoch="e", context={"a": 1})
        b64url_chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        original = receipt["root"][-1]
        idx = b64url_chars.index(original)
        # idx+1 shares the same data bits but sets a padding bit -
        # deterministically non-canonical, not a random substitution that
        # might just as easily hit "root mismatch" instead.
        bad_char = b64url_chars[idx + 1]
        bad = {**receipt, "root": receipt["root"][:-1] + bad_char}
        result = verify_receipt(bad, max_depth=1)
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "root is not canonical base64url")


class TestEpochs(unittest.TestCase):
    def test_derive_epoch_format(self):
        e = derive_epoch(window_seconds=300, now_ms=1_700_000_000_000)
        self.assertEqual(e, f"cel:300:{1_700_000_000 // 300}")

    def test_current_epochs_adjacency(self):
        cur, prev = current_epochs(window_seconds=300, now_ms=1_700_000_000_000)
        self.assertEqual(int(cur.split(":")[2]) - int(prev.split(":")[2]), 1)


class TestCrossLanguageVectors(unittest.TestCase):
    """
    Additional vectors with non-ASCII and structurally nested contexts,
    computed independently in this port, meant to be cross-checked against
    src/cel.js output for the same inputs (see interop note in the
    accompanying summary).
    """

    def test_nested_context_with_unicode(self):
        receipt = create_receipt(
            depth=3,
            epoch="cel-test",
            context={"a": 1, "b": [True, None, "x"], "nested": {"z": 2, "y": "sé"}},
        )
        self.assertTrue(verify_receipt(receipt, max_depth=3)["ok"])
        print(f"\n  cross-check vector root: {receipt['root']}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
