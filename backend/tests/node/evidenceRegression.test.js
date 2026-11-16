"use strict";
/**
 * Regression dataset for the production evidence validator (backend/llm/intelligence.js + claimGuard.js).
 *
 * SYNTHETIC: fictional papers and hand-written statements (see the fixture's _kind). It pins what each rule does so a change cannot
 * silently reopen finding F1. It is not an accuracy measure: the rates printed below are counts over cases the author chose.
 * Cases marked `known` are limitations of the current rules, recorded with the behaviour they have today.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fx = require("../fixtures/evidence_regression.json");
const { validateIntelligence } = require("../../llm/intelligence");

const run = (c) => {
  const chunks = fx.papers[c.paper];
  const r = validateIntelligence({ findings: { text: c.text, evidence: c.cites } }, chunks);
  return { r, item: r.intelligence.findings };
};

test("fixture is labelled synthetic and every case names a known paper and chunk", () => {
  assert.match(fx._kind, /SYNTHETIC/);
  for (const c of [...fx.statements, ...fx.quantitative]) {
    assert.ok(fx.papers[c.paper], c.id);
    for (const id of c.cites) assert.ok(fx.papers[c.paper].some((x) => x.chunkId === id), `${c.id} cites ${id}`);
  }
});

for (const c of fx.statements) {
  test(`${c.id} [${c.category}${c.known ? ", " + c.known : ""}] ${c.text.slice(0, 60)}`, () => {
    const { r, item } = run(c);
    assert.equal(Boolean(item), c.expect.kept, `kept=${Boolean(item)} reasons=${JSON.stringify(r.reasons)}`);
    if (c.expect.reason) assert.equal(r.reasons[c.expect.reason], 1, JSON.stringify(r.reasons));
    if (c.expect.qualifiers) assert.deepEqual(item.qualifiers, c.expect.qualifiers);
    if (c.expect.kept && !c.expect.qualifiers) assert.equal(item.qualifiers, undefined);
  });
}

for (const c of fx.quantitative) {
  test(`${c.id} [quantitative] ${c.metric} ${c.value}`, () => {
    const r = validateIntelligence({ quantitativeResults: [{ metric: c.metric, value: c.value, context: c.context, evidence: c.cites }] }, fx.papers[c.paper]);
    const out = r.intelligence.quantitativeResults;
    assert.equal(out.length === 1, c.expect.kept, JSON.stringify(r.reasons));
    if (c.expect.reason) assert.equal(r.reasons[c.expect.reason], 1, JSON.stringify(r.reasons));
    if (out.length) assert.equal(out[0].context !== "", c.expect.contextKept);
  });
}

test("summary counts over the synthetic cases (not an accuracy figure)", () => {
  const rows = fx.statements.map((c) => ({ c, kept: Boolean(run(c).item) }));
  const unsafe = rows.filter(({ c }) => !c.expect.kept || c.known === "KNOWN_MISS");
  const knownMisses = rows.filter(({ c }) => c.known === "KNOWN_MISS" && c.expect.kept);
  const faithful = rows.filter(({ c }) => c.category === "faithful");
  console.log(`# synthetic cases: ${rows.length}; faithful kept ${faithful.filter((x) => x.kept).length}/${faithful.length}; unsafe cases ${unsafe.length}, of which kept (known misses) ${knownMisses.length}`);
  assert.ok(knownMisses.length > 0, "the known misses stay visible");
});
