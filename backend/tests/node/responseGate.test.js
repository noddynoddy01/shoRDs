"use strict";
/** responseGate: the licence gate for paper text in analysis/Copilot responses, and removal of the heuristic confidence score. Pure unit tests. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { gateResponse, WITHHELD_REASON } = require("../../llm/responseGate");

const SECRET = "Accuracy was 87.4 percent on the held-out set.";
const body = (extra = {}) => ({
  kind: "INTELLIGENCE", modelMode: "EXTERNAL_CLAUDE", answer: "A model-written answer [c1]",
  evidence: [{ chunkId: "c1", section: "RESULTS", page: null, text: SECRET }],
  confidence: { level: "MEDIUM", score: 0.61, basis: "HEURISTIC", factors: { coverage: 1 } },
  intelligence: { tldr: { text: "Model wording.", evidence: ["c1"], basis: "STATED" }, limitations: [{ text: "Another statement.", evidence: ["c1"], basis: "STATED" }] },
  ...extra
});
const run = (license, b = body()) => gateResponse({ httpStatus: 200, body: b }, { license });
const serialised = (o) => JSON.stringify(o);

test("an allowed licence keeps the excerpt text and says so", () => {
  for (const lic of ["cc-by", "cc0", "CC BY 4.0", "public-domain"]) {
    const r = run(lic);
    assert.equal(r.body.evidence[0].text, SECRET, lic);
    assert.equal(r.body.textPolicy.evidenceText, "INCLUDED");
    assert.equal(r.body.textPolicy.permission, "yes");
  }
});

test("every other licence withholds the text: no excerpt survives in any field of the response", () => {
  for (const lic of ["cc-by-sa" /* policy says "review": a person must check the share-alike conditions, so the text is withheld */, "cc-by-nc", "cc-by-nd", "cc-by-nc-sa", "publisher-specific-oa", "all-rights-reserved", "garbage", "", null, undefined, 42]) {
    const r = run(lic);
    assert.equal(r.body.evidence[0].text, undefined, String(lic));
    assert.equal(r.body.evidence[0].textAvailable, false);
    assert.equal(r.body.evidence[0].textWithheldReason, WITHHELD_REASON);
    assert.equal(r.body.evidence[0].chunkId, "c1", "the citation id stays so the statement can still point at the paper");
    assert.equal(r.body.textPolicy.evidenceText, "WITHHELD_BY_LICENSE");
    assert.equal(r.body.textPolicy.reason, WITHHELD_REASON);
    assert.ok(!serialised(r.body).includes("87.4"), `licence ${String(lic)}: the excerpt must not appear anywhere`);
    assert.equal(r.body.intelligence.tldr.text, "Model wording.", "model-written statements are not excerpts");
  }
});

test("verbatim copies of the paper are withheld too: the local-fallback answer and a verbatim abstract TL;DR", () => {
  const fallback = run("cc-by-nc", body({ modelMode: "LOCAL_DETERMINISTIC", answer: `Local fallback. [c1]: ${SECRET}` }));
  assert.ok(!fallback.body.answer.includes("87.4"));
  assert.match(fallback.body.answer, /licence/);
  const kept = run("cc-by", body({ modelMode: "LOCAL_DETERMINISTIC", answer: `Local fallback. [c1]: ${SECRET}` }));
  assert.ok(kept.body.answer.includes("87.4"), "an allowed licence keeps the fallback answer");

  const verbatim = body({ intelligence: { tldr: { text: SECRET, evidence: ["c1"], basis: "EXTRACTED_VERBATIM" }, limitations: [{ text: SECRET, evidence: ["c1"], basis: "EXTRACTED_VERBATIM" }, { text: "Model statement.", evidence: ["c1"], basis: "STATED" }] } });
  const r = run("publisher-specific-oa", verbatim);
  assert.equal(r.body.intelligence.tldr, null);
  assert.deepEqual(r.body.intelligence.limitations.map((x) => x.text), ["Model statement."]);
  assert.deepEqual(r.body.textPolicy.verbatimFieldsRemoved.sort(), ["limitations", "tldr"]);
  assert.ok(!serialised(r.body).includes("87.4"));
  assert.equal(run("cc-by", verbatim).body.intelligence.tldr.text, SECRET);
});

test("the heuristic confidence score and its factors never leave the server, whatever the licence", () => {
  for (const lic of ["cc-by", "cc-by-nc", null]) {
    const c = run(lic).body.confidence;
    assert.deepEqual(Object.keys(c).sort(), ["basis", "level"], String(lic));
    assert.ok(!serialised(run(lic).body).includes("0.61"));
  }
  assert.equal(gateResponse({ httpStatus: 200, body: { confidence: null } }, { license: "cc-by" }).body.confidence, null);
});

test("pure: the input (which may be a shared cached object) is never changed, and odd inputs pass through", () => {
  const b = body();
  const before = JSON.stringify(b);
  run("cc-by-nc", b);
  run("cc-by", b);
  assert.equal(JSON.stringify(b), before);
  assert.equal(gateResponse(null, {}), null);
  assert.deepEqual(gateResponse({ httpStatus: 500 }, {}), { httpStatus: 500 });
  const empty = gateResponse({ httpStatus: 200, body: { evidence: [] } }, { license: null });
  assert.deepEqual(empty.body.evidence, []);
  assert.equal(empty.body.textPolicy.evidenceText, "WITHHELD_BY_LICENSE");
});
