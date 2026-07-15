import test from "node:test";
import assert from "node:assert/strict";
import {
  createReceipt,
  verifyReceipt,
  deriveEpoch,
  currentEpochs,
  createChallenge,
  canonicalize,
  VERSION,
  DEFAULT_ALGORITHM,
  DEFAULT_MAX_DEPTH
} from "../src/cel.js";

const CTX = { action: "comment.create", resource: "/posts/123" };

/* ------------------------------------------------------------------ */
/* Core roundtrip and determinism                                      */
/* ------------------------------------------------------------------ */

test("prove/verify roundtrip", () => {
  const receipt = createReceipt({ depth: 1000, epoch: "test-epoch", context: CTX });
  assert.equal(receipt.version, VERSION);
  assert.equal(receipt.algorithm, DEFAULT_ALGORITHM);
  assert.equal(typeof receipt.elapsedMs, "number");
  assert.equal(verifyReceipt(receipt, { maxDepth: 1000 }).ok, true);
});

test("sha512 roundtrip", () => {
  const receipt = createReceipt({ depth: 500, epoch: "e", context: CTX, algorithm: "sha512" });
  assert.equal(receipt.algorithm, "sha512");
  assert.equal(Buffer.from(receipt.root, "base64url").length, 64);
  assert.equal(verifyReceipt(receipt, { maxDepth: 500 }).ok, true);
});

test("determinism: same inputs produce same root", () => {
  const a = createReceipt({ depth: 500, epoch: "e", context: CTX });
  const b = createReceipt({ depth: 500, epoch: "e", context: CTX });
  assert.equal(a.root, b.root);
});

test("sha256 and sha512 roots differ for same inputs", () => {
  const a = createReceipt({ depth: 100, epoch: "e", context: CTX });
  const b = createReceipt({ depth: 100, epoch: "e", context: CTX, algorithm: "sha512" });
  assert.notEqual(a.root, b.root);
});

/* ------------------------------------------------------------------ */
/* Canonicalization and context handling                               */
/* ------------------------------------------------------------------ */

test("context key order does not matter (canonicalization)", () => {
  const a = createReceipt({ depth: 100, epoch: "e", context: { a: 1, b: 2 } });
  const b = createReceipt({ depth: 100, epoch: "e", context: { b: 2, a: 1 } });
  assert.equal(a.root, b.root);
});

test("string context is used raw", () => {
  const receipt = createReceipt({ depth: 100, epoch: "e", context: "hello" });
  assert.equal(verifyReceipt(receipt, { maxDepth: 100, requiredContext: "hello" }).ok, true);
});

test("undefined object fields are omitted", () => {
  const a = createReceipt({ depth: 50, epoch: "e", context: { a: 1, b: undefined } });
  const b = createReceipt({ depth: 50, epoch: "e", context: { a: 1 } });
  assert.equal(a.root, b.root);
});

test("Date values serialize to ISO 8601 strings", () => {
  const d = new Date("2026-07-08T00:00:00.000Z");
  const a = createReceipt({ depth: 50, epoch: "e", context: { t: d } });
  const b = createReceipt({ depth: 50, epoch: "e", context: { t: "2026-07-08T00:00:00.000Z" } });
  assert.equal(a.root, b.root);
});

test("unsupported context values are rejected", () => {
  assert.throws(() => createReceipt({ depth: 10, epoch: "e", context: { f: () => 1 } }), TypeError);
  assert.throws(() => createReceipt({ depth: 10, epoch: "e", context: { n: 1n } }), TypeError);
  assert.throws(() => createReceipt({ depth: 10, epoch: "e", context: { x: Infinity } }), TypeError);
});

test("canonicalize test vector", () => {
  assert.equal(canonicalize({ b: [1, "x", null], a: { z: true, y: 2 } }),
    '{"a":{"y":2,"z":true},"b":[1,"x",null]}');
});

/* ------------------------------------------------------------------ */
/* Tamper detection                                                    */
/* ------------------------------------------------------------------ */

test("tampered root fails", () => {
  const receipt = createReceipt({ depth: 200, epoch: "e", context: CTX });
  const bad = { ...receipt, root: receipt.root.slice(0, -2) + "AA" };
  assert.equal(verifyReceipt(bad, { maxDepth: 200 }).ok, false);
});

test("tampered context fails", () => {
  const receipt = createReceipt({ depth: 200, epoch: "e", context: CTX });
  const bad = { ...receipt, context: { ...CTX, resource: "/posts/999" } };
  assert.equal(verifyReceipt(bad, { maxDepth: 200 }).ok, false);
});

