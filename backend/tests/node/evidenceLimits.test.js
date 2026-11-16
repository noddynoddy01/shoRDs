"use strict";
/**
 * Limits register for the evidence guard (Phase 3). SYNTHETIC, hand-written probes of the situations the guard is known NOT to handle
 * (wrong attribution, paraphrased numbers, subtle or uncued reversals, context-dependent claims) and of faithful statements it drops.
 *
 * The expectations record what the guard does TODAY. They are not a target and not an accuracy measure: the cases were chosen to be hard,
 * so the counts printed here say nothing about how often real summaries are wrong. If a guard change flips any case this test fails on
 * purpose: review the change, bump INTEL_PROMPT_VERSION, re-pin the fingerprint (cacheIdentityAudit), and update the register.
 * Do not "fix" a failure here by editing the expectation without doing those three things.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fx = require("../fixtures/evidence_limits_register.json");
const { validateIntelligence } = require("../../llm/intelligence");

const run = (c) => {
  const r = validateIntelligence({ findings: { text: c.text, evidence: c.cites } }, fx.papers[c.paper]);
  return { r, item: r.intelligence.findings };
};

test("register is labelled synthetic and every case names its own paper and chunk", () => {
  assert.match(fx._kind, /SYNTHETIC/);
  for (const c of fx.cases) {
    assert.ok(["faithful", "unfaithful"].includes(c.truth), c.id);
    assert.ok(fx.papers[c.paper].some((x) => x.chunkId === c.cites[0]), c.id);
    assert.equal(c.known === "KNOWN_MISS", c.truth === "unfaithful" && c.expect.kept, `${c.id}: KNOWN_MISS must mean an unfaithful statement that is kept`);
    assert.equal(c.known === "KNOWN_FALSE_DROP", c.truth === "faithful" && !c.expect.kept, `${c.id}: KNOWN_FALSE_DROP must mean a faithful statement that is dropped`);
  }
});

for (const c of fx.cases) {
  test(`${c.id} [${c.group}, ${c.truth}${c.known ? ", " + c.known : ""}] ${c.text.slice(0, 60)}`, () => {
    const { r, item } = run(c);
    assert.equal(Boolean(item), c.expect.kept, `kept=${Boolean(item)} reasons=${JSON.stringify(r.reasons)}`);
    if (c.expect.reason) assert.equal(r.reasons[c.expect.reason], 1, JSON.stringify(r.reasons));
    if (c.expect.qualifiers) assert.deepEqual(item.qualifiers, c.expect.qualifiers);
  });
}

test("the register keeps the guard's limits visible (counts over hand-picked hard cases, not rates)", () => {
  const unfaithful = fx.cases.filter((c) => c.truth === "unfaithful");
  const faithful = fx.cases.filter((c) => c.truth === "faithful");
  const missed = unfaithful.filter((c) => run(c).item);
  const dropped = faithful.filter((c) => !run(c).item);
  console.log(`# limits register: unfaithful kept ${missed.length}/${unfaithful.length}; faithful dropped ${dropped.length}/${faithful.length}`);
  assert.ok(missed.length > 0 && dropped.length > 0, "both kinds of known error stay visible");
});

test("pathological text (long runs of digits, dots, commas, abbreviations, brackets) is handled in bounded time", () => {
  const bad = ["1.".repeat(4000), "1,".repeat(4000), "a. ".repeat(3000), "e.g. ".repeat(2000), "-".repeat(8000), "(" + "x ".repeat(3500), "0.0".repeat(2500) + " percent"];
  const chunks = bad.map((t, i) => ({ chunkId: `doi:10.1/x_chunk_${i + 1}`, section: "RESULTS", text: t }));
  const stmts = bad.map((t, i) => ({ text: t.slice(0, 700), evidence: [chunks[i].chunkId], basis: "STATED" }));
  const started = Date.now();
  validateIntelligence({ limitations: stmts, strengths: stmts, contributions: stmts }, chunks);
  const ms = Date.now() - started;
  // measured about 20 ms; the bound is 100 times that so a slow CI machine does not fail it, while a catastrophic backtracking regex would
  assert.ok(ms < 2000, `took ${ms} ms`);
});
