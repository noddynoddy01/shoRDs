"use strict";
/**
 * Tests of the three-system evaluation MACHINERY. Ratings used here are made up, labelled SYNTHETIC_NOT_EVIDENCE, and say nothing about any system.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../eval/nativeCompare");
const sb = require("../../eval/summaryBenchmark");

const sec = (txt, ev = ["p_chunk_1"]) => ({ inBrief: [{ text: txt, evidence: ev }], quantitativeResults: [{ text: "SAR reaches 87.4 percent accuracy.", evidence: ["p_chunk_2"] }] });
const items = Array.from({ length: 6 }, (_, i) => ({
  paperId: `doi:10.9/${i}`, title: `Paper ${i}`, link: `https://x.test/${i}`, license: "cc-by",
  systems: { A_claude_baseline: { sections: sec(`A summary ${i}`), passages: { p_chunk_1: "passage one", p_chunk_2: "passage two" } }, B_open_weight_direct: { sections: sec(`B summary ${i}`), passages: { p_chunk_1: "passage one", p_chunk_2: "passage two" } }, C_native_pipeline: { sections: sec(`C summary ${i}`), passages: { p_chunk_1: "passage one", p_chunk_2: "passage two" } } }
}));

test("plan: blinded (no system or model names), every rater gets every unit in a different order, same layout for all systems", () => {
  const plan = C.buildComparisonPlan(items, { raters: ["a", "b"], seed: 4, kind: "SYNTHETIC_NOT_EVIDENCE" });
  assert.equal(plan.unitCount, 18);
  const a = sb.parseCsv(plan.sheets.a), b = sb.parseCsv(plan.sheets.b);
  assert.equal(a.length, 18);
  assert.notDeepEqual(a.map((r) => r.unit_id), b.map((r) => r.unit_id));
  assert.deepEqual([...a.map((r) => r.unit_id)].sort(), [...b.map((r) => r.unit_id)].sort());
  const all = plan.sheets.a + plan.sheets.b;
  for (const leak of ["A_claude", "B_open", "C_native", "claude", "stub", "NATIVE_PROTOTYPE", "open-weight", "qwen", "gpt-oss"]) assert.ok(!all.toLowerCase().includes(leak.toLowerCase()), `sheet leaks "${leak}"`);
  for (const r of a) assert.match(r.summary_text, /^In Brief:\n/);
  assert.ok(Object.values(plan.key.units).every((u) => C.COMPARE_SYSTEMS.includes(u.system)));
  assert.deepEqual(plan.key.units, C.buildComparisonPlan(items, { raters: ["a", "b"], seed: 4, kind: "SYNTHETIC_NOT_EVIDENCE" }).key.units, "reproducible");
  assert.throws(() => C.buildComparisonPlan(items, { raters: ["only_one"] }));
  assert.equal(C.CRITERIA.length, 8);
});

test("licence: passages are not shown for a paper whose licence does not allow redistribution", () => {
  const it = [{ ...items[0], license: "cc-by-nc" }];
  const plan = C.buildComparisonPlan(it, { raters: ["a", "b"] });
  assert.ok(!plan.sheets.a.includes("passage one"));
  assert.match(plan.sheets.a, /does not allow showing the passages/);
});

function fakeRatings(plan, bias) {
  const out = {};
  for (const r of ["a", "b"]) out[r] = sb.parseCsv(plan.sheets[r]).map((row) => {
    const sys = plan.key.units[row.unit_id].system;
    const o = { unit_id: row.unit_id, failure_tags: "", notes: "" };
    C.CRITERIA.forEach((c, i) => { o[c.id] = String(Math.max(1, Math.min(5, 3 + (bias[sys] || 0) + ((i + row.unit_id.length + (r === "a" ? 0 : 1)) % 2)))); });
    return o;
  });
  return out;
}

test("analysis of SYNTHETIC ratings carries the label, computes per-system and paired results, and never issues a verdict", () => {
  const plan = C.buildComparisonPlan(items, { raters: ["a", "b"], seed: 2, kind: "SYNTHETIC_NOT_EVIDENCE" });
  const res = C.analyseComparison(plan.key, fakeRatings(plan, { C_native_pipeline: 1 }));
  assert.match(res.note, /NOT evidence/i);
  assert.equal(res.decision.verdict, "NOT_EVIDENCE_SYNTHETIC_DATA");
  assert.ok(res.perSystem.C_native_pipeline.overallMean > res.perSystem.A_claude_baseline.overallMean);
  assert.ok(res.comparisons.C_native_pipeline_minus_A_claude_baseline.factual_accuracy.mean > 0);
  assert.equal(res.unitsRated, 18);
  assert.ok(res.limitations.some((l) => /Length is a confound/.test(l)));
});

test("pre-declared decision rule: few papers, unreliable raters, unsafe increase, non-inferior and superior cases", () => {
  const ci = (low, mean) => ({ mean, low, high: mean + 0.4, n: 60 });
  const mk = (over = {}) => ({
    papers: 60, synthetic: false,
    agreement: { factual_accuracy: { reliable: true }, quantitative_accuracy: { reliable: true } },
    comparisons: { B_open_weight_direct_minus_A_claude_baseline: { factual_accuracy: ci(-0.1, 0.1), quantitative_accuracy: ci(-0.2, 0) }, C_native_pipeline_minus_A_claude_baseline: { factual_accuracy: ci(0.05, 0.3), quantitative_accuracy: ci(0.01, 0.2) } },
    perSystem: { A_claude_baseline: { factuallyUnsafe: { rate: 0.05 } }, B_open_weight_direct: { factuallyUnsafe: { rate: 0.06 } }, C_native_pipeline: { factuallyUnsafe: { rate: 0.04 } } }, ...over
  });
  const r = C.decide(mk());
  assert.equal(r.results.C_native_pipeline, "SUPERIOR_ON_ACCURACY"); assert.equal(r.results.B_open_weight_direct, "NON_INFERIOR_ON_ACCURACY");
  assert.equal(C.decide(mk({ papers: 20 })).results.C_native_pipeline, "NOT_SHOWN_TOO_FEW_PAPERS");
  assert.equal(C.decide(mk({ agreement: { factual_accuracy: { reliable: false }, quantitative_accuracy: { reliable: true } } })).results.C_native_pipeline, "NOT_SHOWN_RATERS_NOT_RELIABLE");
  assert.equal(C.decide(mk({ perSystem: { A_claude_baseline: { factuallyUnsafe: { rate: 0.02 } }, B_open_weight_direct: { factuallyUnsafe: { rate: 0.2 } }, C_native_pipeline: { factuallyUnsafe: { rate: 0.1 } } } })).results.C_native_pipeline, "NOT_ACCEPTABLE_MORE_UNSAFE_SUMMARIES");
  const worse = mk(); worse.comparisons.B_open_weight_direct_minus_A_claude_baseline.factual_accuracy = ci(-0.9, -0.5);
  assert.equal(C.decide(worse).results.B_open_weight_direct, "NOT_SHOWN_NON_INFERIOR");
  assert.equal(C.decide({ ...mk(), comparisons: {} }).results.C_native_pipeline, "NO_BASELINE_COMPARISON");
});

test("a longer summary is not a better one: nothing in the decision uses length", () => {
  const src = require("fs").readFileSync(require.resolve("../../eval/nativeCompare"), "utf8");
  const decideSrc = src.slice(src.indexOf("function decide"), src.indexOf("// -----", src.indexOf("function decide")));
  assert.ok(!/chars|length/i.test(decideSrc.replace(/papers < 50|\.length|lo\.some|lo\.every/g, "")), "decide() must not read summary length");
});

test("automatic metrics flag a number that is not in the passages it cites, identically for every system", () => {
  const chunks = [{ chunkId: "p_chunk_1", text: "SAR reaches 87.4 percent accuracy." }];
  const good = C.automaticMetrics({ inBrief: [{ text: "SAR reaches 87.4 percent accuracy.", evidence: ["p_chunk_1"] }] }, chunks);
  const bad = C.automaticMetrics({ inBrief: [{ text: "SAR reaches 89.4 percent accuracy.", evidence: ["p_chunk_1"] }, { text: "No source here.", evidence: [] }, { text: "Ghost 5 percent.", evidence: ["nope"] }] }, chunks);
  assert.equal(good.numericStatementsWithNumberNotInCitedText, 0);
  assert.equal(bad.numericStatementsWithNumberNotInCitedText, 2); assert.equal(bad.statementsWithoutCitation, 1); assert.equal(bad.statementsWithUnknownCitation, 1);
});

test("operational summary: cost is reported only when measured for every paper", () => {
  const runs = [{ system: "C_native_pipeline", totalMs: 100, costUsd: 0.1, tokens: { input: 10, output: 5 } }, { system: "C_native_pipeline", totalMs: 300, costUsd: null, tokens: { input: 30, output: 5 } }];
  const o = C.operationalSummary(runs).C_native_pipeline;
  assert.equal(o.costUsdPerPaper, null); assert.equal(o.costMeasuredFor, "1/2"); assert.equal(o.latencyMs.mean, 200);
});

test("intelligence -> nine sections mapping keeps citations and states what the production schema lacks", () => {
  const s = C.sectionsFromIntelligence({ tldr: { text: "T", evidence: ["c1"] }, limitations: [{ text: "L", evidence: ["c2"] }], quantitativeResults: [{ metric: "acc", value: "87.4%", context: "test", evidence: ["c3"] }] });
  assert.equal(s.inBrief[0].evidence[0], "c1"); assert.equal(s.limitations.length, 1); assert.match(s.quantitativeResults[0].text, /87\.4%/);
  assert.match(C.renderSections(s).text, /Why This Research Matters:\n {2}Unavailable\./);
});
