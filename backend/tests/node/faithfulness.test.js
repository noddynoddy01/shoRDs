"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateFaithfulness, verifyEvidenceSpans, splitClaims, buildPassages, STATUS } = require("../../eval/faithfulness");

// FICTIONAL paper (same convention as the other fixtures): no figure here is a real finding.
const SOURCE = `Abstract
Long-context models lose recall on distant evidence. We propose Sparse Attention Routing (SAR), which routes tokens to a small set of memory slots.
Methods
SAR replaces the dense attention of every fourth transformer layer. We train on 38 billion tokens for 3 epochs.
Results
On the benchmark test split SAR reaches 87.4 percent exact-match accuracy, compared with 79.1 percent for the dense baseline. Removing the moving-average update reduces accuracy to 83.0 percent. SAR did not improve results on short questions.
Discussion
The gains may concentrate on questions whose evidence lies more than 64k tokens from the question.
Limitations
We evaluated only English text and a single model scale of 7 billion parameters.`;

const one = async (text, opts = {}) => (await evaluateFaithfulness({ source: SOURCE, summary: text }, opts)).claims[0];

test("claim splitting: sentences, decimals and abbreviations; questions and fragments are not claims; positions index the summary", () => {
  const s = "SAR reaches 87.4 percent accuracy (Fig. 2 and Smith et al. 2020 agree). Is it good? Yes. The dense baseline reaches 79.1 percent; ablations lower it.";
  const c = splitClaims(s);
  assert.deepEqual(c.map((x) => x.kind), ["CLAIM", "NON_CLAIM", "NON_CLAIM", "CLAIM"]);
  assert.match(c[3].text, /ablations lower it\.$/); // a ";" clause stays with its sentence
  for (const x of c) assert.equal(s.slice(x.start, x.end), x.text);
  assert.deepEqual(splitClaims(""), []);
  assert.deepEqual(splitClaims(null), []);
});

test("a faithful paraphrase is SUPPORTED and points at the exact passage", async () => {
  const c = await one("SAR reaches 87.4 percent accuracy, beating the dense baseline at 79.1 percent.");
  assert.equal(c.status, STATUS.SUPPORTED);
  assert.match(c.evidence[0].text, /87\.4 percent exact-match accuracy/);
  assert.equal(c.evidence[0].section, "results");
  assert.equal(c.method, "LEXICAL_PROXY");
});

test("a figure that is not in the paper is UNSUPPORTED even when every other word matches (negative control for numbers)", async () => {
  const c = await one("SAR reaches 91.2 percent exact-match accuracy on the benchmark test split.");
  assert.equal(c.status, STATUS.UNSUPPORTED);
  assert.deepEqual(c.flags.find((f) => f.code === "NUMBER_NOT_IN_SOURCE").detail, ["91.2"]);
});

test("a real figure attached to the wrong passage is downgraded and named", async () => {
  const c = await one("Training used 79.1 billion tokens for 3 epochs.");
  assert.notEqual(c.status, STATUS.SUPPORTED);
  assert.ok(c.flags.some((f) => f.code === "NUMBER_NOT_IN_EVIDENCE" || f.code === "NUMBER_NOT_IN_SOURCE"));
});

test("a flipped direction is CONTRADICTED and marked for a person to check", async () => {
  const c = await one("Removing the moving-average update increases accuracy to 83.0 percent.");
  assert.equal(c.status, STATUS.CONTRADICTED);
  assert.ok(c.flags.some((f) => f.code === "DIRECTION_MISMATCH"));
  assert.equal(c.needsReview, true);
});

test("a flipped negation is CONTRADICTED", async () => {
  const c = await one("SAR improved results on short questions.");
  assert.equal(c.status, STATUS.CONTRADICTED);
  assert.ok(c.flags.some((f) => f.code === "NEGATION_MISMATCH" || f.code === "DIRECTION_MISMATCH"));
});

test("a dropped hedge and an overclaim both stop a claim being SUPPORTED", async () => {
  const hedge = await one("The gains concentrate on questions whose evidence lies more than 64k tokens from the question.");
  assert.equal(hedge.status, STATUS.PARTIAL);
  assert.ok(hedge.flags.some((f) => f.code === "HEDGE_DROPPED"));
  const over = await one("SAR proves that routing always beats dense attention.");
  assert.notEqual(over.status, STATUS.SUPPORTED);
});

test("an unrelated claim is UNSUPPORTED and an empty or non-claim input never throws", async () => {
  assert.equal((await one("The authors released a mobile app for farmers in three countries.")).status, STATUS.UNSUPPORTED);
  const r = await evaluateFaithfulness({ source: SOURCE, summary: "" });
  assert.equal(r.summary.claims, 0);
  assert.equal(r.summary.supportedRate, null);
  const empty = await evaluateFaithfulness({ source: "", summary: "SAR works well on everything." });
  assert.equal(empty.claims[0].status, STATUS.UNSUPPORTED);
  assert.equal((await evaluateFaithfulness({ source: [], summary: "x y z w." })).claims.length, 1);
});

