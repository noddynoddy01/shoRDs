"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateChunkIds, selectForQuestion, selectForIntelligence, EvidenceError, MAX_REQUESTED_CHUNKS } = require("../../llm/evidence");

const P = "doi:10.9999/unit.paper.2020";
const Q = "doi:10.9999/other.paper.2021";
const mk = (paper, n, section = "RESULTS", text = `Sentence number ${n} about results.`) => ({ chunkId: `${paper}_chunk_${n}`, ordinal: n, section, heading: section, text });
const STORED = [mk(P, 1, "ABSTRACT"), mk(P, 2, "METHODOLOGY"), mk(P, 3)];
const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof EvidenceError); return e.code; } return null; };

test("validateChunkIds: absent -> no focus; valid ids pass and are de-duplicated", () => {
  assert.deepEqual(validateChunkIds(P, undefined, STORED), []);
  assert.deepEqual(validateChunkIds(P, null, STORED), []);
  assert.deepEqual(validateChunkIds(P, [`${P}_chunk_2`, `${P}_chunk_2`, `${P}_chunk_3`], STORED), [`${P}_chunk_2`, `${P}_chunk_3`]);
});

test("validateChunkIds: every kind of bad reference is refused with its own code", () => {
  assert.equal(code(() => validateChunkIds(P, "x", STORED)), "INVALID_CHUNK_IDS");
  assert.equal(code(() => validateChunkIds(P, { 0: "x" }, STORED)), "INVALID_CHUNK_IDS");
  for (const bad of ["c1", "", " ", `${P}_chunk_0`, `${P}_chunk_-1`, `${P}_chunk_1.5`, `${P}_chunk_`, `${P}chunk_1`, "doi:10.9999/x y_chunk_1", `${P}_chunk_1\n`, 7, null, {}, ["a"]]) {
    assert.equal(code(() => validateChunkIds(P, [bad], STORED)), "MALFORMED_CHUNK_ID", JSON.stringify(bad));
  }
  assert.equal(code(() => validateChunkIds(P, [`${Q}_chunk_1`], STORED)), "EVIDENCE_PAPER_MISMATCH", "another paper's chunk, even if well formed");
  assert.equal(code(() => validateChunkIds(P, [`${P}_chunk_999`], STORED)), "UNKNOWN_CHUNK", "well formed and for this paper, but not stored");
  assert.equal(code(() => validateChunkIds(P, Array.from({ length: MAX_REQUESTED_CHUNKS + 1 }, (_, i) => `${P}_chunk_${i + 1}`), STORED)), "TOO_MANY_CHUNKS");
});

test("validateChunkIds: a title-form paper id (with spaces) is handled like any other", () => {
  const T = "title:graph pruning for edge infer-smith-2020";
  const stored = [mk(T, 1)];
  assert.deepEqual(validateChunkIds(T, [`${T}_chunk_1`], stored), [`${T}_chunk_1`]);
  assert.equal(code(() => validateChunkIds(T, [`${P}_chunk_1`], stored)), "EVIDENCE_PAPER_MISMATCH");
});

test("selectForQuestion: ranks relevant chunks, keeps reading order, respects the budget, never pads with irrelevant text", () => {
  const chunks = [
    mk(P, 1, "INTRODUCTION", "Background on sparse coding of natural images and why it matters."),
    mk(P, 2, "METHODOLOGY", "We trained dictionaries with a learning rate of 0.001 for 50 epochs."),
    mk(P, 3, "RESULTS", "The learning rate schedule affected convergence speed in training."),
    ...Array.from({ length: 10 }, (_, i) => mk(P, i + 4, "REFERENCES", `Unrelated bibliography filler entry ${i}.`))
  ];
  const r = selectForQuestion(chunks, "What learning rate was used in training?", { maxChars: 100000 });
  const got = r.chunks.map((c) => c.ordinal);
  assert.ok(got.includes(2) && got.includes(3), "the two chunks that mention the learning rate are selected");
  assert.ok(got.length <= 3, "at most a small floor of context is added beyond what matches; the 10 bibliography chunks are not");
  assert.deepEqual(r.chunks.map((c) => c.ordinal), [...r.chunks.map((c) => c.ordinal)].sort((a, b) => a - b), "reading order");
  assert.ok(r.chunks.length < chunks.length, "irrelevant chunks are left out");
  assert.equal(r.truncated, true);
  const tiny = selectForQuestion(chunks, "learning rate", { maxChars: 80 });
  assert.ok(tiny.chunks.reduce((n, c) => n + c.text.length, 0) <= 80);
  assert.deepEqual(selectForQuestion([], "q").chunks, []);
});

test("selectForIntelligence: whole paper when it fits; section-balanced (and abstract kept) when it does not", () => {
  const small = [mk(P, 1, "ABSTRACT"), mk(P, 2, "RESULTS")];
  assert.deepEqual(selectForIntelligence(small, { maxChars: 10000 }), { chunks: small, omitted: 0, truncated: false });
  const big = [mk(P, 1, "ABSTRACT", "a".repeat(500))];
  let n = 2;
  for (const sec of ["INTRODUCTION", "METHODOLOGY", "RESULTS", "DISCUSSION", "LIMITATIONS"]) for (let i = 0; i < 20; i++) big.push(mk(P, n++, sec, "x".repeat(400)));
  const r = selectForIntelligence(big, { maxChars: 6000 });
  assert.equal(r.truncated, true);
  assert.ok(r.chunks.reduce((s, c) => s + c.text.length, 0) <= 6000);
  assert.ok(r.chunks.some((c) => c.section === "ABSTRACT"), "abstract always kept");
  for (const sec of ["INTRODUCTION", "METHODOLOGY", "RESULTS", "DISCUSSION"]) assert.ok(r.chunks.some((c) => c.section === sec), `${sec} represented, not silently dropped`);
  assert.equal(r.omitted, big.length - r.chunks.length);
});
