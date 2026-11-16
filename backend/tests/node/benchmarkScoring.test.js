"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { cohenKappa, confusion, perClass } = require("../../eval/agreement");
const { scoreBenchmark } = require("../../eval/benchmarkScoring");

test("Cohen's kappa: known values, chance correction and degenerate cases", () => {
  assert.equal(cohenKappa(["a", "b", "a", "b"], ["a", "b", "a", "b"]).kappa, 1);
  assert.equal(cohenKappa(["a", "a", "b", "b"], ["a", "b", "a", "b"]).kappa, 0); // agreement exactly as expected by chance
  // textbook example: 50 items, observed 0.7, expected 0.5 -> kappa 0.4
  const a = [...Array(25).fill("y"), ...Array(25).fill("n")];
  const b = [...Array(20).fill("y"), ...Array(5).fill("n"), ...Array(10).fill("y"), ...Array(15).fill("n")];
  const k = cohenKappa(a, b);
  assert.equal(k.observed, 0.7); assert.equal(k.expected, 0.5); assert.equal(k.kappa, 0.4);
  assert.equal(cohenKappa(["a", "a"], ["a", "a"]).kappa, null, "one label throughout: undefined, not 1 or NaN");
  assert.equal(cohenKappa([], []).kappa, null);
  assert.throws(() => cohenKappa(["a"], ["a", "b"]));
});

test("confusion matrix and per-class precision/recall", () => {
  const ref = ["S", "S", "U", "U", "C"]; const got = ["S", "U", "U", "U", "S"];
  assert.deepEqual(confusion(ref, got).matrix.S, { C: 0, S: 1, U: 1 });
  const p = perClass(ref, got);
  assert.deepEqual([p.S.precision, p.S.recall], [0.5, 0.5]);
  assert.deepEqual([p.U.precision, p.U.recall], [0.667, 1]);
  assert.deepEqual([p.C.precision, p.C.recall, p.C.support], [null, 0, 1]);
});

test("the development fixture is labelled as NOT human-rated and the scorer says so", async () => {
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "docs", "evaluation", "benchmark", "dev_fixture.json"), "utf8"));
  assert.equal(doc._kind, "DEV_FIXTURE_NOT_HUMAN_RATED");
  assert.ok(doc.items.every((i) => i.license === "fictional"));
  const r = await scoreBenchmark(doc);
  assert.equal(r.kind, "DEV_FIXTURE_NOT_HUMAN_RATED");
  assert.equal(r.claims, 24);
  assert.deepEqual(r.interRaterKappa, {});
  // regression floor on the fixture only (it is the author's own data, so this proves the code still behaves, not that it is accurate)
  assert.ok(r.exactAgreement >= 0.8, `exact agreement ${r.exactAgreement}`);
  assert.equal(r.unsafeClaimsMissed, 0, "no claim the author marked unsafe may be read as SUPPORTED");
});

test("a rated benchmark reports inter-rater agreement, uses adjudicated labels, and refuses papers whose licence does not allow evaluation", async () => {
  const src = "Results\nSAR reaches 87.4 percent accuracy, compared with 79.1 percent for the dense baseline.";
  const claims = (ratings, adjudicated) => [{ text: "SAR reaches 87.4 percent accuracy, compared with 79.1 percent for the dense baseline.", ratings, adjudicated }];
  const doc = { items: [
    { id: "ok", license: "cc-by", source: src, claims: claims({ r1: "SUPPORTED", r2: "SUPPORTED" }, "SUPPORTED") },
    { id: "nc", license: "cc-by-nc", source: src, claims: claims({ r1: "SUPPORTED", r2: "SUPPORTED" }, "SUPPORTED") },
    { id: "unknown", license: null, source: src, claims: claims({}, "SUPPORTED") }
  ] };
  const r = await scoreBenchmark(doc);
  assert.equal(r.kind, "HUMAN_RATED");
  assert.equal(r.claims, 1);
  assert.deepEqual(r.excludedByLicence.map((x) => x.paperId), ["nc", "unknown"]);
  assert.ok(r.interRaterKappa["r1|r2"]);
  assert.equal(r.exactAgreement, 1);
});

test("a benchmark file without two independent raters is never reported as human-rated", async () => {
  const r = await scoreBenchmark({ items: [{ id: "x", license: "cc0", source: "Results\nSAR reaches 87.4 percent accuracy.", claims: [{ text: "SAR reaches 87.4 percent accuracy.", label: "SUPPORTED" }] }] });
  assert.notEqual(r.kind, "HUMAN_RATED");
});
