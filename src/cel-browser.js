/**
 * CEL - Computational Effort Layer, WebCrypto implementation.
 *
 * Same protocol as src/cel.js (see docs/protocol.md), built on the Web
 * Crypto API instead of node:crypto. It runs in browsers and in Node.js >= 18.
 * The test suite asserts both implementations produce identical roots,
 * including the pinned interop vector.
 *
 * Differences from src/cel.js:
 *   - createReceipt() and verifyReceipt() are async (crypto.subtle is
 *     promise-based)
 *   - proving is slower than the Node implementation because each hash is
 *     an awaited call into crypto.subtle; fine for interactive depths
 *     (~10^4-10^5), not for benchmarking. A WASM prover is the roadmap
 *     answer for high-throughput clients.
 *
 * This file is standalone by design so it can be served to a browser
 * directly, with no bundler and no imports.
 */

export const VERSION = "cel/v0";
export const DEFAULT_ALGORITHM = "sha256";

/** Supported algorithms: digest size in bytes and WebCrypto identifier. */
export const ALGORITHMS = {
  sha256: { bytes: 32, subtle: "SHA-256" },
  sha512: { bytes: 64, subtle: "SHA-512" }
};

export const DEFAULT_MAX_DEPTH = 5_000_000;

const MAX_CONTEXT_BYTES = 4096;
const MAX_EPOCH_BYTES = 256;

const encoder = new TextEncoder();
let nodeSubtlePromise;

/* ------------------------------------------------------------------ */
/* Encoding helpers                                                    */
/* ------------------------------------------------------------------ */

function concat(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

async function hash(algorithm, ...arrays) {
  const subtle = await getSubtle();
  const digest = await subtle.digest(ALGORITHMS[algorithm].subtle, concat(...arrays));
  return new Uint8Array(digest);
}

async function getSubtle() {
  if (globalThis.crypto?.subtle) return globalThis.crypto.subtle;
  if (typeof process !== "undefined" && process.versions?.node) {
    nodeSubtlePromise ??= import("node:crypto").then(({ webcrypto }) => webcrypto.subtle);
    return nodeSubtlePromise;
  }
  throw new ReferenceError("WebCrypto API is not available in this runtime");
}

function uint64be(n) {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(n));
  return buf;
}

/** frame(x) = uint64be(byte_length(x)) || utf8(x) */
function frame(str) {
  const bytes = encoder.encode(str);
  return concat(uint64be(bytes.length), bytes);
}

const B64URL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64url(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64URL_CHARS[b0 >> 2];
    out += B64URL_CHARS[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    if (b1 !== undefined) out += B64URL_CHARS[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    if (b2 !== undefined) out += B64URL_CHARS[b2 & 63];
  }
  return out;
}

function base64urlDecode(str) {
  const out = new Uint8Array(Math.floor((str.length * 3) / 4));
  let bits = 0, bitCount = 0, index = 0;
  for (const ch of str) {
    const v = B64URL_CHARS.indexOf(ch);
    if (v === -1) throw new RangeError("invalid base64url character");
    bits = (bits << 6) | v;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      out[index++] = (bits >> bitCount) & 0xff;
    }
  }
  return out.subarray(0, index);
}

/** Constant-time comparison of two equal-length byte arrays. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/* Canonicalization (identical rules to src/cel.js)                    */
/* ------------------------------------------------------------------ */

