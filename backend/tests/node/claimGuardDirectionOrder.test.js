"use strict";
/**
 * Phase 6 regression tests for the claim guard (llm/claimGuard.js), INTEL_PROMPT_VERSION 2026.4-intel.
 *   F-5-1  direction reversal in third-person and -ing forms ("rises" against "falls")
 *   F-5-2  ordered numeric changes ("from X to Y", "X -> Y", "to Y from X") reported in the opposite order
 *
 * Every negative case (a statement that must be dropped) has a positive twin (the faithful statement that must still be kept), because a
 * guard that drops more is not better unless it keeps what is true. SYNTHETIC: fictional sentences written for these tests. They show what
 * the rules do on those sentences; they are not a measurement of false-drop or detection rates on real papers.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../../llm/claimGuard");
const { validateIntelligence } = require("../../llm/intelligence");

const verdict = (text, evidence, cites = ["c1"]) => {
  const chunks = [{ chunkId: "c1", text: evidence }];
  const r = g.checkStatement({ text, citedIds: cites, chunksById: new Map(chunks.map((c) => [c.chunkId, c])), index: g.buildEvidenceIndex(chunks) });
  return r.ok ? "KEPT" : `${r.reason}${typeof r.detail === "string" ? ":" + r.detail : ""}`;
};
const EV_LAT = "Latency falls from 41.2 seconds to 18.7 seconds per query.";

// ---- F-5-1: direction
const REVERSED = [
  ["Latency rises.", "Latency falls."],
  ["Throughput grows with batch size.", "Throughput shrinks with batch size."],
  ["The method raises the error rate.", "The method lowers the error rate."],
  ["Accuracy is rising on the held-out set.", "Accuracy is falling on the held-out set."],
  ["Error increases after epoch 10.", "Error decreases after epoch 10."],
  ["The model declines on long inputs.", "The model improves on long inputs."],
  ["Memory use climbs with context length.", "Memory use drops with context length."]
];
for (const [claim, evidence] of REVERSED) {
  test(`F-5-1 dropped: "${claim}" against "${evidence}"`, () => assert.equal(verdict(claim, evidence), "REVERSED_MEANING:DIRECTION"));
}
const FAITHFUL_SAME_SIDE = [
  ["Latency declines.", "Latency falls."],
  ["Latency drops.", "Latency falls."],
  ["Throughput increases with batch size.", "Throughput grows with batch size."],
  ["Throughput rises with batch size.", "Throughput grows with batch size."],
  ["The method lowers the error rate.", "The method reduces the error rate."],
  ["Accuracy is climbing on the held-out set.", "Accuracy is rising on the held-out set."],
  ["Latency falls.", "Latency falls."]
];
for (const [claim, evidence] of FAITHFUL_SAME_SIDE) {
  test(`F-5-1 kept (same direction, different word): "${claim}" against "${evidence}"`, () => assert.equal(verdict(claim, evidence), "KEPT"));
}
test("F-5-1: a direction word about a DIFFERENT subject is not a reversal (overlap is on the other words)", () => {
  assert.equal(verdict("Throughput rises.", "Latency falls."), "KEPT");
  assert.equal(verdict("Accuracy improves on the benchmark.", "Training time falls on the benchmark."), "KEPT");
});
test("F-5-1: a sentence that mentions both directions is left alone (the rule only judges one-sided sentences)", () => {
  assert.equal(verdict("Accuracy rises and latency falls.", "Accuracy falls and latency rises."), "KEPT", "documented remaining gap: mixed-direction sentences");
});
test("F-5-1: the direction words are the intended ones and the stems are derived from the same lists", () => {
  for (const w of ["rises", "falls", "grows", "shrinks", "raises", "lowers", "climbs", "declining", "boosted"]) assert.ok(g.DIRECTION_STEMS.has(g.stem(w)), w);
  assert.equal(g.directionConflict("Latency rises.", "Latency falls."), true);
  assert.equal(g.directionConflict("Latency rises.", "Latency grows."), false);
});

// ---- F-5-2: order
const SWAPPED = [
  ["Latency rises from 18.7 seconds to 41.2 seconds per query.", EV_LAT],
  ["Latency falls from 18.7 seconds to 41.2 seconds per query.", EV_LAT], // verb agrees with the evidence; only the numbers are swapped
  ["Latency fell from 18.7 to 41.2 seconds.", EV_LAT],
  ["Latency went to 41.2 seconds from 18.7 seconds.", EV_LAT],
  ["Latency: 18.7 -> 41.2 seconds.", "Latency: 41.2 -> 18.7 seconds."],
  ["Latency: 18.7 → 41.2 seconds.", "Latency: 41.2 → 18.7 seconds."],
  ["Accuracy rose to 71 percent from 78 percent.", "Accuracy rose to 78 percent from 71 percent."],
  ["Error improved from 9.1% to 12.4%.", "Error improved from 12.4% to 9.1%."],
  ["The score changed from -3.2 to 4.1.", "The score changed from 4.1 to −3.2."]
];
for (const [claim, evidence] of SWAPPED) {
  test(`F-5-2 dropped: "${claim}"`, () => assert.match(verdict(claim, evidence), /^REVERSED_MEANING/));
}
test("F-5-2: the swapped order is reported as ORDER when the verbs agree", () => {
  assert.equal(verdict("Latency falls from 18.7 seconds to 41.2 seconds per query.", EV_LAT), "REVERSED_MEANING:ORDER");
  assert.equal(verdict("Accuracy rose to 71 percent from 78 percent.", "Accuracy rose to 78 percent from 71 percent."), "REVERSED_MEANING:ORDER");
});
const KEPT_ORDER = [
  ["Latency falls from 41.2 seconds to 18.7 seconds per query.", EV_LAT],
  ["Latency fell from 41.2 to 18.7 seconds.", EV_LAT],
  ["Latency went to 18.7 seconds from 41.2 seconds.", EV_LAT],
  ["Latency: 41.2 -> 18.7 seconds.", "Latency: 41.2 -> 18.7 seconds."],
  ["Accuracy rose to 78 percent from 71 percent.", "Accuracy rose to 78 percent from 71 percent."],
  ["Accuracy rose from 71 percent to 78 percent.", "Accuracy rose to 78 percent from 71 percent."], // same change, written the other way round
  ["Latency is 41.2 seconds before and 18.7 seconds after.", EV_LAT], // no ordered-change syntax in the claim: not judged by this rule
  ["Latency fell to 18.7 seconds.", EV_LAT]
];
for (const [claim, evidence] of KEPT_ORDER) {
  test(`F-5-2 kept: "${claim}"`, () => assert.equal(verdict(claim, evidence), "KEPT"));
}
test("F-5-2: when the evidence contains the change in BOTH orders, the claim is not dropped for its order", () => {
  const evidence = "Latency falls from 41.2 seconds to 18.7 seconds on GPU A. Latency rises from 18.7 seconds to 41.2 seconds on the CPU.";
  assert.equal(verdict("Latency rises from 18.7 seconds to 41.2 seconds on the CPU.", evidence), "KEPT");
});
test("F-5-2: a change whose numbers are not in the evidence is still dropped by the number rule first", () => {
  assert.equal(verdict("Latency falls from 41.2 seconds to 17.7 seconds per query.", EV_LAT), "STATEMENT_NUMBER_NOT_IN_EVIDENCE");
});
test("F-5-2: ordered changes are extracted with units, percent signs, negative numbers and both phrasings", () => {
  assert.deepEqual(g.orderedChanges("rose from 12.5% to 14 points, and fell to 3 from 9; 1 -> 2"), [{ from: "12.5", to: "14" }, { from: "1", to: "2" }, { from: "9", to: "3" }]);
  assert.deepEqual(g.orderedChanges("from −3.2 to 4.1"), [{ from: "-3.2", to: "4.1" }]);
  assert.deepEqual(g.orderedChanges("no change is written here, only 3 and 4"), []);
  assert.equal(g.orderConflict("from 1 to 2", "from 2 to 1"), true);
  assert.equal(g.orderConflict("from 1 to 2", "from 1 to 2"), false);
  assert.equal(g.orderConflict("from 5 to 5", "from 5 to 5"), false);
});

// ---- the production validator uses the guard: dropped, counted under the existing reason, valid statements kept
test("validateIntelligence: reversed statements are dropped and counted as REVERSED_MEANING; the faithful twin is kept", () => {
  const chunks = [{ chunkId: "doi:10.1/x_chunk_1", section: "RESULTS", text: EV_LAT + " Accuracy rose to 78 percent from 71 percent." }];
  const id = chunks[0].chunkId;
  const bad = validateIntelligence({ findings: { text: "Latency rises from 18.7 seconds to 41.2 seconds per query.", evidence: [id] } }, chunks);
  assert.ok(!bad.intelligence.findings);
  assert.equal(bad.reasons.REVERSED_MEANING, 1);
  const bad2 = validateIntelligence({ findings: { text: "Accuracy rose to 71 percent from 78 percent.", evidence: [id] } }, chunks);
  assert.equal(bad2.reasons.REVERSED_MEANING, 1);
  const good = validateIntelligence({ findings: { text: "Latency falls from 41.2 seconds to 18.7 seconds per query.", evidence: [id] } }, chunks);
  assert.ok(good.intelligence.findings);
  assert.deepEqual(good.reasons, {});
});

// ---- false-drop control over every text in the repository's fixtures: a sentence is a faithful statement of itself, and so is a
// same-side synonym of its direction word; neither may be dropped.
test("control: no sentence of any fixture text is dropped when cited against its own chunk", () => {
  const regression = require("../fixtures/evidence_regression.json");
  const limits = require("../fixtures/evidence_limits_register.json");
  const texts = [...Object.values(regression.papers), ...Object.values(limits.papers)].flat();
  let n = 0;
  for (const c of texts) {
    for (const seg of g.segment(c.text)) {
      n += 1;
      assert.equal(verdict(seg.text, c.text), "KEPT", seg.text);
    }
  }
  assert.ok(n > 30, `only ${n} sentences were exercised`);
});

// ---- bounded time on hostile text for the new patterns
test("pathological text is handled in bounded time (new from/to patterns)", () => {
  const bad = ["from 1 ".repeat(3000), "to 1 from ".repeat(3000), "1 -> ".repeat(4000), "from 1 a b c d ".repeat(2000) + "to", "from " + "9".repeat(5000) + " to 1", "-".repeat(6000) + "->1"];
  const started = Date.now();
  for (const t of bad) verdict(t.slice(0, 20000), t.slice(0, 20000));
  const ms = Date.now() - started;
  assert.ok(ms < 3000, `took ${ms} ms`);
});

// ---- known remaining gaps, recorded so they stay visible (no assertion on a fix)
test("remaining gaps are recorded: reversed comparisons without a direction word or an ordered change are still kept", () => {
  // "loss" and "gain" are on the direction lists as nouns and verbs alike, so a sentence that also has the opposite verb counts as mixed
  assert.equal(verdict("Loss increases after epoch 10.", "Loss decreases after epoch 10."), "KEPT");
  assert.equal(verdict("The baseline beats SAR.", "SAR beats the baseline."), "KEPT");
  assert.equal(verdict("Accuracy rises and latency falls.", "Accuracy falls and latency rises."), "KEPT");
});
