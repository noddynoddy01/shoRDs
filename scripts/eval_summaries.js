#!/usr/bin/env node
"use strict";
/**
 * Score recorded summaries offline. No network, no model calls, no credentials.
 *   node scripts/eval_summaries.js cases.json [--allow-review] [--max-words N]
 * cases.json: [{ "id": "...", "license": "cc-by", "source": "...", "summary": "..." }, ...]
 * Exit status 1 when any admitted summary fails a check, so it can gate a change.
 */
const fs = require("node:fs");
const { runBenchmark } = require("../backend/eval/benchmark");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) { console.error("usage: node scripts/eval_summaries.js cases.json [--allow-review] [--max-words N]"); process.exit(2); }
const mw = args.indexOf("--max-words");
const limits = mw >= 0 ? { maxWords: Number(args[mw + 1]) } : undefined;
const cases = JSON.parse(fs.readFileSync(file, "utf8"));
const report = runBenchmark(cases, { allowReview: args.includes("--allow-review"), limits });
const { results, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
for (const r of results.filter((x) => !x.passed)) console.log(`FAIL ${r.id}: ${r.failures.join(", ")}${r.numbers.ungrounded.length ? " numbers=" + r.numbers.ungrounded.join(",") : ""}`);
process.exit(report.passed === report.evaluated ? 0 : 1);