test("tampered depth fails", () => {
  const receipt = createReceipt({ depth: 200, epoch: "e", context: CTX });
  assert.equal(verifyReceipt({ ...receipt, depth: 100 }, { maxDepth: 200 }).ok, false);
});

test("tampered epoch fails", () => {
  const receipt = createReceipt({ depth: 200, epoch: "e1", context: CTX });
  assert.equal(verifyReceipt({ ...receipt, epoch: "e2" }, { maxDepth: 200 }).ok, false);
});

test("tampered algorithm fails", () => {
  const receipt = createReceipt({ depth: 200, epoch: "e", context: CTX });
  const result = verifyReceipt({ ...receipt, algorithm: "sha512" }, { maxDepth: 200 });
  assert.equal(result.ok, false); // sha256 root has wrong length for sha512
});

/* ------------------------------------------------------------------ */
/* Verifier policy enforcement                                         */
/* ------------------------------------------------------------------ */

test("maxDepth is enforced before recomputation", () => {
  const receipt = createReceipt({ depth: 200, epoch: "e", context: CTX });
  const result = verifyReceipt(receipt, { maxDepth: 100 });
  assert.equal(result.ok, false);
  assert.match(result.error, /exceeds maxDepth/);
});

test("default maxDepth applies when unset", () => {
  const receipt = createReceipt({ depth: 10, epoch: "e", context: CTX });
  assert.equal(verifyReceipt(receipt).ok, true);
  const deep = { ...receipt, depth: DEFAULT_MAX_DEPTH + 1 };
  const result = verifyReceipt(deep);
  assert.equal(result.ok, false);
  assert.match(result.error, /exceeds maxDepth/);
});

test("non-array allowedEpochs is rejected, not substring-matched", () => {
  // A string here would use String.prototype.includes: allowedEpochs "e1x"
  // must NOT accept epoch "e1".
  const receipt = createReceipt({ depth: 50, epoch: "e1", context: CTX });
  for (const bad of ["e1x", "e1", {}, 42]) {
    const result = verifyReceipt(receipt, { maxDepth: 50, allowedEpochs: bad });
    assert.equal(result.ok, false, `allowedEpochs=${JSON.stringify(bad)} should fail`);
    assert.match(result.error, /must be an array/);
  }
});

test("deriveEpoch rejects non-finite nowMs", () => {
  for (const bad of [NaN, Infinity, "123", null]) {
    assert.throws(() => deriveEpoch({ windowSeconds: 300, nowMs: bad }), RangeError);
  }
});

test("createChallenge validates its inputs early", () => {
  assert.throws(() => createChallenge({ depth: 10, action: undefined }), TypeError);
  assert.throws(() => createChallenge({ depth: 10, action: "" }), TypeError);
  assert.throws(() => createChallenge({ depth: 10, action: "a", resource: 42 }), TypeError);
  assert.throws(() => createChallenge({ depth: 10, action: "a", extra: [1] }), TypeError);
  assert.throws(() => createChallenge({ depth: 10, action: "a", extra: { n: 1n } }), TypeError);
  assert.throws(() => createChallenge({ depth: 10, action: "a", extra: { pad: "x".repeat(5000) } }), RangeError);
  const ch = createChallenge({ depth: 10, action: "a" });
  assert.equal("resource" in ch.context, false); // omitted, not undefined
});

test("requiredEpoch and allowedEpochs", () => {
  const receipt = createReceipt({ depth: 50, epoch: "e1", context: CTX });
  assert.equal(verifyReceipt(receipt, { maxDepth: 50, requiredEpoch: "e1" }).ok, true);
  assert.equal(verifyReceipt(receipt, { maxDepth: 50, requiredEpoch: "e2" }).ok, false);
  assert.equal(verifyReceipt(receipt, { maxDepth: 50, allowedEpochs: ["e1", "e0"] }).ok, true);
  assert.equal(verifyReceipt(receipt, { maxDepth: 50, allowedEpochs: ["e2"] }).ok, false);
});

test("requiredContext binding", () => {
  const receipt = createReceipt({ depth: 50, epoch: "e", context: CTX });
  assert.equal(
    verifyReceipt(receipt, { maxDepth: 50, requiredContext: { resource: "/posts/123", action: "comment.create" } }).ok,
    true
  );
  assert.equal(
    verifyReceipt(receipt, { maxDepth: 50, requiredContext: { action: "other" } }).ok,
    false
  );
});

test("requiredContext is a strict whole-context match, not partial", () => {
  // A subset context must NOT match: if it did, a receipt bound to one
  // resource could satisfy a verifier that only names the action.
  const receipt = createReceipt({ depth: 50, epoch: "e", context: CTX });
  assert.equal(
    verifyReceipt(receipt, { maxDepth: 50, requiredContext: { action: "comment.create" } }).ok,
    false
  );
});

