"use strict";
/**
 * Metrics used to compare PDF extractors (backend/eval/pdfExtraction.js), checked on tiny hand-made texts with known answers.
 * These tests prove the scoring code; they say nothing about any extractor.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const X = require("../../eval/pdfExtraction");

const truth = {
  id: "t", pages: 2,
  anchors: [{ text: "Alpha opens the paper", page: 1 }, { text: "Beta follows alpha", page: 1 }, { text: "Gamma closes the paper", page: 2 }],
  headings: ["1 Introduction", "2 Methods"],
  tables: [{ rows: [["Model", "Accuracy", "Latency"], ["Dense", "79.1", "41.2"]] }],
  equations: ["L = L_task + 0.01 L_route"], references: 2
};

test("reading order: all found and in order; interleaved columns lower the in-order score; missing anchors lower recall", () => {
  const good = "Alpha opens the paper and more.\nBeta follows alpha.\f Gamma closes the paper.";
  const g = X.readingOrder(good, truth);
  assert.equal(g.recall, 1); assert.equal(g.inOrder, 1);
  const swapped = X.readingOrder("Gamma closes the paper. Beta follows alpha. Alpha opens the paper.", truth);
  assert.equal(swapped.recall, 1); assert.ok(swapped.inOrder < 1);
  const missing = X.readingOrder("Alpha opens the paper only", truth);
  assert.equal(missing.found, 1); assert.ok(missing.recall < 0.5);
});

test("headings: found as their own line, in order; a heading glued into a paragraph does not count", () => {
  assert.equal(X.headings("1 Introduction\ntext\n2 Methods\n", truth).recall, 1);
  assert.equal(X.headings("text 1 Introduction text\n2 Methods\n", truth).recall, 0.5);
  assert.equal(X.headings("2 Methods\n1 Introduction\n", truth).inOrder, 0.5);
});

test("tables: a row is intact only when its cells share a line in order; cell recall is separate", () => {
  const row = X.tables("Model Accuracy Latency\nDense   79.1   41.2\n", truth);
  assert.equal(row.rowIntegrity, 1); assert.equal(row.cellRecall, 1);
  const cols = X.tables("Model\nAccuracy\nLatency\nDense\n79.1\n41.2\n", truth);
  assert.equal(cols.rowIntegrity, 0); assert.equal(cols.cellRecall, 1);
  assert.equal(X.tables("nothing", { tables: [] }), null);
});

test("equations and references", () => {
  assert.equal(X.equations("L = L_task + 0.01 L_route", truth).recall, 1);
  assert.equal(X.equations("L = Ltask + 0.01 Lroute garbled ∑", truth).recall, 1, "whitespace and punctuation are ignored");
  assert.equal(X.equations("something else", truth).recall, 0);
  assert.equal(X.references("[1] a\n[2] b\n", truth).recall, 1);
  assert.equal(X.references("[1] a\n", truth).recall, 0.5);
});

test("page provenance: form feeds kept or lost; anchors with page 0 are not graded", () => {
  const ok = X.pageProvenance("Alpha opens the paper Beta follows alpha\fGamma closes the paper", truth);
  assert.equal(ok.pageBreaksPreserved, true); assert.equal(ok.anchorsOnCorrectPage, 1);
  const lost = X.pageProvenance("Alpha opens the paper Beta follows alpha Gamma closes the paper", truth);
  assert.equal(lost.pageBreaksPreserved, false); assert.equal(lost.anchorsOnCorrectPage, null);
  const ungraded = X.pageProvenance("A\fB", { pages: 2, anchors: [{ text: "A", page: 0 }] });
  assert.equal(ungraded.anchorsOnCorrectPage, null);
});

test("scanned: no text layer is reported as such; OCR word recall is measured against the ground-truth text", () => {
  const t = { ...truth, scanned: true, pages: 1 };
  assert.equal(X.scanned("", t).textLayerPresent, false);
  const o = X.scanned("alpha opens paper", t, "alpha opens the paper completely");
  assert.equal(o.wordRecall, 0.75);
});

test("lis", () => { assert.equal(X.lis([3, 1, 2, 5, 4]), 3); assert.equal(X.lis([]), 0); });
