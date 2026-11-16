"use strict";
/**
 * Evidence display model (services/evidenceModel.ts). The model is fed with the REAL backend validator's output (validateIntelligence on the
 * fictional papers of the regression fixture), so the offsets, qualifiers and drop counts it parses are the ones production produces.
 * No network, no UI renderer: this tests what the screens are allowed to say and show, not how they look.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fx = require("../fixtures/evidence_regression.json");
const { validateIntelligence } = require("../../llm/intelligence");
const M = require(path.resolve(__dirname, "../../../services/evidenceModel.ts"));

const FORBIDDEN = /\b(verified|verify|accurate|accuracy|guarantee[ds]?|proven|proof|certified|validated|trustworthy|reliable|correct)\b/i;
const chunks = fx.papers.P1;

function analysisBody(parsed, extra = {}) {
  const v = validateIntelligence(parsed, chunks);
  return {
    v,
    body: {
      paper: { paperId: "doi:10.9999/fixture", title: "A fictional paper", doi: "10.9999/fixture", sourceUrl: null, license: "cc-by" },
      contentCoverage: "FULL_TEXT",
      status: "UNVERIFIED",
      intelligence: v.intelligence,
      confidence: { level: "HIGH", score: 0.93, basis: "SERVER_COMPUTED_HEURISTIC" },
      verification: { method: "CITATION_AND_NUMERIC_MATCH", statementsKept: v.kept, statementsDropped: v.dropped, droppedReasons: v.reasons },
      ...extra
    }
  };
}
const PARSED = {
  findings: { text: "SAR reaches 87.4 percent exact-match accuracy versus 79.1 percent for the dense baseline.", evidence: ["c1"] },
  limitations: [
    { text: "The gains may be concentrated on questions whose evidence is more than 64k tokens away.", evidence: ["c3"] },
    { text: "The gains concentrate on questions whose evidence lies more than 64k tokens from the question.", evidence: ["c3"] }, // hedge dropped: kept with a qualifier
    { text: "SAR reaches 91.7 percent exact-match accuracy.", evidence: ["c1"] }, // number not in the source: removed
    { text: "SAR improved results on short questions.", evidence: ["c1"] } // reversed: removed
  ],
  quantitativeResults: [{ metric: "exact-match accuracy", value: "87.4%", context: "improved by 40 points over the baseline", evidence: ["c1"] }]
};

test("kept statements come with the exact source sentence offsets, qualifiers and a plain removed count", () => {
  const { body, v } = analysisBody(PARSED);
  const view = M.parseAnalysisForDisplay(body);
  assert.ok(view);
  assert.equal(view.statements.length, v.kept - view.results.length);
  const findings = view.statements.find((s) => s.field === "findings");
  assert.equal(findings.label, "Findings");
  assert.equal(findings.spans.length, 1);
  const sp = findings.spans[0];
  const chunk = chunks.find((c) => c.chunkId === sp.chunkId);
  assert.equal(chunk.text.slice(sp.start, sp.end), "On the benchmark test split Sparse Attention Routing (SAR) reaches 87.4 percent exact-match accuracy, compared with 79.1 percent for the dense baseline.", "the offsets select the supporting sentence");
  const hedged = view.statements.filter((s) => s.field === "limitations").find((s) => s.qualifiers.length);
  assert.ok(hedged && hedged.qualifiers[0].key === "HEDGE_DROPPED");
  assert.equal(hedged.qualifiers[0].note, M.EVIDENCE_COPY.hedge);
  assert.equal(view.removed.count, 2);
  assert.equal(view.removed.message, "2 statements were removed by the automatic checks.");
  assert.deepEqual(view.removed.reasons.map((r) => r.code).sort(), ["REVERSED_MEANING", "STATEMENT_NUMBER_NOT_IN_EVIDENCE"]);
  assert.equal(view.removed.detailsRemoved, 1, "the invented number in the result's context was stripped and is reported separately");
  assert.equal(view.results.length, 1);
  assert.ok(view.results[0].spans.length >= 1);
  assert.equal(view.results[0].context, "", "stripped context stays stripped");
});

test("the server's confidence score is never exposed, and no screen text claims more than a mechanical check", () => {
  const { body } = analysisBody(PARSED);
  const view = M.parseAnalysisForDisplay(body);
  assert.equal(JSON.stringify(view).toLowerCase().includes("confidence"), false);
  assert.equal(JSON.stringify(view).includes("0.93"), false);
  const copy = [...Object.values(M.EVIDENCE_COPY).map((v) => (typeof v === "function" ? v(3) : v)), ...Object.values(M.REASON_LABELS), view.checkNote, view.removed.message];
  for (const s of copy) assert.equal(FORBIDDEN.test(s), false, `forbidden wording in: ${s}`);
  for (const n of [0, 1, 2, 17]) {
    const r = M.summariseRemoved({ statementsDropped: n, statementsKept: 5, droppedReasons: {} });
    assert.equal(FORBIDDEN.test(r.message), false, r.message);
  }
  assert.match(M.summariseRemoved({ statementsDropped: 0, statementsKept: 5, droppedReasons: {} }).message, /errors can remain/);
});

test("a statement without a matching sentence has no spans; malformed spans and items are dropped, not repaired", () => {
  const body = {
    paper: { paperId: "doi:10.9999/x", title: "T" },
    contentCoverage: "ABSTRACT_ONLY",
    intelligence: {
      tldr: { text: "A statement.", evidence: ["c1"], basis: "STATED", evidenceSpans: [] },
      methodology: { text: "Another.", basis: "INFERRED", evidenceSpans: [{ chunkId: "c1", start: 10, end: 5 }, { chunkId: "", start: 0, end: 4 }, { chunkId: "c1", start: -1, end: 4 }, { chunkId: "c1", start: 0, end: 4 }, "x", null] },
      findings: { text: "   " }, dataset: 12, limitations: [null, { text: "Kept." }, "no"],
      quantitativeResults: [{ metric: "m", value: "" }, { metric: "ok", value: "5", evidenceSpans: "no" }, "x"]
    },
    verification: { statementsKept: 2, statementsDropped: 1, droppedReasons: { SOMETHING_NEW: 1, WEAK_SUPPORT: "3", OVERCLAIM: -2 } }
  };
  const view = M.parseAnalysisForDisplay(body);
  assert.deepEqual(view.statements.map((s) => s.key), ["tldr", "methodology", "limitations:1"]);
  assert.deepEqual(view.statements[0].spans, []);
  assert.deepEqual(view.statements[1].spans, [{ chunkId: "c1", start: 0, end: 4 }]);
  assert.equal(view.statements[1].basis, "INFERRED");
  assert.equal(view.results.length, 1);
  assert.deepEqual(view.removed.reasons, [{ code: "SOMETHING_NEW", label: "did not pass a check", count: 1 }]);
  assert.equal(M.parseAnalysisForDisplay(null), null);
  assert.equal(M.parseAnalysisForDisplay({ intelligence: null }), null);
  assert.equal(M.summariseRemoved({ statementsDropped: "2" }), null);
});

test("the source link falls back to the DOI, and is null when there is neither", () => {
  assert.equal(M.parseAnalysisForDisplay({ intelligence: {}, paper: { doi: "10.1/x" } }).sourceUrl, "https://doi.org/10.1/x");
  assert.equal(M.parseAnalysisForDisplay({ intelligence: {}, paper: { doi: "10.1/x", sourceUrl: "https://example.org/p" } }).sourceUrl, "https://example.org/p");
  assert.equal(M.parseAnalysisForDisplay({ intelligence: {}, paper: {} }).sourceUrl, null);
});

test("sentence answers: text is accepted only when the server says it is available, and a withheld answer never carries text", () => {
  const src = { title: "T", license: "cc-by", attributionRequired: true, doi: "10.1/x" };
  const ok = M.parseSentenceResponse({ available: true, text: " 87.4 percent ", section: "RESULTS", source: src, notice: "n" });
  assert.equal(ok.state, "AVAILABLE");
  assert.equal(ok.text, "87.4 percent");
  assert.equal(ok.source.attributionRequired, true);
  assert.equal(ok.source.sourceUrl, "https://doi.org/10.1/x");
  const withheld = M.parseSentenceResponse({ available: false, reason: "LICENSE_DOES_NOT_ALLOW_SERVING_TEXT", text: "SHOULD NOT BE SHOWN", source: src });
  assert.equal(withheld.state, "LICENSE_WITHHELD");
  assert.equal(JSON.stringify(withheld).includes("SHOULD NOT BE SHOWN"), false);
  for (const bad of [null, "x", {}, { available: "yes", text: "t" }, { available: true }, { available: true, text: "  " }]) assert.equal(M.parseSentenceResponse(bad).state, "ERROR", JSON.stringify(bad));
});

test("loading a sentence: encoded path for DOI ids, the span as query, caching of answers but not of errors", async () => {
  M.clearEvidenceCache();
  const calls = [];
  let mode = "ok";
  const client = {
    get: async (p, opts) => {
      calls.push({ p, opts });
      if (mode === "throw") throw new Error("boom");
      if (mode === "404") { const e = new Error("nf"); e.kind = "NOT_FOUND"; throw e; }
      return { available: true, text: "A sentence.", source: {} };
    }
  };
  const describe = (e) => `failed: ${e.message}`;
  const nf = (e) => e && e.kind === "NOT_FOUND";
  const span = { chunkId: "doi:10.1234/ab.c_chunk_3", start: 4, end: 40 };
  const r1 = await M.loadSentence(client, "doi:10.1234/ab.c", span, describe, nf);
  assert.equal(r1.state, "AVAILABLE");
  assert.equal(calls[0].p, "/api/v1/papers/doi%3A10.1234%2Fab.c/evidence/doi%3A10.1234%2Fab.c_chunk_3");
  assert.deepEqual(calls[0].opts.query, { start: 4, end: 40 });
  await M.loadSentence(client, "doi:10.1234/ab.c", span, describe, nf);
  assert.equal(calls.length, 1, "an available sentence is remembered");
  mode = "throw";
  const other = { chunkId: "doi:10.1234/ab.c_chunk_4", start: 0, end: 9 };
  assert.deepEqual(await M.loadSentence(client, "doi:10.1234/ab.c", other, describe, nf), { state: "ERROR", message: "failed: boom" });
  mode = "ok";
  assert.equal((await M.loadSentence(client, "doi:10.1234/ab.c", other, describe, nf)).state, "AVAILABLE", "an error is not remembered, so retry asks again");
  mode = "404";
  assert.deepEqual(await M.loadSentence(client, "doi:10.1234/ab.c", { chunkId: "x_chunk_1", start: 0, end: 3 }, describe, nf), { state: "NOT_FOUND" });
});

test("the evidence path matches the real route (encoded ids are decoded by the server)", () => {
  const p = M.evidencePath("doi:10.1234/ab.c", { chunkId: "doi:10.1234/ab.c_chunk_3", start: 0, end: 5 });
  assert.equal(p.split("/").length, 7, "no raw slash from the ids leaks into the path");
});

test("the evidence components contain no wording that presents a check as a guarantee, and take the quotation only from the endpoint", () => {
  const fs = require("fs");
  for (const f of ["components/research/EvidenceStatementCard.tsx", "components/research/EvidenceSummaryNote.tsx"]) {
    const code = fs.readFileSync(path.resolve(__dirname, "../../..", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const lit of code.match(/"[^"\n]{3,}"|`[^`\n]{3,}`|>[^<>{}\n]{3,}</g) || []) assert.equal(FORBIDDEN.test(lit), false, `${f}: ${lit}`);
    assert.equal(/\.evidence\b|chunkText|\.excerpt\b/.test(code), false, `${f}: must not read chunk text from the analysis response`);
  }
  const card = fs.readFileSync(path.resolve(__dirname, "../../../components/research/EvidenceStatementCard.tsx"), "utf8");
  assert.match(card, /loadSentence\(api,/, "the sentence comes from the evidence endpoint");
  assert.equal(/confidence/i.test(card), false);
});
