#!/usr/bin/env node
/**
 * CEL command-line tool.
 *
 * Commands:
 *   epoch     --window-seconds 300
 *   challenge --depth N --action X --resource Y [--window-seconds 300]
 *   prove     --depth N --epoch E --context JSON-or-string
 *   verify    --receipt file.json --max-depth N [--epoch E] [--window-seconds S]
 *   bench     --depth N
 */

import { readFileSync, writeFileSync } from "node:fs";
import {
  createReceipt,
  verifyReceipt,
  deriveEpoch,
  currentEpochs,
  createChallenge
} from "./cel.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function parseContext(raw) {
  if (raw === undefined) return {};
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"')) {
    // Looks like intended JSON: a typo here must not silently become a
    // string context, or the prover burns real compute on a receipt that
    // can never verify against the intended object context.
    try {
      return JSON.parse(raw);
    } catch (err) {
      console.error(`error: --context looks like JSON but failed to parse: ${err.message}`);
      console.error("hint: fix the JSON, or pass a plain string that does not start with {, [ or \"");
      process.exit(2);
    }
  }
  try {
    return JSON.parse(raw); // numbers, true/false, null
  } catch {
    return raw; // plain string context
  }
}

function requireInt(args, name) {
  // args[name] is `true` when the flag was passed without a value;
  // Number(true) === 1, which must not silently become a valid depth.
  if (typeof args[name] !== "string") {
    console.error(`error: --${name} requires an integer value`);
    process.exit(2);
  }
  const v = Number(args[name]);
  if (!Number.isSafeInteger(v) || v < 1) {
    console.error(`error: --${name} must be a positive integer`);
    process.exit(2);
  }
  return v;
}

/**
 * Per-command flag whitelist. Unknown flags are rejected rather than
 * ignored: a typo like --contex would otherwise silently prove against
 * the default {} context, burning compute on a useless receipt.
 */
const COMMAND_FLAGS = {
  epoch: ["window-seconds"],
  challenge: ["depth", "action", "resource", "window-seconds"],
  prove: ["depth", "epoch", "context", "algorithm", "output"],
  verify: ["receipt", "max-depth", "epoch", "window-seconds", "context", "action", "resource"],
  bench: ["depth"]
};

function validateFlags(command, args) {
  const allowed = new Set([...(COMMAND_FLAGS[command] ?? []), "help", "version"]);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) {
      console.error(`error: unknown flag --${key} for '${command}'`);
      console.error(`allowed flags: ${(COMMAND_FLAGS[command] ?? []).map((f) => "--" + f).join(", ") || "(none)"}`);
      process.exit(2);
    }
  }
}

function usage() {
  console.log(`usage:
  cel epoch     [--window-seconds 300]
  cel challenge --depth N --action X [--resource Y] [--window-seconds 300]
  cel prove     --depth N --epoch E [--context JSON-or-string] [--algorithm sha256|sha512] [--output file.json]
  cel verify    --receipt file.json --max-depth N [--epoch E] [--window-seconds S]
                [--context JSON-or-string] [--action X] [--resource Y]
  cel bench     [--depth 100000]

notes:
  verify --epoch E           requires the receipt epoch to equal E exactly
  verify --window-seconds S  accepts the current OR previous S-second window
                             (use one or the other, not both)
  verify --context C         requires the receipt context to match C exactly
  verify --action/--resource require those individual context fields to match
                             (tolerates extra fields such as a nonce)

examples:
  cel epoch
  cel challenge --depth 10000 --action agent.message --resource /api/agent
  cel prove --depth 10000 --epoch cel:300:5941344 --context '{"action":"test"}' --output receipt.json
  cel verify --receipt receipt.json --max-depth 10000 --window-seconds 300
  cel bench --depth 100000`);
}

function version() {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  console.log(pkg.version);
}

const [, , command, ...rest] = process.argv;
const args = parseArgs(rest);

if (command === "--version" || command === "-v" || args.version === true) {
  version();
  process.exit(0);
}
if (command === "help" || command === "--help" || command === "-h" || args.help === true) {
  usage();
  process.exit(0);
}

if (Object.hasOwn(COMMAND_FLAGS, command ?? "")) {
  validateFlags(command, args);
}