test("__proto__ in parsed JSON contexts is treated as a plain key", () => {
  // JSON.parse creates an own "__proto__" property (no setter fired);
  // canonicalize serializes it like any other key, and the roundtrip
  // verifies without polluting Object.prototype.
  const payload = JSON.parse('{"__proto__":{"polluted":true},"a":1}');
  const receipt = createReceipt({ depth: 10, epoch: "e", context: payload });
  assert.equal(verifyReceipt(receipt, { maxDepth: 10 }).ok, true);
  assert.equal({}.polluted, undefined);
});

/* ------------------------------------------------------------------ */
/* Malformed input rejection                                           */
/* ------------------------------------------------------------------ */

test("invalid receipts are rejected cheaply", () => {
  assert.equal(verifyReceipt(null, { maxDepth: 10 }).ok, false);
  assert.equal(verifyReceipt({}, { maxDepth: 10 }).ok, false);
  assert.equal(
    verifyReceipt({ version: "bogus", algorithm: "sha256", depth: 1, epoch: "e", context: {}, root: "x" }, { maxDepth: 10 }).ok,
    false
  );
  assert.equal(
    verifyReceipt({ version: VERSION, algorithm: "sha256", depth: -5, epoch: "e", context: {}, root: "x" }, { maxDepth: 10 }).ok,
    false
  );
});

test("unsupported algorithm is rejected", () => {
  const receipt = createReceipt({ depth: 10, epoch: "e", context: CTX });
  for (const algorithm of ["md5", "sha1", "", 42, null]) {
    const result = verifyReceipt({ ...receipt, algorithm }, { maxDepth: 10 });
    assert.equal(result.ok, false, `algorithm=${JSON.stringify(algorithm)} should fail`);
  }
  assert.throws(() => createReceipt({ depth: 10, epoch: "e", context: CTX, algorithm: "md5" }), RangeError);
});

test("elapsedMs and unknown extra fields are ignored in verification", () => {
  const receipt = createReceipt({ depth: 100, epoch: "e", context: CTX });
  const extended = { ...receipt, elapsedMs: 99999, note: "ignored" };
  assert.equal(verifyReceipt(extended, { maxDepth: 100 }).ok, true);
});

test("malformed base64url root is rejected", () => {
  const receipt = createReceipt({ depth: 10, epoch: "e", context: CTX });
  for (const root of ["!!!invalid", "", "AAAA", 42, null]) {
    const result = verifyReceipt({ ...receipt, root }, { maxDepth: 10 });
    assert.equal(result.ok, false, `root=${JSON.stringify(root)} should fail`);
  }
});

test("non-canonical base64url roots are rejected", () => {
  const receipt = createReceipt({
    depth: 1,
    epoch: "test-epoch",
    context: { action: "test", resource: "/demo" }
  });
  // Node's Buffer.from(str, "base64url") silently accepts multiple final
  // characters that decode to the same bytes. The round-trip check must
  // catch them all — only the canonical encoding is accepted.
  const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const original = receipt.root.at(-1);
  const idx = B64URL.indexOf(original);
  // For a 32-byte digest, only alphabet indices that are multiples of 4 are
  // canonical (the last 2 bits of the final symbol are unused padding). idx+1
  // shares the same data bits but sets a padding bit, guaranteeing the same
  // decoded bytes with a non-canonical encoding — not an arbitrary substitution
  // that would just as likely hit "root mismatch" instead.
  const badChar = B64URL[idx + 1];
  const bad = { ...receipt, root: receipt.root.slice(0, -1) + badChar };
  const result = verifyReceipt(bad, { maxDepth: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.error, "root is not canonical base64url");
});

test("oversized context is rejected on both sides", () => {
  const big = { pad: "x".repeat(5000) }; // > 4096-byte canonical limit
  assert.throws(() => createReceipt({ depth: 10, epoch: "e", context: big }), RangeError);
  const receipt = createReceipt({ depth: 10, epoch: "e", context: CTX });
  const result = verifyReceipt({ ...receipt, context: big }, { maxDepth: 10 });
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid context/);
});

test("createReceipt validates inputs", () => {
  assert.throws(() => createReceipt({ depth: 0, epoch: "e", context: {} }), RangeError);
  assert.throws(() => createReceipt({ depth: 1.5, epoch: "e", context: {} }), RangeError);
  assert.throws(() => createReceipt({ depth: 10, epoch: "", context: {} }), TypeError);
});

