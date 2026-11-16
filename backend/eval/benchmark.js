"use strict";
/**
 * Summary evaluation runner. Takes cases of {id, paperId, license, source, summary}, admits only papers whose licence clearly
 * allows keeping the text in an evaluation set, scores each summary, and returns a report. It never calls a model: summaries to
 * score are supplied by the caller (recorded outputs), so running it costs nothing and is deterministic.
 */

const { evaluateSummary } = require("./summaryMetrics");
const { selectEvalCorpus } = require("../papers/licensePolicy");

const mean = (xs) => { const v = xs.filter((x) => typeof x === "number"); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1000) / 1000 : null; };

/**
 * @param {Array<{id:string, paperId?:string, license?:unknown, source:string, summary:string}>} cases
 * @param {{limits?:object, allowReview?:boolean}} [opts]
 */
function runBenchmark(cases, { limits, allowReview = false } = {}) {
  const gate = selectEvalCorpus(cases.map((c) => ({ paperId: c.id, license: c.license })), { allowReview });
  const admitted = new Set(gate.included.map((x) => x.paperId));
  const results = [];
  for (const c of cases) {
    if (!admitted.has(c.id)) continue;
    results.push({ id: c.id, ...evaluateSummary({ source: c.source, summary: c.summary }, limits) });
  }
  const failureCounts = {};
  for (const r of results) for (const f of r.failures) failureCounts[f] = (failureCounts[f] || 0) + 1;
  return {
    evaluated: results.length,
    excludedByLicence: gate.excluded,
    passed: results.filter((r) => r.passed).length,
    failureCounts,
    means: {
      novelBigrams: mean(results.map((r) => r.copy.novelBigrams)),
      longestVerbatimRun: mean(results.map((r) => r.copy.longestVerbatimRun)),
      wordCount: mean(results.map((r) => r.wordCount)),
      fleschKincaidGrade: mean(results.map((r) => r.readability.fleschKincaidGrade))
    },
    results
  };
}

module.exports = { runBenchmark };
