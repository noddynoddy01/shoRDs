"use strict";
/**
 * Tests of the benchmark MACHINERY (selection, blinding, agreement statistics). They use made-up ratings that are labelled
 * SYNTHETIC_NOT_EVIDENCE and say nothing about how good any summary is.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../../eval/summaryBenchmark");

const work = (n, license, extra = {}) => ({ id: `https://openalex.org/W${n}`, doi: `https://doi.org/10.9999/b.${n}`, title: `Paper ${n}`, publication_year: 2021, abstract_inverted_index: { Hello: [0] }, best_oa_location: { license, landing_page_url: `https://x.test/${n}` }, primary_topic: { field: { display_name: "Field" } }, ...extra });

test("candidates keep only works with a DOI, title, abstract and a recorded licence", () => {
  const res = { results: [work(1, "cc-by"), work(2, null), work(3, "cc-by", { doi: null }), work(4, "cc-by", { abstract_inverted_index: null }), work(5, "cc-by", { title: "" })] };
  const c = B.candidatesFromOpenAlex(res, "ml");
  assert.deepEqual(c.map((x) => x.paperId), ["doi:10.9999/b.1"]);
  assert.equal(c[0].license, "cc-by"); assert.equal(c[0].stratum, "ml");
  assert.deepEqual(B.candidatesFromOpenAlex(null, "x"), []);
});

test("selection is licence-gated, de-duplicated, stratified and reproducible", () => {
  const cands = [];
  const lic = ["cc-by", "cc0", "cc-by-nc", "cc-by-sa", "publisher-specific-oa", null, "cc-by-nd", "cc-by-nc-sa", "public-domain", "unknown-thing"];
  for (const s of ["bio", "ml", "phys", "soc"]) for (let i = 0; i < 20; i++) cands.push({ paperId: `doi:10.1/${s}${i}`, title: `${s}${i}`, license: lic[i % lic.length], stratum: s });
  cands.push({ ...cands[0] });
  const a = B.selectBenchmarkPapers(cands, { total: 12, seed: 7 });
  const b = B.selectBenchmarkPapers(cands, { total: 12, seed: 7 });
  const c = B.selectBenchmarkPapers(cands, { total: 12, seed: 8 });
  assert.deepEqual(a.selected.map((x) => x.paperId), b.selected.map((x) => x.paperId), "same seed, same draw");
  assert.notDeepEqual(a.selected.map((x) => x.paperId), c.selected.map((x) => x.paperId));
  assert.equal(a.selected.length, 12);
  for (const p of a.selected) assert.ok(["cc-by", "cc0", "public-domain", "cc-by-sa"].includes(p.licenseNormalised), `${p.paperId} ${p.license}`);
  assert.deepEqual(Object.values(a.perStratum), [3, 3, 3, 3], "no stratum dominates");
  assert.ok(a.excluded.some((x) => x.reason === "DUPLICATE"));
  assert.ok(a.excluded.some((x) => x.reason === "LICENSE_NO"), "NonCommercial / unknown are excluded");
  const withReview = B.selectBenchmarkPapers(cands, { total: 80, seed: 1, allowReview: true });
  assert.ok(withReview.selected.some((p) => p.licenseDecision === "review" && p.licenseNormalised === "cc-by-nd"), "no-derivatives only when review is allowed");
  assert.ok(!a.selected.some((p) => p.licenseNormalised === "cc-by-nd"), "...and not otherwise");
  assert.ok(!withReview.selected.some((p) => /nc/.test(p.licenseNormalised || "")), "NonCommercial is never selected");
  const small = B.selectBenchmarkPapers(cands.slice(0, 3), { total: 50 });
  assert.equal(small.shortfall > 0, true, "a shortfall is reported, not hidden");
});

test("weighted kappa: perfect, none, disagreement size matters, undefined case", () => {
  assert.equal(B.weightedKappa([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]).kappa, 1);
  assert.equal(B.weightedKappa([3, 3, 3], [3, 3, 3]).kappa, null, "undefined when nobody varies");
  const near = B.weightedKappa([1, 2, 3, 4, 5, 3, 2, 4], [2, 2, 3, 4, 4, 3, 3, 4]).kappa;
  const far = B.weightedKappa([1, 2, 3, 4, 5, 3, 2, 4], [5, 2, 3, 4, 1, 3, 4, 2]).kappa;
  assert.ok(near > far, `near=${near} far=${far}`);
  const w = B.weightedKappa([1, 5, 1, 5], [5, 1, 5, 1]);
  assert.ok(w.kappa < 0, "systematic opposition is negative");
  assert.throws(() => B.weightedKappa([1], [1, 2]));
  // hand-checked value: two raters, 2 items, ratings (1,1) and (5,4) on 1..5 scale -> exact .5, within-one 1
  const h = B.weightedKappa([1, 5], [1, 4]);
  assert.equal(h.exact, 0.5); assert.equal(h.withinOne, 1);
});

test("rating plan: blinded unit ids, different order per rater, systems only in the key, passages only when the licence allows", () => {
  const items = [1, 2, 3].map((n) => ({
    paperId: `doi:10.1/p${n}`, title: `P${n}`, link: `https://doi.org/10.1/p${n}`, license: n === 3 ? "cc-by-nc" : "cc-by",
    summaries: { device_brief: { text: `device text ${n}` }, backend_analysis: { text: `backend text ${n} [c1]`, passages: { c1: `SECRET PASSAGE ${n}` } } }
  }));
  items.push({ paperId: "doi:10.1/none", title: "no summaries", summaries: {} });
  const plan = B.buildRatingPlan(items, { raters: ["a", "b"], seed: 3, kind: "SYNTHETIC_NOT_EVIDENCE" });
  assert.equal(plan.unitCount, 6);
  assert.equal(Object.keys(plan.key.units).length, 6);
  const a = B.parseCsv(plan.sheets.a), b = B.parseCsv(plan.sheets.b);
  assert.equal(a.length, 6);
  assert.notDeepEqual(a.map((r) => r.unit_id), b.map((r) => r.unit_id), "a different order for each rater");
  assert.deepEqual(a.map((r) => r.unit_id).sort(), b.map((r) => r.unit_id).sort());
  for (const sheet of [plan.sheets.a, plan.sheets.b]) {
    assert.ok(!/device_brief|backend_analysis/.test(sheet), "the sheet never names the system");
  }
  const text = plan.sheets.a;
  assert.ok(text.includes("SECRET PASSAGE 1") && text.includes("SECRET PASSAGE 2"));
  assert.ok(!text.includes("SECRET PASSAGE 3"), "a NonCommercial paper's passages are not put in a sheet");
  assert.throws(() => B.buildRatingPlan(items, { raters: ["only"] }));
  // csv round trip with quotes, commas and newlines
  const rows = [{ unit_id: "U1", notes: 'He said "hi", twice\nnew line' }];
  assert.deepEqual(B.parseCsv(B.toCsv(rows, ["unit_id", "notes"])), rows);
  // text from papers or models must never be run as a spreadsheet formula
  const hostile = ['=HYPERLINK("http://evil.example","x")', "+1+1", "-2+3", "@SUM(A1)", "\tTAB", "plain", "3 = 3"];
  const back = B.parseCsv(B.toCsv(hostile.map((t) => ({ unit_id: "U", notes: t })), ["unit_id", "notes"]));
  hostile.forEach((t, i) => {
    if (/^[=+\-@\t]/.test(t)) assert.equal(back[i].notes, "'" + t, `formula-looking text is stored as text: ${t}`);
    else assert.equal(back[i].notes, t);
  });
});

function fakeRatings(plan, { fn }) {
  // fn(unitInfo, rater, criterion) -> 1..5
  const out = {};
  for (const r of plan.key.createdFor) {
    out[r] = B.parseCsv(plan.sheets[r]).map((row) => {
      const u = plan.key.units[row.unit_id];
      const o = { unit_id: row.unit_id, failure_tags: "", notes: "" };
      for (const c of B.CRITERIA) o[c.id] = fn(u, r, c.id);
      if (u.system === "device_brief") o.failure_tags = "MISSING_KEY_RESULT;GENERIC_FILLER";
      return o;
    });
  }
  return out;
}

test("analysis: agreement, per-system scores, paired comparison, failure tags, and the SYNTHETIC label", () => {
  const items = Array.from({ length: 24 }, (_, n) => ({ paperId: `doi:10.1/p${n}`, title: `P${n}`, license: "cc-by", summaries: { device_brief: { text: `d${n}` }, backend_analysis: { text: `b${n}` } } }));
  const plan = B.buildRatingPlan(items, { raters: ["a", "b"], seed: 5, kind: "SYNTHETIC_NOT_EVIDENCE" });
  let k = 0;
  const ratings = fakeRatings(plan, { fn: (u, r, c) => { k++; const base = u.system === "backend_analysis" ? 4 : 2; return Math.max(1, Math.min(5, base + ((k * 7 + (r === "b" ? 1 : 0)) % 3 === 0 ? 1 : 0))); } });
  const rep = B.analyseRatings(plan.key, ratings, { seed: 1 });
  assert.match(rep.note, /NOT evidence/);
  assert.equal(rep.unitsRated, 48); assert.equal(rep.papers, 24);
  assert.ok(rep.perSystem.backend_analysis.scores.factual_accuracy.mean > rep.perSystem.device_brief.scores.factual_accuracy.mean);
  const diff = rep.comparison.factual_accuracy.backendMinusDevice;
  assert.ok(diff.mean > 1 && diff.low > 0, JSON.stringify(diff));
  assert.equal(rep.perSystem.device_brief.failureTags.MISSING_KEY_RESULT, 24);
  assert.equal(rep.perSystem.backend_analysis.failureTags.MISSING_KEY_RESULT, undefined);
  assert.ok(rep.perSystem.device_brief.factuallyUnsafe.count >= 18, "most device units were given a factual accuracy of 2 by construction");
  assert.equal(rep.perSystem.backend_analysis.factuallyUnsafe.count, 0);
  for (const c of B.CRITERIA) assert.ok(c.id in rep.agreement);
  assert.deepEqual(rep.problems, []);
  assert.ok(rep.limitations.some((l) => /wide/.test(l)), "small samples are called out");
  const again = B.analyseRatings(plan.key, ratings, { seed: 1 });
  assert.deepEqual(again, rep, "deterministic");
});

test("analysis: bad input is reported, not silently scored", () => {
  const items = [{ paperId: "doi:10.1/a", title: "A", license: "cc-by", summaries: { device_brief: { text: "d" }, backend_analysis: { text: "b" } } }];
  const plan = B.buildRatingPlan(items, { raters: ["a", "b"], seed: 1, kind: "SYNTHETIC_NOT_EVIDENCE" });
  const good = fakeRatings(plan, { fn: () => 3 });
  good.a[0].factual_accuracy = "9";
  good.a[1].failure_tags = "NOT_A_TAG";
  good.b.push({ unit_id: "U9999", factual_accuracy: 3 });
  const rep = B.analyseRatings(plan.key, good);
  assert.ok(rep.problems.some((p) => /not an integer 1-5/.test(p)));
  assert.ok(rep.problems.some((p) => /unknown tag/.test(p)));
  assert.ok(rep.problems.some((p) => /unknown unit/.test(p)));
  assert.ok(rep.unitsMissingFromAtLeastOneRater >= 1, "an unscorable unit drops out and is counted");
  assert.throws(() => B.analyseRatings(plan.key, { a: [] }));
});

test("backend analysis rendering: every statement shows its evidence ids; passages only if supplied", () => {
  const intel = { tldr: { text: "It works.", evidence: ["c1"] }, limitations: [{ text: "Small sample.", evidence: [] }], quantitativeResults: [{ metric: "accuracy", value: "87.4 percent", context: "test set", evidence: ["c2"] }] };
  const r = B.renderIntelligenceText(intel, { c1: "P1", c2: "P2", c9: "unused" });
  assert.match(r.text, /In brief: It works\. \[c1\]/);
  assert.match(r.text, /Limitations: Small sample\. \[no source\]/);
  assert.match(r.text, /Result: accuracy: 87\.4 percent \(test set\) \[c2\]/);
  assert.deepEqual(r.passages, { c1: "P1", c2: "P2" });
  assert.deepEqual(B.renderIntelligenceText(intel).passages, {});
  assert.deepEqual(B.renderIntelligenceText(null), { text: "", passages: {} });
});
