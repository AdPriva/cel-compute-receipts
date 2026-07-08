/**
 * CEL - Computational Effort Layer (v0 reference implementation)
 *
 * Compute receipts: work-bound artifacts that show a client spent a defined
 * amount of sequential computation for a specific action.
 *
 * This is experimental research code. See SECURITY.md and docs/threat-model.md
 * before deploying anything.
 *
 * No runtime dependencies. Node.js >= 18.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const VERSION = "cel/v0";
export const ALGORITHM = "sha256";

const HASH_BYTES = 32;
const MAX_CONTEXT_BYTES = 4096;
const MAX_EPOCH_BYTES = 256;

/* ------------------------------------------------------------------ */
/* Encoding helpers                                                    */
/* ------------------------------------------------------------------ */

function sha256(...buffers) {
  const h = createHash("sha256");
  for (const b of buffers) h.update(b);
  return h.digest();
}

function uint64be(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(n));
  return buf;
}

/**
 * frame(x) = uint32be(byteLength(x)) || utf8(x)
 *
 * Length-prefixed framing prevents ambiguity when concatenating fields
 * into the seed derivation.
 */
function frame(str) {
  const bytes = Buffer.from(str, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(bytes.length);
  return Buffer.concat([len, bytes]);
}

/**
 * Deterministic JSON canonicalization: object keys sorted lexicographically
 * at every level, no whitespace, arrays preserved in order.
 * Strings, numbers, booleans and null pass through JSON.stringify.
 */
export function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("context numbers must be finite");
    }
    if (value === undefined) throw new TypeError("undefined is not allowed");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k]));
  return "{" + parts.join(",") + "}";
}

function base64url(buf) {
  return buf.toString("base64url");
}

/* ------------------------------------------------------------------ */
/* Core assembly                                                       */
/* ------------------------------------------------------------------ */

/**
 * Derive the seed:
 *   s0 = H(frame(policy) || frame(epoch) || frame(context))
 * where policy = canonical JSON of { algorithm, depth, version }.
 */
function deriveSeed({ depth, epoch, contextCanonical }) {
  const policy = canonicalize({ algorithm: ALGORITHM, depth, version: VERSION });
  return sha256(frame(policy), frame(epoch), frame(contextCanonical));
}

/**
 * Run the sequential hash assembly:
 *   for i in 1..depth:
 *     e_i = H(s_(i-1) || uint64be(i))
 *     s_i = H(s_(i-1) || e_i)
 * Returns s_depth.
 */
function assemble(seed, depth) {
  let s = seed;
  for (let i = 1; i <= depth; i++) {
    const e = sha256(s, uint64be(i));
    s = sha256(s, e);
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function checkDepth(depth) {
  if (!Number.isInteger(depth) || depth < 1 || depth > Number.MAX_SAFE_INTEGER) {
    throw new RangeError("depth must be a positive integer");
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

function checkContext(contextCanonical) {
  if (Buffer.byteLength(contextCanonical, "utf8") > MAX_CONTEXT_BYTES) {
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
 * @param {number} opts.depth   sequential depth (positive integer)
 * @param {string} opts.epoch   opaque validity-window identifier
 * @param {*}      opts.context application context (any JSON value)
 * @returns {object} receipt
 */
export function createReceipt({ depth, epoch, context }) {
  checkDepth(depth);
  checkEpoch(epoch);
  const contextCanonical = canonicalize(context);
  checkContext(contextCanonical);

  const seed = deriveSeed({ depth, epoch, contextCanonical });
  const root = assemble(seed, depth);

  return {
    version: VERSION,
    algorithm: ALGORITHM,
    depth,
    epoch,
    context,
    root: base64url(root)
  };
}

/**
 * Verify a compute receipt by direct recomputation (Mode A).
 *
 * WARNING: verification cost is linear in receipt.depth. Always pass a strict
 * maxDepth and reject malformed/oversized requests before calling this.
 *
 * @param {object} receipt
 * @param {object} opts
 * @param {number} opts.maxDepth          reject receipts deeper than this (required)
 * @param {string} [opts.requiredEpoch]   if set, receipt.epoch must equal it
 * @param {string[]} [opts.allowedEpochs] if set, receipt.epoch must be in it
 * @param {*}      [opts.requiredContext] if set, canonical context must match
 * @returns {{ ok: boolean, error?: string }}
 */
export function verifyReceipt(receipt, opts = {}) {
  const { maxDepth, requiredEpoch, allowedEpochs, requiredContext } = opts;

  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    return { ok: false, error: "verifier must set a positive integer maxDepth" };
  }
  if (receipt === null || typeof receipt !== "object") {
    return { ok: false, error: "receipt must be an object" };
  }
  if (receipt.version !== VERSION) {
    return { ok: false, error: `unsupported version (expected ${VERSION})` };
  }
  if (receipt.algorithm !== ALGORITHM) {
    return { ok: false, error: `unsupported algorithm (expected ${ALGORITHM})` };
  }
  if (!Number.isInteger(receipt.depth) || receipt.depth < 1) {
    return { ok: false, error: "depth must be a positive integer" };
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
  if (typeof receipt.root !== "string") {
    return { ok: false, error: "root must be a base64url string" };
  }

  let contextCanonical;
  try {
    contextCanonical = canonicalize(receipt.context);
    checkContext(contextCanonical);
  } catch (err) {
    return { ok: false, error: `invalid context: ${err.message}` };
  }

  if (requiredContext !== undefined) {
    if (canonicalize(requiredContext) !== contextCanonical) {
      return { ok: false, error: "context mismatch" };
    }
  }

  let claimed;
  try {
    claimed = Buffer.from(receipt.root, "base64url");
  } catch {
    return { ok: false, error: "root is not valid base64url" };
  }
  if (claimed.length !== HASH_BYTES) {
    return { ok: false, error: "root has wrong length" };
  }

  const seed = deriveSeed({
    depth: receipt.depth,
    epoch: receipt.epoch,
    contextCanonical
  });
  const expected = assemble(seed, receipt.depth);

  if (!timingSafeEqual(expected, claimed)) {
    return { ok: false, error: "root mismatch" };
  }
  return { ok: true };
}

/**
 * Derive an epoch string from a time window:
 *   cel:<window_seconds>:<window_number>
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
export function createChallenge({ depth, windowSeconds = 300, action, resource, extra = {} }) {
  checkDepth(depth);
  return {
    version: VERSION,
    algorithm: ALGORITHM,
    depth,
    epoch: deriveEpoch({ windowSeconds }),
    context: { action, resource, ...extra }
  };
}
