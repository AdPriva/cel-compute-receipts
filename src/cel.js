/**
 * CEL - Computational Effort Layer (v0 reference implementation)
 *
 * Compute receipts: work-bound artifacts that show a client spent a defined
 * amount of sequential computation for a specific action.
 *
 * This is experimental research code. See SECURITY.md and docs/threat-model.md
 * before deploying anything. Byte-level behavior is specified in
 * docs/protocol.md; the pinned test vectors there are normative.
 *
 * No runtime dependencies. Node.js >= 18.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const VERSION = "cel/v0";
export const DEFAULT_ALGORITHM = "sha256";

/** Supported hash algorithms and their digest sizes in bytes. */
export const ALGORITHMS = {
  sha256: 32,
  sha512: 64
};

/**
 * Default verifier depth ceiling. Applications should set a much lower
 * maxDepth for interactive or unauthenticated traffic.
 */
export const DEFAULT_MAX_DEPTH = 5_000_000;

const MAX_CONTEXT_BYTES = 4096;
const MAX_EPOCH_BYTES = 256;

/* ------------------------------------------------------------------ */
/* Encoding helpers                                                    */
/* ------------------------------------------------------------------ */

function hash(algorithm, ...buffers) {
  const h = createHash(algorithm);
  for (const b of buffers) h.update(b);
  return h.digest();
}

function uint64be(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(n));
  return buf;
}

/**
 * frame(x) = uint64be(byte_length(x)) || utf8(x)
 *
 * Length-prefixed framing prevents ambiguity when concatenating fields
 * into the seed derivation.
 */
function frame(str) {
  const bytes = Buffer.from(str, "utf8");
  return Buffer.concat([uint64be(bytes.length), bytes]);
}

/**
 * Deterministic JSON canonicalization:
 * - object keys sorted lexicographically at every level
 * - arrays preserve order
 * - numbers must be finite
 * - object fields with undefined values are omitted
 * - Date values are serialized to ISO 8601 strings
 * - functions, symbols, and bigints are rejected
 */
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
    if (value[k] === undefined) continue; // omitted, like JSON.stringify
    parts.push(JSON.stringify(k) + ":" + canonicalize(value[k]));
  }
  return "{" + parts.join(",") + "}";
}

/**
 * Context bytes input per protocol: raw string if the context is a string,
 * canonical JSON otherwise.
 */
function contextInput(context) {
  return typeof context === "string" ? context : canonicalize(context);
}

function base64url(buf) {
  return buf.toString("base64url");
}

/* ------------------------------------------------------------------ */
/* Core assembly                                                       */
/* ------------------------------------------------------------------ */

/**
 * Derive the seed:
 *   s0 = H(frame(policy) || frame(epoch) || frame(context_input))
 * where policy = canonical JSON of { algorithm, depth, version }.
 */
function deriveSeed({ algorithm, depth, epoch, ctxInput }) {
  const policy = canonicalize({ algorithm, depth, version: VERSION });
  return hash(algorithm, frame(policy), frame(epoch), frame(ctxInput));
}

/**
 * Run the sequential hash assembly:
 *   for i in 1..depth:
 *     e_i = H(s_(i-1) || uint64be(i))
 *     s_i = H(s_(i-1) || e_i)
 * Returns s_depth.
 */
