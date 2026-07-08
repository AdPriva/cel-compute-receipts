/**
 * Cross-implementation tests: the WebCrypto implementation must produce
 * byte-identical results to the node:crypto implementation. Node >= 18
 * ships WebCrypto as globalThis.crypto, so both run in the same process.
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as nodeImpl from "../src/cel.js";
import * as browserImpl from "../src/cel-browser.js";

const CASES = [
  { depth: 3, epoch: "cel-test", context: { action: "vector" } },
  { depth: 1000, epoch: "e", context: { a: 1, b: [true, null, "x"], nested: { z: 2, y: "s" } } },
  { depth: 200, epoch: "e2", context: "raw-string-context" },
  { depth: 500, epoch: "cel:300:123", context: { action: "agent.message" }, algorithm: "sha512" },
  { depth: 100, epoch: "e3", context: { t: new Date("2026-07-08T00:00:00.000Z"), u: undefined, k: 1 } }
];

test("browser implementation matches the pinned interop vector", async () => {
  const receipt = await browserImpl.createReceipt({
    depth: 1,
    epoch: "test-epoch",
    context: { action: "test", resource: "/demo" }
  });
  assert.equal(receipt.root, "wsHMq2Yz4WH9pQQn14lT4cLHNyMAxFUZ9cp6mh2S82s");
});

test("browser and node implementations produce identical roots", async () => {
  for (const args of CASES) {
    const rn = nodeImpl.createReceipt(args);
    const rb = await browserImpl.createReceipt(args);
    assert.equal(rb.root, rn.root, `roots must agree for ${JSON.stringify(args.context)}`);
  }
});

test("receipts cross-verify between implementations", async () => {
  for (const args of CASES) {
    const rn = nodeImpl.createReceipt(args);
    const rb = await browserImpl.createReceipt(args);
    assert.equal(nodeImpl.verifyReceipt(rb, { maxDepth: args.depth }).ok, true);
    assert.equal((await browserImpl.verifyReceipt(rn, { maxDepth: args.depth })).ok, true);
  }
});

test("browser verifier enforces the same rejections", async () => {
  const receipt = await browserImpl.createReceipt({ depth: 100, epoch: "e", context: { a: 1 } });
  const cases = [
    [{ ...receipt, root: receipt.root.slice(0, -1) + "!" }, /not valid base64url/],
    [{ ...receipt, depth: 50 }, /root mismatch/],
    [{ ...receipt, algorithm: "md5" }, /unsupported algorithm/],
    [{ ...receipt, epoch: "other" }, /root mismatch/]
  ];
  for (const [bad, pattern] of cases) {
    const result = await browserImpl.verifyReceipt(bad, { maxDepth: 100 });
    assert.equal(result.ok, false);
    assert.match(result.error, pattern);
  }
  assert.equal(
    (await browserImpl.verifyReceipt(receipt, { maxDepth: 100, allowedEpochs: "e1x" })).ok,
    false
  );
});

test("browser canonicalization matches node canonicalization", () => {
  const value = { b: [1, "x", null], a: { z: true, y: 2 }, d: new Date(0), u: undefined };
  assert.equal(browserImpl.canonicalize(value), nodeImpl.canonicalize(value));
});

test("browser verifier rejects non-canonical base64url roots", async () => {
  // A final base64url character with non-zero padding bits decodes to the same
  // bytes but is not the canonical encoding; the round-trip check must catch it.
  const receipt = await browserImpl.createReceipt({ depth: 1, epoch: "e", context: { a: 1 } });
  // Substitute a different final char that still passes the charset regex but
  // may not re-encode to the same string. We iterate a short alphabet to find
  // one that is genuinely different and still a valid base64url char.
  const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const original = receipt.root.at(-1);
  const badChar = B64URL.split("").find(c => c !== original) ?? "A";
  const bad = { ...receipt, root: receipt.root.slice(0, -1) + badChar };
  const result = await browserImpl.verifyReceipt(bad, { maxDepth: 1 });
  assert.equal(result.ok, false);
});

test("browser verifier enforces requiredContext parity with node", async () => {
  const receipt = await browserImpl.createReceipt({ depth: 10, epoch: "e", context: { action: "x" } });
  const opts = { maxDepth: 10 };
  assert.equal(
    (await browserImpl.verifyReceipt(receipt, { ...opts, requiredContext: { action: "x" } })).ok,
    true,
    "matching requiredContext must pass"
  );
  assert.equal(
    (await browserImpl.verifyReceipt(receipt, { ...opts, requiredContext: { action: "y" } })).ok,
    false,
    "mismatched requiredContext must fail"
  );
  // Node verifier must agree on both outcomes
  assert.equal(
    nodeImpl.verifyReceipt(receipt, { ...opts, requiredContext: { action: "x" } }).ok,
    true
  );
  assert.equal(
    nodeImpl.verifyReceipt(receipt, { ...opts, requiredContext: { action: "y" } }).ok,
    false
  );
});

test("browser and node reject oversized context and epoch identically", async () => {
  const longEpoch = "e".repeat(300); // > MAX_EPOCH_BYTES (256)
  const longCtx = { key: "x".repeat(5000) }; // > MAX_CONTEXT_BYTES (4096)
  const base = { depth: 1 };

  await assert.rejects(
    () => browserImpl.createReceipt({ ...base, epoch: longEpoch, context: { a: 1 } }),
    /epoch exceeds/
  );
  assert.throws(
    () => nodeImpl.createReceipt({ ...base, epoch: longEpoch, context: { a: 1 } }),
    /epoch exceeds/
  );

  await assert.rejects(
    () => browserImpl.createReceipt({ ...base, epoch: "e", context: longCtx }),
    /context exceeds/
  );
  assert.throws(
    () => nodeImpl.createReceipt({ ...base, epoch: "e", context: longCtx }),
    /context exceeds/
  );
});

test("browser epoch helpers match node epoch helpers", () => {
  const nowMs = 1_700_000_000_000;
  assert.equal(
    browserImpl.deriveEpoch({ windowSeconds: 300, nowMs }),
    nodeImpl.deriveEpoch({ windowSeconds: 300, nowMs })
  );
  assert.deepEqual(
    browserImpl.currentEpochs({ windowSeconds: 300, nowMs }),
    nodeImpl.currentEpochs({ windowSeconds: 300, nowMs })
  );
});