try {
switch (command) {
  case "epoch": {
    const windowSeconds = args["window-seconds"] ? requireInt(args, "window-seconds") : 300;
    console.log(deriveEpoch({ windowSeconds }));
    break;
  }

  case "challenge": {
    const depth = requireInt(args, "depth");
    const windowSeconds = args["window-seconds"] ? requireInt(args, "window-seconds") : 300;
    const challenge = createChallenge({
      depth,
      windowSeconds,
      action: args.action ?? "unspecified",
      resource: args.resource ?? "/"
    });
    console.log(JSON.stringify(challenge, null, 2));
    break;
  }

  case "prove": {
    const depth = requireInt(args, "depth");
    if (typeof args.epoch !== "string") {
      console.error("error: --epoch is required");
      process.exit(2);
    }
    const context = parseContext(args.context);
    const algorithm = typeof args.algorithm === "string" ? args.algorithm : undefined;
    if (algorithm !== undefined && algorithm !== "sha256" && algorithm !== "sha512") {
      console.error("error: --algorithm must be sha256 or sha512");
      process.exit(2);
    }
    const receipt = createReceipt({ depth, epoch: args.epoch, context, algorithm });
    const json = JSON.stringify(receipt, null, 2);
    if (typeof args.output === "string") {
      try {
        writeFileSync(args.output, json + "\n");
      } catch (err) {
        console.error(`error: could not write ${args.output}: ${err.message}`);
        process.exit(2);
      }
      console.error(`wrote receipt to ${args.output}`);
    } else {
      console.log(json);
    }
    console.error(`proved depth=${depth} in ${receipt.elapsedMs} ms`);
    break;
  }

  case "verify": {
    if (typeof args.receipt !== "string") {
      console.error("error: --receipt is required");
      process.exit(2);
    }
    const maxDepth = requireInt(args, "max-depth");
    let receipt;
    try {
      receipt = JSON.parse(readFileSync(args.receipt, "utf8"));
    } catch (err) {
      console.error(`error: could not read ${args.receipt}: ${err.message}`);
      process.exit(2);
    }
    if (typeof args.epoch === "string" && args["window-seconds"] !== undefined) {
      console.error("error: use either --epoch or --window-seconds, not both");
      process.exit(2);
    }
    const opts = { maxDepth };
    if (typeof args.epoch === "string") {
      opts.requiredEpoch = args.epoch;
    } else if (args["window-seconds"]) {
      opts.allowedEpochs = currentEpochs({
        windowSeconds: requireInt(args, "window-seconds")
      });
    }
    if (typeof args.context === "string") {
      opts.requiredContext = parseContext(args.context);
    }
    // Individual field checks tolerate extra context fields (e.g. a nonce).
    for (const field of ["action", "resource"]) {
      if (typeof args[field] === "string" && receipt?.context?.[field] !== args[field]) {
        console.error(`invalid: context ${field} mismatch`);
        process.exit(1);
      }
    }
    const t0 = process.hrtime.bigint();
    const result = verifyReceipt(receipt, opts);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (result.ok) {
      console.log(`ok (verified depth=${receipt.depth} in ${ms.toFixed(1)} ms)`);
    } else {
      console.error(`invalid: ${result.error}`);
      process.exit(1);
    }
    break;
  }

  case "bench": {
    const depth = args.depth ? requireInt(args, "depth") : 100000;
    const epoch = deriveEpoch();
    const steps = [...new Set([Math.floor(depth / 100), Math.floor(depth / 10), depth].filter((d) => d >= 1))];
    for (const d of steps) {
      const t0 = process.hrtime.bigint();
      createReceipt({ depth: d, epoch, context: { bench: true } });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      console.log(`depth=${d}\t${ms.toFixed(1)} ms\t${(d / ms * 1000).toFixed(0)} steps/s`);
    }
    break;
  }

  default:
    usage();
    process.exit(command ? 2 : 0);
}
} catch (err) {
  // User-input errors from the core API (oversized epoch/context, bad
  // window values, ...) surface as friendly messages, not stack traces.
  console.error(`error: ${err.message}`);
  process.exit(2);
}
