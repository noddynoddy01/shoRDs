"use strict";
/**
 * Manual review kit for the evidence guard (backend/eval/guardReview.js, scripts/f1_review.js). Uses the fictional P1 paper of the regression
 * fixture and labels that stand in for a human reader. This tests the machinery (blinding, licence gate, joining, intervals), not the guard's
 * accuracy: no real reviewer has rated anything.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const fx = require("../fixtures/evidence_regression.json");
const G = require("../../eval/guardReview");

const chunks = fx.papers.P1;
const byId = Object.fromEntries([...fx.statements, ...fx.quantitative].map((c) => [c.id, c]));
// what a careful human reader would say about each statement (author-written stand-ins)
const TRUTH = { f01: "SUPPORTED", f03: "SUPPORTED", f06: "SUPPORTED", n01: "UNSUPPORTED", r01: "CONTRADICTED", m02: "CONTRADICTED", m03: "UNSUPPORTED", o01: "UNSUPPORTED", h01: "PARTIAL", u01: "UNSUPPORTED", q01: "SUPPORTED", q04: "UNSUPPORTED" };
const statementIds = ["f01", "f03", "f06", "n01", "r01", "m02", "m03", "o01", "h01", "u01"];
const modelOutput = {
  // production reads at most 8 statements per list field, so the ten statements are spread over two fields
  limitations: statementIds.slice(0, 5).map((id) => ({ text: byId[id].text, evidence: byId[id].cites, basis: "STATED" })),
  strengths: statementIds.slice(5).map((id) => ({ text: byId[id].text, evidence: byId[id].cites, basis: "STATED" })),
  quantitativeResults: ["q01", "q04"].map((id) => ({ metric: byId[id].metric, value: byId[id].value, context: byId[id].context, evidence: byId[id].cites }))
};
const input = (license = "cc-by") => ({ paper: { paperId: "doi:10.9999/fixture", title: "A fictional paper", license, doi: "10.9999/fixture" }, chunks, modelOutput });

function filled(plan, labelFor) {
  const rows = G.parseCsv(plan.sheet);
  for (const r of rows) {
    const text = r.statement;
    const id = Object.keys(TRUTH).find((k) => (byId[k].text || `${byId[k].metric}: ${byId[k].value}`) === text || text.startsWith(`${byId[k].metric}: ${byId[k].value}`) && byId[k].metric);
    r.human_verdict = labelFor(id, r);
  }
  return rows;
}

test("the reviewer sheet is blinded: statements and passages, never the guard's verdict, and a seed fixes the order", () => {
  const a = G.buildReviewPlan(input(), { seed: 1 });
  assert.equal(a.units, 12);
  assert.ok(!/KEPT|DROPPED|STATEMENT_NUMBER|REVERSED_MEANING|OVERCLAIM|WEAK_SUPPORT|qualifier|HEDGE_DROPPED/.test(a.sheet), "no verdict or reason in the sheet");
  assert.ok(a.sheet.includes("87.4 percent exact-match accuracy") && a.sheet.includes("[c1]"), "statements and cited passages are shown");
  assert.deepEqual(G.buildReviewPlan(input(), { seed: 1 }).sheet, a.sheet);
  assert.notEqual(G.buildReviewPlan(input(), { seed: 2 }).sheet, a.sheet);
  assert.equal(a.key.kind, "GUARD_REVIEW_KEY_DO_NOT_SHARE_WITH_REVIEWERS");
  assert.equal(Object.keys(a.key.units).length, 12);
  assert.equal(a.key.units.S001.verdict === "KEPT" || a.key.units.S001.verdict === "DROPPED", true);
  assert.match(a.key.promptVersion, /^\d{4}\.\d+-intel$/);
});

test("the key's verdicts are exactly what production validation does with each statement", () => {
  const plan = G.buildReviewPlan(input(), { seed: 1 });
  const rows = G.parseCsv(plan.sheet);
  const expectKept = { f01: true, f03: true, f06: true, n01: false, r01: false, m02: true, m03: true, o01: false, h01: true, u01: false, q01: true, q04: false };
  let checked = 0;
  for (const r of rows) {
    const id = Object.keys(expectKept).find((k) => r.statement === byId[k].text || (byId[k].metric && r.statement.startsWith(`${byId[k].metric}: ${byId[k].value}`)));
    assert.ok(id, r.statement);
    assert.equal(plan.key.units[r.unit_id].verdict === "KEPT", expectKept[id], id);
    checked += 1;
  }
  assert.equal(checked, 12);
});

test("papers whose licence does not clearly allow an internal evaluation set are refused", () => {
  for (const lic of ["cc-by-nc", "publisher-specific-oa", null, "all-rights-reserved"]) assert.throws(() => G.buildReviewPlan(input(lic)), /refused/, String(lic));
  assert.doesNotThrow(() => G.buildReviewPlan(input("cc-by-sa")));
  assert.throws(() => G.buildReviewPlan({ paper: { paperId: "x", license: "cc-by" }, chunks, modelOutput: {} }), /no statements/);
});

test("scoring: misses, false drops and the share of kept statements that are unsupported, with intervals", () => {
  const plan = G.buildReviewPlan(input(), { seed: 3 });
  const rows = filled(plan, (id) => TRUTH[id]);
  const rep = G.scoreReview(plan.key, [rows]);
  assert.equal(rep.labelled, 12);
  assert.deepEqual(rep.counts, { supported: 4, partial: 1, unsupportedOrContradicted: 7 });
  // unsupported/contradicted: n01 r01 m02 m03 o01 u01 q04; the guard kept m02 and m03 -> 2 of 7 missed
  assert.deepEqual([rep.miss.k, rep.miss.n], [2, 7]);
  // supported: f01 f03 f06 q01, all kept -> 0 of 4 dropped
  assert.deepEqual([rep.falseDrop.k, rep.falseDrop.n], [0, 4]);
  // kept: f01 f03 f06 q01 (supported) + h01 (partial) + m02 m03 (unsupported) = 7; 2 of 7 unsupported
  assert.deepEqual([rep.shareOfKeptThatIsUnsupported.k, rep.shareOfKeptThatIsUnsupported.n], [2, 7]);
  assert.deepEqual(rep.keptBreakdown, { good: 4, partial: 1, bad: 2 });
  assert.ok(rep.warnings.some((w) => /Only one reviewer/.test(w)));
  assert.ok(rep.warnings.some((w) => /Only 7 unsupported/.test(w)), "small samples are called out");
  assert.ok(rep.miss.low < rep.miss.rate && rep.miss.rate < rep.miss.high);
});

test("scoring with two reviewers: disputes are set aside, agreement is reported, blanks and bad labels are surfaced", () => {
  const plan = G.buildReviewPlan(input(), { seed: 4 });
  const a = filled(plan, (id) => TRUTH[id]);
  const b = filled(plan, (id) => (id === "f01" ? "UNSUPPORTED" : id === "u01" ? "" : id === "o01" ? "MAYBE" : TRUTH[id]));
  const rep = G.scoreReview(plan.key, [a, b]);
  assert.equal(rep.disputed, 1, "f01: the two reviewers disagree");
  assert.equal(rep.unlabelled, 2, "u01 (blank) and o01 (not a label) have no usable second label");
  assert.equal(rep.labelled, 9);
  assert.ok(rep.problems.some((p) => /unknown verdict "MAYBE"/.test(p)));
  assert.equal(rep.agreement.n, 10, "units with a usable label from both reviewers");
  assert.ok(rep.agreement.kappa > 0 && rep.agreement.kappa < 1, JSON.stringify(rep.agreement));
  assert.equal(rep.reviewers, 2);
});

test("Wilson intervals behave at the edges", () => {
  const z = G.wilson(0, 10);
  assert.equal(z.low, 0);
  assert.ok(z.high > 0.25 && z.high < 0.35);
  const h = G.wilson(5, 10);
  assert.ok(Math.abs(h.low - 0.237) < 0.01 && Math.abs(h.high - 0.763) < 0.01);
  assert.deepEqual(G.wilson(0, 0), { rate: null, low: null, high: null, n: 0, k: 0 });
});

test("the command line makes the files and refuses a restricted paper", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f1-"));
  const raw = path.join(dir, "paper1.json");
  fs.writeFileSync(raw, JSON.stringify(input()));
  const script = path.resolve(__dirname, "../../../scripts/f1_review.js");
  const out = execFileSync(process.execPath, [script, "make", "--raw", raw, "--out", path.join(dir, "out")], { encoding: "utf8" });
  assert.match(out, /wrote 12 statements/);
  assert.deepEqual(fs.readdirSync(path.join(dir, "out")).sort(), ["paper1.KEY_DO_NOT_SHARE_WITH_REVIEWERS.json", "paper1.reviewer_sheet.csv"]);
  fs.writeFileSync(raw, JSON.stringify(input("cc-by-nc")));
  assert.throws(() => execFileSync(process.execPath, [script, "make", "--raw", raw, "--out", path.join(dir, "out2")], { encoding: "utf8", stdio: "pipe" }), /refused/);
  assert.equal(fs.existsSync(path.join(dir, "out2")), false, "nothing is written for a refused paper");
});