function assemble(algorithm, seed, depth) {
  let s = seed;
  for (let i = 1; i <= depth; i++) {
    const e = hash(algorithm, s, uint64be(i));
    s = hash(algorithm, s, e);
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
  if (Buffer.byteLength(epoch, "utf8") > MAX_EPOCH_BYTES) {
    throw new RangeError(`epoch exceeds ${MAX_EPOCH_BYTES} bytes`);
  }
}

function checkContextSize(ctxInput) {
  if (Buffer.byteLength(ctxInput, "utf8") > MAX_CONTEXT_BYTES) {
    throw new RangeError(`context exceeds ${MAX_CONTEXT_BYTES} bytes`);
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Create a compute receipt.
 *
 * @param {object} opts
 * @param {number} opts.depth       sequential depth (positive safe integer)
 * @param {string} opts.epoch       opaque validity-window identifier
 * @param {*}      opts.context     application context (string used raw, other
 *                                  JSON values canonicalized)
 * @param {string} [opts.algorithm] "sha256" (default) or "sha512"
 * @returns {object} receipt (includes informational elapsedMs)
 */
export function createReceipt({ depth, epoch, context, algorithm = DEFAULT_ALGORITHM }) {
  checkAlgorithm(algorithm);
  checkDepth(depth);
  checkEpoch(epoch);
  const ctxInput = contextInput(context);
  checkContextSize(ctxInput);

  const t0 = process.hrtime.bigint();
  const seed = deriveSeed({ algorithm, depth, epoch, ctxInput });
  const root = assemble(algorithm, seed, depth);
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

  return {
    version: VERSION,
    algorithm,
    depth,
    epoch,
    context,
    root: base64url(root),
    elapsedMs: Math.round(elapsedMs * 100) / 100
  };
}

/**
 * Verify a compute receipt by direct recomputation (Mode A).
 *
 * WARNING: verification cost is linear in receipt.depth. Always pass a strict
 * maxDepth (the default ceiling is DEFAULT_MAX_DEPTH) and reject
 * malformed/oversized requests before calling this.
 *
 * `elapsedMs` and unknown extra fields on the receipt are informational and
 * ignored; they are not part of the root derivation.
 *
 * @param {object} receipt
 * @param {object} [opts]
 * @param {number}   [opts.maxDepth=DEFAULT_MAX_DEPTH] reject deeper receipts
 * @param {string}   [opts.requiredEpoch]   if set, receipt.epoch must equal it
 * @param {string[]} [opts.allowedEpochs]   if set, receipt.epoch must be in it
 * @param {*}        [opts.requiredContext] if set, context input must match
 * @returns {{ ok: boolean, error?: string }}
 */
export function verifyReceipt(receipt, opts = {}) {
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
  if (Buffer.byteLength(receipt.epoch, "utf8") > MAX_EPOCH_BYTES) {
    return { ok: false, error: "epoch too large" };
  }
  if (requiredEpoch !== undefined && receipt.epoch !== requiredEpoch) {
    return { ok: false, error: "epoch mismatch" };
  }
  if (allowedEpochs !== undefined && !allowedEpochs.includes(receipt.epoch)) {
    return { ok: false, error: "epoch not in allowed set" };
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
    if (contextInput(requiredContext) !== ctxInput) {
      return { ok: false, error: "context mismatch" };
    }
  }

  let claimed;
  try {
    claimed = Buffer.from(receipt.root, "base64url");
  } catch {
    return { ok: false, error: "root is not valid base64url" };
  }
  if (claimed.length !== ALGORITHMS[receipt.algorithm]) {
    return { ok: false, error: "root has wrong length for algorithm" };
  }

  const seed = deriveSeed({
    algorithm: receipt.algorithm,
    depth: receipt.depth,
    epoch: receipt.epoch,
    ctxInput
  });
  const expected = assemble(receipt.algorithm, seed, receipt.depth);

  if (!timingSafeEqual(expected, claimed)) {
    return { ok: false, error: "root mismatch" };
  }
  return { ok: true };
}

/**
 * Derive an epoch string from a time window:
 *   cel:<window_seconds>:<window_number>
 * where window_number = floor(unix_timestamp_seconds / window_seconds).
 *
 * @param {object} [opts]
 * @param {number} [opts.windowSeconds=300]
 * @param {number} [opts.nowMs=Date.now()]
 */
export function deriveEpoch({ windowSeconds = 300, nowMs = Date.now() } = {}) {
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new RangeError("windowSeconds must be a positive integer");
  }
  const windowNumber = Math.floor(nowMs / 1000 / windowSeconds);
  return `cel:${windowSeconds}:${windowNumber}`;
}

/**
 * Current and previous epoch for a window — the usual verifier allow-set,
 * so receipts created just before a window boundary still verify.
 */
export function currentEpochs({ windowSeconds = 300, nowMs = Date.now() } = {}) {
  const current = deriveEpoch({ windowSeconds, nowMs });
  const previous = deriveEpoch({ windowSeconds, nowMs: nowMs - windowSeconds * 1000 });
  return [current, previous];
}

/**
 * Build a challenge object a server can hand to clients.
 */
export function createChallenge({
  depth,
  windowSeconds = 300,
  action,
  resource,
  algorithm = DEFAULT_ALGORITHM,
  extra = {}
}) {
  checkAlgorithm(algorithm);
  checkDepth(depth);
  return {
    version: VERSION,
    algorithm,
    depth,
    epoch: deriveEpoch({ windowSeconds }),
    context: { action, resource, ...extra }
  };
}