test("evidence stays inspectable: every span slices back to exactly the quoted text, for a string source and for stored chunks", async () => {
  const text = "SAR reaches 87.4 percent accuracy. The model was trained on 38 billion tokens for 3 epochs. We evaluated only English text.";
  const r = await evaluateFaithfulness({ source: SOURCE, summary: text });
  assert.deepEqual(verifyEvidenceSpans(r, SOURCE), { ok: true, bad: [] });
  const chunks = [{ chunkId: "p_chunk_1", text: SOURCE.slice(0, 200) }, { chunkId: "p_chunk_2", text: SOURCE.slice(200) }];
  const r2 = await evaluateFaithfulness({ source: chunks, summary: text });
  assert.deepEqual(verifyEvidenceSpans(r2, chunks), { ok: true, bad: [] });
  assert.ok(r2.claims.some((c) => c.evidence.some((e) => e.chunkId === "p_chunk_2")));
  const tampered = JSON.parse(JSON.stringify(r)); tampered.claims[0].evidence[0].text = "invented";
  assert.equal(verifyEvidenceSpans(tampered, SOURCE).ok, false);
});

test("coverage: sections the summary never touches are listed (a summary that skips Limitations says so)", async () => {
  const r = await evaluateFaithfulness({ source: SOURCE, summary: "SAR reaches 87.4 percent accuracy, beating the dense baseline at 79.1 percent." });
  assert.ok(r.sourceCoverage.omittedSections.includes("limitations"));
  assert.ok(!r.sourceCoverage.omittedSections.includes("results"));
  assert.equal(r.summary.evidenceCoverage, 1);
});

test("citations: precision counts cited chunks that really support the claim; recall counts supported claims that cite one; unknown ids are reported", async () => {
  const chunks = [{ chunkId: "c1", text: "Methods\nWe train on 38 billion tokens for 3 epochs." }, { chunkId: "c2", text: "Results\nSAR reaches 87.4 percent exact-match accuracy, compared with 79.1 percent for the dense baseline." }];
  const r = await evaluateFaithfulness({ source: chunks, claims: [
    { text: "SAR reaches 87.4 percent accuracy versus 79.1 percent for the dense baseline.", cites: ["c2"] },
    { text: "The model was trained on 38 billion tokens for 3 epochs.", cites: ["c2", "nope"] },
    { text: "SAR reaches 87.4 percent accuracy versus 79.1 percent for the dense baseline.", cites: [] }
  ] });
  assert.equal(r.citations.citedChunks, 2);
  assert.equal(r.citations.supportingCitations, 1);
  assert.equal(r.citations.precision, 0.5);
  assert.equal(r.citations.unknownChunkIds, 1);
  assert.equal(r.citations.recall, 0.333);
});

test("a judge can decide meaning, but cannot rescue an invented figure, and a failing judge falls back to the proxy", async () => {
  const para = "Accuracy of the proposed method is 87.4 percent while the dense model gets 79.1 percent.";
  const judge = async () => ({ label: "UNSUPPORTED", rationale: "test" });
  const j = await one(para, { judge });
  assert.equal(j.status, STATUS.UNSUPPORTED);
  assert.equal(j.method, "JUDGE_WITH_LEXICAL_PROXY");
  assert.equal(j.needsReview, true); // judge and proxy disagree
  const rescue = await one("SAR reaches 91.2 percent exact-match accuracy.", { judge: async () => ({ label: "SUPPORTED" }) });
  assert.equal(rescue.status, STATUS.UNSUPPORTED);
  const broken = await one(para, { judge: async () => { throw new Error("boom"); } });
  assert.equal(broken.method, "LEXICAL_PROXY");
  const junk = await one(para, { judge: async () => ({ label: "MAYBE" }) });
  assert.equal(junk.method, "LEXICAL_PROXY");
});

test("deterministic, and bounded on hostile input (huge summary, huge source, no sentence breaks)", async () => {
  const a = await evaluateFaithfulness({ source: SOURCE, summary: "SAR reaches 87.4 percent accuracy." });
  const b = await evaluateFaithfulness({ source: SOURCE, summary: "SAR reaches 87.4 percent accuracy." });
  assert.deepEqual(a, b);
  const t0 = Date.now();
  const big = await evaluateFaithfulness({ source: "word ".repeat(400000), summary: "x ".repeat(200000) });
  assert.ok(Date.now() - t0 < 10000, "bounded work");
  assert.ok(big.claims.length <= 200);
  assert.ok(buildPassages("a. ".repeat(100000)).length <= 5000);
});