export function canonicalize(value) {
  if (value === undefined) {
    throw new TypeError("undefined is not allowed as a context value");
  }
  const t = typeof value;
  if (t === "function" || t === "symbol" || t === "bigint") {
    throw new TypeError(`${t} values cannot be canonicalized`);
  }
  if (t === "number" && !Number.isFinite(value)) {
    throw new TypeError("context numbers must be finite");
  }
  if (value === null || t !== "object") {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  const parts = [];
  for (const k of keys) {
    if (value[k] === undefined) continue;
    parts.push(JSON.stringify(k) + ":" + canonicalize(value[k]));
  }
  return "{" + parts.join(",") + "}";
}

function contextInput(context) {
  return typeof context === "string" ? context : canonicalize(context);
}

/* ------------------------------------------------------------------ */
/* Core assembly                                                       */
/* ------------------------------------------------------------------ */

async function deriveSeed({ algorithm, depth, epoch, ctxInput }) {
  const policy = canonicalize({ algorithm, depth, version: VERSION });
  return hash(algorithm, frame(policy), frame(epoch), frame(ctxInput));
}

async function assemble(algorithm, seed, depth) {
  let s = seed;
  const indexBuffer = new Uint8Array(8);
  const indexView = new DataView(indexBuffer.buffer);
  for (let i = 1; i <= depth; i++) {
    indexView.setBigUint64(0, BigInt(i));
    const e = await hash(algorithm, s, indexBuffer);
    s = await hash(algorithm, s, e);
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function checkAlgorithm(algorithm) {
  if (!Object.hasOwn(ALGORITHMS, algorithm)) {
    throw new RangeError(`unsupported algorithm: ${algorithm}`);
  }
}

function checkDepth(depth) {
  if (!Number.isSafeInteger(depth) || depth < 1) {
    throw new RangeError("depth must be a positive safe integer");
  }
}

function checkEpoch(epoch) {
  if (typeof epoch !== "string" || epoch.length === 0) {
    throw new TypeError("epoch must be a non-empty string");
  }
  if (encoder.encode(epoch).length > MAX_EPOCH_BYTES) {
    throw new RangeError(`epoch exceeds ${MAX_EPOCH_BYTES} bytes`);
  }
}

function checkContextSize(ctxInput) {
  if (encoder.encode(ctxInput).length > MAX_CONTEXT_BYTES) {
    throw new RangeError(`context exceeds ${MAX_CONTEXT_BYTES} bytes`);
  }
}

/* ------------------------------------------------------------------ */
/* Public API (async where hashing is involved)                        */
/* ------------------------------------------------------------------ */

export async function createReceipt({ depth, epoch, context, algorithm = DEFAULT_ALGORITHM }) {
  checkAlgorithm(algorithm);
  checkDepth(depth);
  checkEpoch(epoch);
  const ctxInput = contextInput(context);
  checkContextSize(ctxInput);

  const t0 = (globalThis.performance ?? { now: Date.now.bind(Date) }).now();
  const seed = await deriveSeed({ algorithm, depth, epoch, ctxInput });
  const root = await assemble(algorithm, seed, depth);
  const t1 = (globalThis.performance ?? { now: Date.now.bind(Date) }).now();

  return {
    version: VERSION,
    algorithm,
    depth,
    epoch,
    context,
    root: base64url(root),
    elapsedMs: Math.round((t1 - t0) * 100) / 100
  };
}

export async function verifyReceipt(receipt, opts = {}) {
  const {
    maxDepth = DEFAULT_MAX_DEPTH,
    requiredEpoch,
    allowedEpochs,
    requiredContext
  } = opts;

  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) {
    return { ok: false, error: "maxDepth must be a positive safe integer" };
  }
  if (receipt === null || typeof receipt !== "object") {
    return { ok: false, error: "receipt must be an object" };
  }
  if (receipt.version !== VERSION) {
    return { ok: false, error: `unsupported version (expected ${VERSION})` };
  }
  if (typeof receipt.algorithm !== "string" || !Object.hasOwn(ALGORITHMS, receipt.algorithm)) {
    return { ok: false, error: "unsupported algorithm" };
  }
  if (!Number.isSafeInteger(receipt.depth) || receipt.depth < 1) {
    return { ok: false, error: "depth must be a positive safe integer" };
  }
  if (receipt.depth > maxDepth) {
    return { ok: false, error: `depth ${receipt.depth} exceeds maxDepth ${maxDepth}` };
  }
  if (typeof receipt.epoch !== "string" || receipt.epoch.length === 0) {
    return { ok: false, error: "epoch must be a non-empty string" };
  }
  if (encoder.encode(receipt.epoch).length > MAX_EPOCH_BYTES) {
    return { ok: false, error: "epoch too large" };
  }
  if (requiredEpoch !== undefined && receipt.epoch !== requiredEpoch) {
    return { ok: false, error: "epoch mismatch" };
  }
  if (allowedEpochs !== undefined) {
    if (!Array.isArray(allowedEpochs)) {
      return { ok: false, error: "allowedEpochs must be an array" };
    }
    if (!allowedEpochs.includes(receipt.epoch)) {
      return { ok: false, error: "epoch not in allowed set" };
    }
  }
  if (typeof receipt.root !== "string" || receipt.root.length === 0) {
    return { ok: false, error: "root must be a non-empty base64url string" };
  }

  let ctxInput;
  try {
    ctxInput = contextInput(receipt.context);
    checkContextSize(ctxInput);
  } catch (err) {
    return { ok: false, error: `invalid context: ${err.message}` };
  }

  if (requiredContext !== undefined) {
    let requiredInput;
    try {
      requiredInput = contextInput(requiredContext);
    } catch (err) {
      return { ok: false, error: `invalid requiredContext: ${err.message}` };
    }
    if (requiredInput !== ctxInput) {
      return { ok: false, error: "context mismatch" };
    }
  }

  if (!/^[A-Za-z0-9_-]+$/.test(receipt.root)) {
    return { ok: false, error: "root is not valid base64url" };
  }
  const claimed = base64urlDecode(receipt.root);
  if (claimed.length !== ALGORITHMS[receipt.algorithm].bytes) {
    return { ok: false, error: "root has wrong length for algorithm" };
  }

  const seed = await deriveSeed({
    algorithm: receipt.algorithm,
    depth: receipt.depth,
    epoch: receipt.epoch,
    ctxInput
  });
  const expected = await assemble(receipt.algorithm, seed, receipt.depth);

  if (!timingSafeEqual(expected, claimed)) {
    return { ok: false, error: "root mismatch" };
  }
  return { ok: true };
}

export function deriveEpoch({ windowSeconds = 300, nowMs = Date.now() } = {}) {
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new RangeError("windowSeconds must be a positive integer");
  }
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    throw new RangeError("nowMs must be a finite number");
  }
  const windowNumber = Math.floor(nowMs / 1000 / windowSeconds);
  return `cel:${windowSeconds}:${windowNumber}`;
}

export function currentEpochs({ windowSeconds = 300, nowMs = Date.now() } = {}) {
  const current = deriveEpoch({ windowSeconds, nowMs });
  const previous = deriveEpoch({ windowSeconds, nowMs: nowMs - windowSeconds * 1000 });
  return [current, previous];
}
