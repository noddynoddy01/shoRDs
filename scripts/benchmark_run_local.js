#!/usr/bin/env node
"use strict";
/**
 * PAID STEP. Runs the benchmark's backend analyses on THIS machine with the key in THIS process's environment.
 * Read docs/ops/BENCHMARK_PREPARATION_2026-11-04.md first. It refuses to run unless every gate in backend/eval/benchmarkRun.js passes.
 *
 *   node scripts/benchmark_run_local.js --selected benchmark/candidates.json --record benchmark/selection_record.csv \
 *        --out benchmark/run1 --limit 3 --max-usd 3 --depth STANDARD --confirm-spend
 *
 * Environment (set by the owner in their own shell; never in a file the repo tracks, never pasted into chat):
 *   DATABASE_URL, REDIS_URL        local throwaway Postgres and Redis (localhost only)
 *   ANTHROPIC_API_KEY              the owner's key, with a spending limit set in the Anthropic Console first
 *   AI_CACHE_ENABLED=false         every paper must be a real, measured call
 *   BENCHMARK_RAW_CAPTURE=1  BENCHMARK_RAW_CAPTURE_DIR=<absolute path>   keeps the raw model output locally for the F1 review
 */
const fs = require("node:fs");
const path = require("node:path");
const R = require("../backend/eval/benchmarkRun");

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);
const die = (m, code = 2) => { console.error(m); process.exit(code); };

async function main() {
  const opts = { maxUsd: Number(flag("max-usd", "NaN")), limit: Number(flag("limit", "3")), depth: flag("depth", "STANDARD"), confirmSpend: has("confirm-spend") };
  const selectedFile = flag("selected");
  const recordFile = flag("record");
  const outDir = flag("out");
  if (!selectedFile || !recordFile || !outDir) die("usage: benchmark_run_local.js --selected candidates.json --record selection_record.csv --out DIR [--limit 3] --max-usd N --depth STANDARD --confirm-spend");
  R.checkOptions(opts);
  R.assertLocalEnvironment(process.env);
  const { eligible, skipped } = R.eligiblePapers(JSON.parse(fs.readFileSync(selectedFile, "utf8")), fs.readFileSync(recordFile, "utf8"));
  if (skipped.length) console.log(`Not run (${skipped.length}): ` + skipped.slice(0, 10).map((s) => `${s.paperId} ${s.reason}`).join("; ") + (skipped.length > 10 ? "; ..." : ""));
  if (!eligible.length) die("No paper has a person-confirmed licence in the selection record. Nothing was run and nothing was spent.");

  const { estimateMaxCost } = require("../backend/llm/aiBudget");
  const { resolveProfile, resolveModelConfig } = require("../backend/llm/anthropicClient");
  const I = require("../backend/llm/intelligence");
  const dflt = require("../backend/llm/evidence").DEFAULT_MAX_CONTEXT_CHARS;
  const model = resolveModelConfig(process.env).model;
  const profile = resolveProfile(opts.depth);
  const user = "x".repeat(dflt + 80 * 160 + 400);
  const worstCaseUsd = estimateMaxCost({ model, system: I.SYSTEM_PROMPT, user, maxTokens: profile.maxTokens, attempts: 2, env: process.env }).reservationMicro / 1e6; // what the spend gate itself reserves

  const { createRuntime } = require("../backend/runtime");
  const runtime = createRuntime(process.env, { logger: { log() {}, warn() {}, error: console.error, info() {}, debug() {} } });
  try {
    await runtime.startBackground(); // applies migrations to the LOCAL database
    console.log(`Model ${model}, depth ${opts.depth}. Ceiling $${opts.maxUsd}; worst case reserved per paper $${worstCaseUsd.toFixed(2)}; up to ${opts.limit} papers.`);
    const report = await R.runPilot({ pipeline: runtime.pipeline, papers: eligible, maxUsd: opts.maxUsd, limit: opts.limit, depth: opts.depth, worstCaseUsd, outDir, captureDir: process.env.BENCHMARK_RAW_CAPTURE_DIR });
    console.log("\n" + JSON.stringify(report, null, 2));
    console.log("\nSTOP. Report the spent amount to the owner and compare it with the Anthropic Console usage page before running more.");
  } finally {
    await runtime.shutdown(2000);
  }
}
main().catch((e) => die(`${e.name}: ${e.message}`, e.code === "NO_CONFIRM" || e.name === "BenchmarkRunError" ? 2 : 1));