test("unsafe integer depths are rejected on both sides", () => {
  // Beyond MAX_SAFE_INTEGER, depth loses precision and could trap the
  // verifier in an effectively unbounded loop; both sides refuse early.
  const unsafe = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => createReceipt({ depth: unsafe, epoch: "e", context: {} }), RangeError);
  const receipt = createReceipt({ depth: 10, epoch: "e", context: CTX });
  assert.equal(verifyReceipt({ ...receipt, depth: unsafe }, { maxDepth: unsafe }).ok, false);
});

/* ------------------------------------------------------------------ */
/* Epochs and challenges                                               */
/* ------------------------------------------------------------------ */

test("deriveEpoch format and currentEpochs adjacency", () => {
  const e = deriveEpoch({ windowSeconds: 300, nowMs: 1_700_000_000_000 });
  assert.equal(e, `cel:300:${Math.floor(1_700_000_000 / 300)}`);
  const [cur, prev] = currentEpochs({ windowSeconds: 300, nowMs: 1_700_000_000_000 });
  assert.equal(Number(cur.split(":")[2]) - Number(prev.split(":")[2]), 1);
});

test("deriveEpoch window boundaries are exact", () => {
  const windowMs = 300 * 1000;
  const endOfFirst = deriveEpoch({ windowSeconds: 300, nowMs: windowMs - 1 });
  const startOfSecond = deriveEpoch({ windowSeconds: 300, nowMs: windowMs });
  assert.notEqual(endOfFirst, startOfSecond);
  assert.equal(endOfFirst, "cel:300:0");
  assert.equal(startOfSecond, "cel:300:1");
});

test("createChallenge produces provable challenge", () => {
  const ch = createChallenge({ depth: 100, action: "agent.message", resource: "/api/agent" });
  const receipt = createReceipt({ depth: ch.depth, epoch: ch.epoch, context: ch.context });
  assert.equal(verifyReceipt(receipt, { maxDepth: 100, requiredEpoch: ch.epoch }).ok, true);
});

test("createChallenge preserves algorithm and extra context fields", () => {
  const ch = createChallenge({
    depth: 100,
    action: "agent.message",
    resource: "/api/agent",
    algorithm: "sha512",
    extra: { nonce: "abc-123", method: "POST" }
  });
  assert.equal(ch.algorithm, "sha512");
  assert.equal(ch.context.nonce, "abc-123");
  assert.equal(ch.context.method, "POST");
  const receipt = createReceipt({
    depth: ch.depth,
    epoch: ch.epoch,
    context: ch.context,
    algorithm: ch.algorithm
  });
  assert.equal(
    verifyReceipt(receipt, { maxDepth: 100, requiredEpoch: ch.epoch, requiredContext: ch.context }).ok,
    true
  );
});

test("invalid verifier-supplied requiredContext returns ok:false, not a throw", () => {
  const receipt = createReceipt({ depth: 50, epoch: "e", context: CTX });
  for (const bad of [{ x: Infinity }, { n: 1n }, { f: () => 1 }]) {
    let result;
    assert.doesNotThrow(() => { result = verifyReceipt(receipt, { maxDepth: 50, requiredContext: bad }); });
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid requiredContext/);
  }
});

test("wrong digest length for the algorithm is rejected explicitly", () => {
  const r256 = createReceipt({ depth: 10, epoch: "e", context: CTX });
  const r512 = createReceipt({ depth: 10, epoch: "e", context: CTX, algorithm: "sha512" });
  // Valid base64url, wrong length: sha256 receipt with a 64-byte root and
  // sha512 receipt with a 32-byte root.
  const swapped256 = { ...r256, root: r512.root };
  const swapped512 = { ...r512, root: r256.root };
  for (const bad of [swapped256, swapped512]) {
    const result = verifyReceipt(bad, { maxDepth: 10 });
    assert.equal(result.ok, false);
    assert.match(result.error, /wrong length/);
  }
});

/* ------------------------------------------------------------------ */
/* Pinned interop vector (normative, from docs/protocol.md)            */
/* ------------------------------------------------------------------ */

test("pinned interop test vector (docs/protocol.md)", () => {
  // sha256, depth=1, epoch="test-epoch", context={"action":"test","resource":"/demo"}
  const receipt = createReceipt({
    depth: 1,
    epoch: "test-epoch",
    context: { action: "test", resource: "/demo" }
  });
  assert.equal(receipt.root, "wsHMq2Yz4WH9pQQn14lT4cLHNyMAxFUZ9cp6mh2S82s");
  assert.equal(
    Buffer.from(receipt.root, "base64url").toString("hex"),
    "c2c1ccab6633e161fda50427d78953e1c2c7372300c45519f5ca7a9a1d92f36b"
  );
});
