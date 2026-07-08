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

import { readFileSync } from "node:fs";
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
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // treat as plain string context
  }
}

function requireInt(args, name) {
  const v = Number(args[name]);
  if (!Number.isInteger(v)) {
    console.error(`error: --${name} must be an integer`);
    process.exit(2);
  }
  return v;
}

function usage() {
  console.log(`usage:
  cel epoch     [--window-seconds 300]
  cel challenge --depth N --action X [--resource Y] [--window-seconds 300]
  cel prove     --depth N --epoch E [--context JSON-or-string]
  cel verify    --receipt file.json --max-depth N [--epoch E] [--window-seconds S]
  cel bench     [--depth 100000]`);
}

const [, , command, ...rest] = process.argv;
const args = parseArgs(rest);

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
    const t0 = process.hrtime.bigint();
    const receipt = createReceipt({ depth, epoch: args.epoch, context });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(JSON.stringify(receipt, null, 2));
    console.error(`proved depth=${depth} in ${ms.toFixed(1)} ms`);
    break;
  }

  case "verify": {
    if (typeof args.receipt !== "string") {
      console.error("error: --receipt is required");
      process.exit(2);
    }
    const maxDepth = requireInt(args, "max-depth");
    const receipt = JSON.parse(readFileSync(args.receipt, "utf8"));
    const opts = { maxDepth };
    if (typeof args.epoch === "string") {
      opts.requiredEpoch = args.epoch;
    } else if (args["window-seconds"]) {
      opts.allowedEpochs = currentEpochs({
        windowSeconds: requireInt(args, "window-seconds")
      });
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
    for (const d of [Math.floor(depth / 100), Math.floor(depth / 10), depth]) {
      if (d < 1) continue;
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
