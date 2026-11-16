"use strict";
/**
 * Regression tests for finding F1 (docs/ops/P0_CODE_REVIEW_2026-11-03.md). The production check used to number-check only the VALUE of a
 * quantitative result; a narrative statement with an altered number, a result's free-text context with an invented number, and a statement
 * that negated the cited result were all kept. They are now dropped (or, for the context, stripped) by backend/llm/claimGuard.js.
 *
 * These are SYNTHETIC cases about a fictional paper: they pin behaviour, they do not measure accuracy. The false-drop rate on real
 * summaries is unmeasured until the human benchmark is rated. See also evidenceGuard.test.js for the wider rule set.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateIntelligence } = require("../../llm/intelligence");

const CHUNKS = [{ chunkId: "c1", text: "Sparse Attention Routing reaches 87.4 percent exact-match accuracy, compared with 79.1 percent for the dense baseline. We evaluated only English text." }];
const finding = (text) => validateIntelligence({ findings: { text, evidence: ["c1"] } }, CHUNKS);
const resultWithContext = (context) => validateIntelligence({ quantitativeResults: [{ metric: "accuracy", value: "87.4%", context, evidence: ["c1"] }] }, CHUNKS);

test("current behaviour: a faithful statement is kept; a quantitative value that is not in the evidence is dropped", () => {
  assert.equal(finding("Sparse Attention Routing reaches 87.4 percent exact-match accuracy versus 79.1 percent for the dense baseline.").kept, 1);
  const r = validateIntelligence({ quantitativeResults: [{ metric: "accuracy", value: "91.7%", evidence: ["c1"] }] }, CHUNKS);
  assert.equal(r.kept, 0);
  assert.equal(r.reasons.NUMBER_NOT_IN_EVIDENCE, 1);
});

test("F1 closed: a narrative statement containing a number that is not in its cited chunks should be dropped", () => {
  const r = finding("Sparse Attention Routing reaches 91.7 percent exact-match accuracy versus 79.1 percent for the dense baseline.");
  assert.equal(r.kept, 0);
});

test("F1 closed: an invented number in a quantitative result's `context` should be dropped or stripped", () => {
  const r = resultWithContext("improved by 40 points over the baseline");
  assert.ok(r.kept === 0 || r.intelligence.quantitativeResults.every((x) => !/40/.test(x.context)));
});

test("F1 closed (for cued reversals): a statement that negates the cited result is dropped", () => {
  const r = finding("Sparse Attention Routing does not reach higher exact-match accuracy than the dense baseline.");
  assert.equal(r.kept, 0);
});
