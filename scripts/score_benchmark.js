#!/usr/bin/env node
"use strict";
/**
 * Score the faithfulness evaluator against a rated benchmark file. Offline: no network, no model calls.
 *   node scripts/score_benchmark.js docs/evaluation/benchmark/dev_fixture.json
 */
const fs = require("node:fs");
const { scoreBenchmark } = require("../backend/eval/benchmarkScoring");

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/score_benchmark.js benchmark.json"); process.exit(2); }
scoreBenchmark(JSON.parse(fs.readFileSync(file, "utf8"))).then((r) => {
  if (r.kind !== "HUMAN_RATED") console.log(`NOTE: this file is "${r.kind}". The figures below are NOT evidence of accuracy on real summaries.\n`);
  const { confusion, disagreements, ...rest } = r;
  console.log(JSON.stringify(rest, null, 2));
  console.log("\nconfusion (rows = reference, columns = evaluator)"); console.table(confusion.matrix);
  if (disagreements.length) { console.log("\ndisagreements:"); for (const d of disagreements) console.log(`  [${d.item}] ref=${d.reference} got=${d.evaluator} flags=${d.flags.join(",") || "-"} | ${d.claim}`); }
});
