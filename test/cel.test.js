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
  ALGORITHM
} from "../src/cel.js";

const CTX = { action: "comment.create", resource: "/posts/123" };

test("prove/verify roundtrip", () => {
  const receipt = createReceipt({ depth: 1000, epoch: "test-epoch", context: CTX });
  assert.equal(receipt.version, VERSION);
  assert.equal(receipt.algorithm, ALGORITHM);
  assert.equal(verifyReceipt(receipt, { maxDepth: 1000 }).ok, true);
});

test("determinism: same inputs produce same root", () => {
  const a = createReceipt({ depth: 500, epoch: "e", context: CTX });
  const b = createReceipt({ depth: 500, epoch: "e", context: CTX });
  assert.equal(a.root, b.root);
});

test("context key order does not matter (canonicalization)", () => {
  const a = createReceipt({ depth: 100, epoch: "e", context: { a: 1, b: 2 } });
  const b = createReceipt({ depth: 100, epoch: "e", context: { b: 2, a: 1 } });
  assert.equal(a.root, b.root);
});

test("tampered root fails", () => {
  const receipt = createReceipt({ depth: 200, epoch: "e", context: CTX });
  const bad = { ...receipt, root: receipt.root.slice(0, -2) + "AA" };
  const result = verifyReceipt(bad, { maxDepth: 200 });
  assert.equal(result.ok, false);
});

test("tampered context fails", () => {
  const receipt = createReceipt({ depth: 200, epoch: "e", context: CTX });
  const bad = { ...receipt, context: { ...CTX, resource: "/posts/999" } };
  assert.equal(verifyReceipt(bad, { maxDepth: 200 }).ok, false);
});

test("tampered depth fails", () => {
  const receipt = createReceipt({ depth: 200, epoch: "e", context: CTX });
  const bad = { ...receipt, depth: 100 };
  assert.equal(verifyReceipt(bad, { maxDepth: 200 }).ok, false);
});

test("tampered epoch fails", () => {
  const receipt = createReceipt({ depth: 200, epoch: "e1", context: CTX });
  const bad = { ...receipt, epoch: "e2" };
  assert.equal(verifyReceipt(bad, { maxDepth: 200 }).ok, false);
});

test("maxDepth is enforced before recomputation", () => {
  const receipt = createReceipt({ depth: 200, epoch: "e", context: CTX });
  const result = verifyReceipt(receipt, { maxDepth: 100 });
  assert.equal(result.ok, false);
  assert.match(result.error, /exceeds maxDepth/);
});

test("verifier must set maxDepth", () => {
  const receipt = createReceipt({ depth: 10, epoch: "e", context: CTX });
  assert.equal(verifyReceipt(receipt).ok, false);
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

test("invalid receipts are rejected cheaply", () => {
  assert.equal(verifyReceipt(null, { maxDepth: 10 }).ok, false);
  assert.equal(verifyReceipt({}, { maxDepth: 10 }).ok, false);
  assert.equal(
    verifyReceipt({ version: "bogus", algorithm: ALGORITHM, depth: 1, epoch: "e", context: {}, root: "x" }, { maxDepth: 10 }).ok,
    false
  );
  assert.equal(
    verifyReceipt({ version: VERSION, algorithm: ALGORITHM, depth: -5, epoch: "e", context: {}, root: "x" }, { maxDepth: 10 }).ok,
    false
  );
});

test("createReceipt validates inputs", () => {
  assert.throws(() => createReceipt({ depth: 0, epoch: "e", context: {} }), RangeError);
  assert.throws(() => createReceipt({ depth: 1.5, epoch: "e", context: {} }), RangeError);
  assert.throws(() => createReceipt({ depth: 10, epoch: "", context: {} }), TypeError);
  assert.throws(() => createReceipt({ depth: 10, epoch: "e", context: { x: Infinity } }), TypeError);
});

test("deriveEpoch format and currentEpochs adjacency", () => {
  const e = deriveEpoch({ windowSeconds: 300, nowMs: 1_700_000_000_000 });
  assert.equal(e, `cel:300:${Math.floor(1_700_000_000 / 300)}`);
  const [cur, prev] = currentEpochs({ windowSeconds: 300, nowMs: 1_700_000_000_000 });
  const curN = Number(cur.split(":")[2]);
  const prevN = Number(prev.split(":")[2]);
  assert.equal(curN - prevN, 1);
});

test("createChallenge produces provable challenge", () => {
  const ch = createChallenge({ depth: 100, action: "agent.message", resource: "/api/agent" });
  const receipt = createReceipt({ depth: ch.depth, epoch: ch.epoch, context: ch.context });
  assert.equal(verifyReceipt(receipt, { maxDepth: 100, requiredEpoch: ch.epoch }).ok, true);
});

test("canonicalize test vector", () => {
  assert.equal(canonicalize({ b: [1, "x", null], a: { z: true, y: 2 } }),
    '{"a":{"y":2,"z":true},"b":[1,"x",null]}');
});

test("pinned interop test vectors (docs/protocol.md)", () => {
  const v1 = createReceipt({ depth: 3, epoch: "cel-test", context: { action: "vector" } });
  assert.equal(v1.root, "SUa6CzV6VNZnDfweGuysAn6xy8t5KjCaU7g3ApFCB1g");
  assert.equal(v1.root.length, 43); // 32 bytes base64url, no padding
  const v2 = createReceipt({ depth: 10000, epoch: "cel-test", context: { action: "vector" } });
  assert.equal(v2.root, "mgEA_H5SuqfxzcjpgMfavrEb0_URx7Wl8UCPFedtg30");
});
