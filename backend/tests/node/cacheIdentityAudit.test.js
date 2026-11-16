"use strict";
/**
 * Cache identity audit (offline: stub model, in-memory Redis stand-in, no network, no paid calls).
 *
 * Question answered: if ANY analysis-relevant input changes, can a stale cached answer be served?
 *
 * Method: run the REAL aiPipeline (answerQuestion / analyzePaper) through the REAL result cache. Establish a cached baseline,
 * then change exactly one input and observe whether the stub model is called again (key changed -> correct) or the cache
 * answers (key unchanged -> the old answer is reused). "Controls" prove the harness can see a hit, so a miss is meaningful.
 *
 * Gaps that exist today are written as `todo` tests that assert the DESIRED behaviour; they report as todo, not as failures,
 * and become real tests the moment the gap is closed.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createAiPipeline } = require("../../llm/aiPipeline");
const { createResultCache, CACHE_SCHEMA_VERSION } = require("../../llm/resultCache");
const { PROMPT_VERSION } = require("../../llm/copilotService");
const { INTEL_PROMPT_VERSION, INTEL_SCHEMA_VERSION } = require("../../llm/intelligence");
const { modelStub } = require("./helpers");
const { loadBehaviour, behaviourMaterial } = require("./fingerprintProbes");

/** Minimal in-memory stand-in for the three Redis commands the cache uses. */
function memoryRedis() {
  const m = new Map();
  return {
    async command(op, key, val, ...rest) {
      op = String(op).toUpperCase();
      if (op === "GET") return m.has(key) ? m.get(key) : null;
      if (op === "EXISTS") return m.has(key) ? 1 : 0;
      if (op === "SET") {
        if (rest.includes("NX") && m.has(key)) return null;
        m.set(key, val);
        return "OK";
      }
      throw new Error(`unexpected redis command ${op}`);
    },
    async eval(_s, keys, argv) {
      if (m.get(keys[0]) === argv[0]) { m.delete(keys[0]); return 1; }
      return 0;
    }
  };
}

const PAPER_ID = "arxiv:2401.00001";
const mkChunks = (paperId, over = {}) => [
  { chunkId: `${paperId}_chunk_1`, paperId, ordinal: 1, section: "ABSTRACT", heading: "Abstract", text: "We study sparse coding in cortex. Accuracy rose to 91.2 percent." },
  { chunkId: `${paperId}_chunk_2`, paperId, ordinal: 2, section: "RESULTS", heading: "Results", text: "On the held-out set the method reached 91.2 percent accuracy.", ...over }
];

function harness({ env = {}, paper = {}, chunks, ctx = {} } = {}) {
  const redis = memoryRedis();
  const cache = createResultCache({ redis, pollMs: 1, lockMs: 50 });
  const stub = modelStub();
  const state = { paper: { paperId: PAPER_ID, title: "Sparse coding", coverage: "FULL_TEXT", coverageNotice: null, authors: [], year: 2024, ...paper }, chunks: chunks || mkChunks(PAPER_ID) };
  const paperService = { async resolve() { return { paper: state.paper }; }, async loadChunks() { return state.chunks; } };
  const baseEnv = { ANTHROPIC_API_KEY: "TESTKEY-not-a-real-credential-0001", ANTHROPIC_MODEL: "claude-sonnet-5-5", ...env };
  const make = (e = {}) => createAiPipeline({ paperService, cache, client: stub, env: { ...baseEnv, ...e }, replicaId: "r1", logger: { warn() {}, error() {}, log() {} } });
  const scope = { tenantId: "tenant_a", projectId: "prj_1", ...(ctx.scope || {}) };
  return { state, stub, make, scope, cache, calls: () => stub.calls.length };
}

/** Run `fn` and report whether the model was called (true => cache did NOT serve a stored answer). */
async function missed(h, fn) {
  const before = h.calls();
  await fn();
  return h.calls() > before;
}

const Q = (h, over = {}, envOver, scope) => h.make(envOver).answerQuestion({ query: "What accuracy was reached?", paperId: PAPER_ID, analysisDepth: "STANDARD", ...over }, { scope: scope || h.scope, uid: "u1" });
const I = (h, over = {}, envOver, scope) => h.make(envOver).analyzePaper({ paperId: PAPER_ID, analysisDepth: "STANDARD", ...over }, { scope: scope || h.scope, uid: "u1" });

test("control: an identical repeat is served from cache (harness can see a hit)", async () => {
  const h = harness();
  assert.equal(await missed(h, () => Q(h)), true, "first call computes");
  assert.equal(await missed(h, () => Q(h)), false, "identical repeat must hit");
  assert.equal(await missed(h, () => I(h)), true);
  assert.equal(await missed(h, () => I(h)), false);
});

test("controls: inputs that must NOT change the answer still hit (another member of the same project, padded question)", async () => {
  const h = harness();
  await Q(h);
  assert.equal(await missed(h, () => h.make().answerQuestion({ query: "  What accuracy was reached?  ", paperId: PAPER_ID, analysisDepth: "STANDARD" }, { scope: h.scope, uid: "someone-else" })), false);
});

const questionCases = {
  "tenant": (h) => Q(h, {}, undefined, { ...h.scope, tenantId: "tenant_b" }),
  "project": (h) => Q(h, {}, undefined, { ...h.scope, projectId: "prj_2" }),
  "question text": (h) => Q(h, { query: "What dataset was used?" }),
  "analysis depth": (h) => Q(h, { analysisDepth: "DEEP" }),
  "model": (h) => Q(h, {}, { ANTHROPIC_MODEL: "claude-opus-5-5" })
};
for (const [name, run] of Object.entries(questionCases)) {
  test(`question path: changing ${name} invalidates the cached answer`, async () => {
    const h = harness();
    await Q(h);
    assert.equal(await missed(h, () => run(h)), true, `${name} changed but a stored answer was reused`);
  });
}

const evidenceMutations = {
  "chunk text": (h) => { h.state.chunks = mkChunks(PAPER_ID, { text: "On the held-out set the method reached 71.2 percent accuracy." }); },
  "chunk section": (h) => { h.state.chunks = mkChunks(PAPER_ID, { section: "DISCUSSION" }); },
  "an extra chunk": (h) => { h.state.chunks = [...mkChunks(PAPER_ID), { chunkId: `${PAPER_ID}_chunk_3`, paperId: PAPER_ID, ordinal: 3, section: "RESULTS", heading: "More", text: "We also report accuracy on a second corpus: 88 percent." }]; },
  "a removed chunk": (h) => { h.state.chunks = mkChunks(PAPER_ID).slice(0, 1); }
};
for (const [name, mutate] of Object.entries(evidenceMutations)) {
  test(`question path: evidence change (${name}) invalidates the cached answer`, async () => {
    const h = harness();
    await Q(h);
    mutate(h);
    assert.equal(await missed(h, () => Q(h)), true, `${name}: stale answer reused after the evidence changed`);
  });
  test(`intelligence path: evidence change (${name}) invalidates the cached analysis`, async () => {
    const h = harness();
    await I(h);
    mutate(h);
    assert.equal(await missed(h, () => I(h)), true, `${name}: stale analysis reused after the evidence changed`);
  });
}

test("intelligence path: tenant, project, depth and model each invalidate", async () => {
  for (const [name, run] of Object.entries({
    tenant: (h) => I(h, {}, undefined, { ...h.scope, tenantId: "tenant_b" }),
    project: (h) => I(h, {}, undefined, { ...h.scope, projectId: "prj_2" }),
    depth: (h) => I(h, { analysisDepth: "DEEP" }),
    model: (h) => I(h, {}, { ANTHROPIC_MODEL: "claude-opus-5-5" })
  })) {
    const h = harness();
    await I(h);
    assert.equal(await missed(h, () => run(h)), true, `${name} changed but a stored analysis was reused`);
  }
});

test("a different paper never reuses another paper's answer", async () => {
  const h = harness();
  await Q(h);
  const other = "arxiv:2401.00002";
  h.state.paper = { ...h.state.paper, paperId: other };
  h.state.chunks = mkChunks(other);
  assert.equal(await missed(h, () => h.make().answerQuestion({ query: "What accuracy was reached?", paperId: other, analysisDepth: "STANDARD" }, { scope: h.scope, uid: "u1" })), true);
});

test("question and intelligence results can never collide in the cache", async () => {
  const h = harness();
  await I(h);
  assert.equal(await missed(h, () => Q(h, { query: "STRUCTURED_INTELLIGENCE" })), true);
});

test("only complete real answers are stored: a provider failure leaves nothing to serve", async () => {
  const h = harness();
  h.stub.callMessages = async () => { throw Object.assign(new Error("boom"), { category: "PROVIDER_UNAVAILABLE", retryable: true }); };
  const out = await Q(h);
  assert.equal(out.body.fallbackUsed, true);
  const h2Calls = [];
  h.stub.callMessages = async (o) => { h2Calls.push(o); return modelStub().callMessages(o); };
  await Q(h);
  assert.equal(h2Calls.length, 1, "after a failed call the next identical request must reach the model, not a stored fallback");
});

// ---------------------------------------------------------------------------------------------------------------
// C4: a cache hit replays a stored model answer, but the metadata that describes the paper (header, coverage, notice, document
// hash, evidence-selection counts) must be the CURRENT one, not whatever the request that wrote the entry saw. The cached
// answer, evidence, claims, confidence and tokens are reused and the model is not called again.
//   question body:     paper, contentCoverage, coverageNotice (omitted when empty), context. No contentHash.
//   intelligence body: paper, contentCoverage, coverageNotice, contentHash (whole-document hash of the paper), context.
// ---------------------------------------------------------------------------------------------------------------
const OLD_PAPER = { title: "Sparse coding", authors: ["A. Author"], year: 2023, venue: "Old Venue", doi: "10.1000/old", pmid: "111", arxivId: "2401.00001v1", source: "arxiv", sourceUrl: "https://example.org/old", license: "CC-BY-4.0", coverageNotice: "Analysis is based on the open-access full text from arxiv.", contentHash: "doc-hash-old" };
const NEW_PAPER = { authors: ["A. Author", "B. Author"], year: 2024, venue: "New Venue", doi: "10.1000/new", pmid: "222", arxivId: "2401.00001v2", source: "pmc", sourceUrl: "https://example.org/new", license: "CC0-1.0", coverageNotice: "Analysis is based on the open-access full text from pmc.", contentHash: "doc-hash-new" };
const headerOf = (p) => ({ paperId: p.paperId, title: p.title, authors: p.authors, year: p.year, venue: p.venue, doi: p.doi, pmid: p.pmid, arxivId: p.arxivId, source: p.source, sourceUrl: p.sourceUrl, license: p.license });
const pick = (body, keys) => Object.fromEntries(keys.filter((k) => k in body).map((k) => [k, body[k]]));
const GENERATED = ["answer", "claims", "citedChunkIds", "evidence", "confidence", "intelligence", "verification", "status", "verificationStatus", "promptVersion", "analysisDepth", "requestedModel", "modelMode", "provider", "model"];
const bigChunk = (n, ordinal) => ({ chunkId: `${PAPER_ID}_chunk_big${n}`, paperId: PAPER_ID, ordinal, section: "DISCUSSION", heading: "Discussion", text: `Unselected filler ${n}. `.repeat(150) });
/** A pipeline with NO cache over the same paper state: what a fresh compute returns. */
const freshPipeline = (h) => createAiPipeline({ paperService: { async resolve() { return { paper: h.state.paper }; }, async loadChunks() { return h.state.chunks; } }, cache: null, client: modelStub(), env: { ANTHROPIC_API_KEY: "TESTKEY-not-a-real-credential-0001", ANTHROPIC_MODEL: "claude-sonnet-5-5", AI_MAX_CONTEXT_CHARS: "2000" }, replicaId: "r1", logger: { warn() {}, error() {}, log() {} } });
const TIGHT = { AI_MAX_CONTEXT_CHARS: "2000" }; // minimum context budget: lets a test leave chunks out of the selection

test("C4 question path: a cache hit returns the current paper header, coverage and notice, and reuses the cached answer", async () => {
  const h = harness({ paper: OLD_PAPER });
  const first = await Q(h);
  assert.equal(first.body.cache.status, "MISS");
  assert.equal(h.calls(), 1);
  assert.equal(first.body.paper.venue, "Old Venue");

  h.state.paper = { ...h.state.paper, ...NEW_PAPER, title: "Sparse coding in cortex (revised)", coverage: "ABSTRACT_ONLY", coverageNotice: "Only the abstract was available." };
  const second = await Q(h);

  assert.equal(second.body.cache.status, "HIT");
  assert.equal(h.calls(), 1, "no new model call");
  assert.deepEqual(second.body.paper, headerOf(h.state.paper));
  assert.equal(second.body.contentCoverage, "ABSTRACT_ONLY");
  assert.equal(second.body.coverageNotice, "Only the abstract was available.");
  assert.deepEqual(pick(second.body, GENERATED), pick(first.body, GENERATED), "the generated answer and its structure are unchanged");
  assert.equal(second.body.cache.originalRequestId, first.body.requestId);
  assert.equal(second.body.tokens.source, "CACHE");
  assert.deepEqual(second.body.tokens.originalTokens, first.body.tokens);
  assert.equal(Object.hasOwn(second.body, "contentHash"), false, "the question body has no contentHash and must not gain one");
});

test("C4 question path: coverageNotice follows the paper (added when it appears, removed when it goes), never left stale", async () => {
  // cached WITHOUT a notice, paper gains one
  const h1 = harness({ paper: { coverageNotice: null } });
  const first = await Q(h1);
  assert.equal(Object.hasOwn(first.body, "coverageNotice"), false);
  h1.state.paper = { ...h1.state.paper, coverageNotice: "Analysis is based on the open-access full text from arxiv." };
  const gained = await Q(h1);
  assert.equal(gained.body.cache.status, "HIT");
  assert.equal(gained.body.coverageNotice, "Analysis is based on the open-access full text from arxiv.");

  // cached WITH a notice, paper loses it: the stored notice must not be served
  const h2 = harness({ paper: { coverageNotice: "Only the abstract was available." } });
  assert.equal((await Q(h2)).body.coverageNotice, "Only the abstract was available.");
  h2.state.paper = { ...h2.state.paper, coverageNotice: null };
  const lost = await Q(h2);
  assert.equal(lost.body.cache.status, "HIT");
  assert.equal(Object.hasOwn(lost.body, "coverageNotice"), false, "an outdated notice must not survive");
  assert.equal(h1.calls() + h2.calls(), 2, "one model call per harness, none for the hits");
});

test("C4 question path: context reflects the current selection (chunks left out), with the same chunks sent and the cached answer", async () => {
  const h = harness();
  const ids = [`${PAPER_ID}_chunk_1`, `${PAPER_ID}_chunk_2`];
  const first = await Q(h, { chunkIds: ids });
  assert.deepEqual(first.body.context, { chunksSent: 2, chunksOmitted: 0, truncated: false });
  h.state.chunks = [...h.state.chunks, bigChunk(1, 3)]; // a new stored chunk the client did not ask for: the sent evidence is identical
  const second = await Q(h, { chunkIds: ids });
  assert.equal(second.body.cache.status, "HIT");
  assert.equal(h.calls(), 1);
  assert.deepEqual(second.body.context, { chunksSent: 2, chunksOmitted: 1, truncated: false });
  assert.equal(second.body.answer, first.body.answer);
});

test("C4 intelligence path: a cache hit returns the current paper header, coverage, notice and document hash, and reuses the cached analysis", async () => {
  const h = harness({ paper: OLD_PAPER });
  const first = await I(h);
  assert.equal(first.body.cache.status, "MISS");
  assert.equal(h.calls(), 1);
  assert.equal(first.body.contentHash, "doc-hash-old");

  // the title is deliberately unchanged: it is part of the analysis prompt and of the cache identity (C2), so a new title is a MISS
  h.state.paper = { ...h.state.paper, ...NEW_PAPER, coverageNotice: "Analysis is based on the open-access full text from pmc." };
  const second = await I(h);

  assert.equal(second.body.cache.status, "HIT");
  assert.equal(h.calls(), 1, "no new model call");
  assert.deepEqual(second.body.paper, headerOf(h.state.paper));
  assert.equal(second.body.contentCoverage, "FULL_TEXT");
  assert.equal(second.body.coverageNotice, "Analysis is based on the open-access full text from pmc.");
  assert.equal(second.body.contentHash, "doc-hash-new", "the paper's whole-document hash, not the cache key's hash of the selected chunks");
  assert.deepEqual(pick(second.body, GENERATED), pick(first.body, GENERATED), "the generated analysis and its structure are unchanged");
  assert.equal(second.body.cache.originalRequestId, first.body.requestId);
  assert.equal(second.body.tokens.source, "CACHE");
});

test("C4 intelligence path: contentHash is kept as cached when the paper has none now (never null or undefined); context follows the selection", async () => {
  const h = harness({ env: TIGHT, paper: OLD_PAPER, chunks: [...mkChunks(PAPER_ID), bigChunk(1, 3)] });
  const first = await I(h, {}, TIGHT);
  assert.equal(first.body.cache.status, "MISS");
  assert.deepEqual(first.body.context, { chunksSent: 2, chunksOmitted: 1, truncated: true });

  const { contentHash: _gone, ...noHash } = h.state.paper;
  h.state.paper = noHash;
  h.state.chunks = [...h.state.chunks, bigChunk(2, 4)]; // another chunk that does not fit the budget: the selected evidence is identical
  const second = await I(h, {}, TIGHT);

  assert.equal(second.body.cache.status, "HIT");
  assert.equal(h.calls(), 1);
  assert.equal(second.body.contentHash, "doc-hash-old");
  assert.deepEqual(second.body.context, { chunksSent: 2, chunksOmitted: 2, truncated: true });
});

test("C4: the refreshed metadata equals what a fresh, uncached compute returns for the same paper state (both paths)", async () => {
  const h = harness({ env: TIGHT, paper: OLD_PAPER, chunks: [...mkChunks(PAPER_ID), bigChunk(1, 3)] });
  const ids = [`${PAPER_ID}_chunk_1`, `${PAPER_ID}_chunk_2`];
  await Q(h, { chunkIds: ids }, TIGHT);
  await I(h, {}, TIGHT);
  h.state.paper = { ...h.state.paper, ...NEW_PAPER };
  h.state.chunks = [...h.state.chunks, bigChunk(2, 4)];
  const ctx = { scope: h.scope, uid: "u1" };

  const hitQ = await Q(h, { chunkIds: ids }, TIGHT);
  const hitI = await I(h, {}, TIGHT);
  const fresh = freshPipeline(h);
  const freshQ = await fresh.answerQuestion({ query: "What accuracy was reached?", paperId: PAPER_ID, analysisDepth: "STANDARD", chunkIds: ids }, ctx);
  const freshI = await fresh.analyzePaper({ paperId: PAPER_ID, analysisDepth: "STANDARD" }, ctx);

  assert.equal(hitQ.body.cache.status, "HIT");
  assert.equal(hitI.body.cache.status, "HIT");
  assert.equal(freshQ.body.cache.status, "NOT_WIRED");
  const META_Q = ["paper", "contentCoverage", "coverageNotice", "context"];
  const META_I = ["paper", "contentCoverage", "coverageNotice", "contentHash", "context"];
  assert.deepEqual(pick(hitQ.body, META_Q), pick(freshQ.body, META_Q));
  assert.deepEqual(pick(hitI.body, META_I), pick(freshI.body, META_I));
  assert.equal(h.calls(), 2, "only the two baseline calls were made by the cached pipeline");
});

test("C4: a request that waited for another request's entry (DEDUPLICATED) also gets its own current metadata", async () => {
  const redis = memoryRedis();
  const cache = createResultCache({ redis, pollMs: 1, lockMs: 500 });
  const stub = modelStub({ delayMs: 40 });
  const chunks = mkChunks(PAPER_ID);
  let n = 0;
  const papers = [{ paperId: PAPER_ID, title: "Sparse coding", coverage: "FULL_TEXT", coverageNotice: null, authors: [], year: 2024, venue: "Venue seen by the first request" }, { paperId: PAPER_ID, title: "Sparse coding", coverage: "FULL_TEXT", coverageNotice: null, authors: [], year: 2024, venue: "Venue seen by the second request" }];
  const paperService = { async resolve() { return { paper: papers[Math.min(n++, 1)] }; }, async loadChunks() { return chunks; } };
  const p = createAiPipeline({ paperService, cache, client: stub, env: { ANTHROPIC_API_KEY: "TESTKEY-not-a-real-credential-0001", ANTHROPIC_MODEL: "claude-sonnet-5-5" }, replicaId: "r1", logger: { warn() {}, error() {}, log() {} } });
  const run = () => p.answerQuestion({ query: "What accuracy was reached?", paperId: PAPER_ID, analysisDepth: "STANDARD" }, { scope: { tenantId: "tenant_a", projectId: "prj_1" }, uid: "u1" });
  const [a, b] = await Promise.all([run(), run()]);
  assert.equal(stub.calls.length, 1, "one model call for two concurrent identical requests");
  assert.equal(a.body.cache.status, "MISS");
  assert.equal(b.body.cache.status, "DEDUPLICATED");
  assert.equal(a.body.paper.venue, "Venue seen by the first request");
  assert.equal(b.body.paper.venue, "Venue seen by the second request");
});

// ---------------------------------------------------------------------------------------------------------------
// Identity of the structured analysis beyond the evidence text: the paper title (C2) and the coverage label are both inputs to
// the prompt, and coverage also weights the confidence, so either one changing must produce a new analysis, not a stored one.
// ---------------------------------------------------------------------------------------------------------------
test("intelligence path: changing the paper title (it is part of the structured-analysis prompt) is a cache miss and a new model call", async () => {
  const h = harness();
  const first = await I(h);
  assert.equal(first.body.cache.status, "MISS");
  assert.equal(h.calls(), 1);
  h.state.paper = { ...h.state.paper, title: "A completely different title" };
  const second = await I(h);
  assert.equal(second.body.cache.status, "MISS");
  assert.equal(h.calls(), 2, "the changed title must reach the model again");
  assert.equal(second.body.paper.title, "A completely different title");
  const third = await I(h);
  assert.equal(third.body.cache.status, "HIT", "the same new title is then served from cache");
  assert.equal(h.calls(), 2);
});

test("intelligence path: changing the coverage label (prompt input and confidence weight) is a cache miss, even with identical evidence", async () => {
  const h = harness();
  const first = await I(h);
  assert.equal(first.body.contentCoverage, "FULL_TEXT");
  // Phase 4: the served confidence is reduced to {level, basis} by responseGate (the heuristic score and its factors are never exposed),
  // so the coverage that fed the weight is no longer visible in the response; contentCoverage below is what the response states.
  assert.equal(first.body.confidence.factors, undefined);
  assert.equal(first.body.confidence.score, undefined);
  h.state.paper = { ...h.state.paper, coverage: "ABSTRACT_ONLY" }; // same chunks, different coverage
  const second = await I(h);
  assert.equal(second.body.cache.status, "MISS");
  assert.equal(h.calls(), 2, "a new analysis was made under the new coverage");
  assert.equal(second.body.contentCoverage, "ABSTRACT_ONLY");
  assert.equal(second.body.confidence.factors, undefined, "the heuristic factors are not served");
  assert.ok(second.body.confidence.level, "a coarse level is still served");
  assert.equal((await I(h)).body.cache.status, "HIT", "unchanged coverage still hits");
  assert.equal(h.calls(), 2);
});

// The state above is reachable with the real paper service output: the REAL chunker stores an abstract-only paper as the abstract
// chunk and a full-text paper as the abstract chunk plus body chunks, and the evidence selector keeps only what fits
// AI_MAX_CONTEXT_CHARS (default 120000, minimum 2000). When the budget is about the size of the abstract, both coverages send
// the very same single chunk, so the evidence hash cannot tell them apart. At the default budget they differ.
test("coverage-only change is reachable through the real chunker and selector with a small AI_MAX_CONTEXT_CHARS, and is then re-analysed", async () => {
  const { chunkDocument } = require("../../papers/chunker");
  const { selectForIntelligence } = require("../../llm/evidence");
  const { contentHash } = require("../../llm/resultCache");
  const abstract = "The model improves accuracy on the held-out benchmark by a wide margin. ".repeat(26).trim().slice(0, 1900);
  const para = (n) => `Body paragraph ${n} describes the experimental protocol in detail. `.repeat(12);
  const sections = [
    { heading: "Introduction", leaf: "Introduction", paragraphs: [para(1), para(2)] },
    { heading: "Methods", leaf: "Methods", paragraphs: [para(3), para(4)] },
    { heading: "Results", leaf: "Results", paragraphs: [para(5), para(6)] }
  ];
  const fullChunks = chunkDocument(PAPER_ID, { abstract, sections, tables: [], figures: [] }).chunks; // coverage FULL_TEXT
  const absChunks = chunkDocument(PAPER_ID, { abstract }, { abstractOnly: true }).chunks; // coverage ABSTRACT_ONLY
  const sent = (chunks, maxChars) => contentHash(selectForIntelligence(chunks, { maxChars }).chunks);
  assert.notEqual(sent(fullChunks, 120000), sent(absChunks, 120000), "at the default budget the two coverages never send identical evidence");
  assert.equal(sent(fullChunks, 2500), sent(absChunks, 2500), "precondition: with a small budget both coverages send the same evidence");

  const small = { AI_MAX_CONTEXT_CHARS: "2500" };
  const h = harness({ env: small, chunks: fullChunks, paper: { coverage: "FULL_TEXT" } });
  const first = await I(h, {}, small);
  assert.equal(first.body.cache.status, "MISS");
  h.state.paper = { ...h.state.paper, coverage: "ABSTRACT_ONLY" };
  h.state.chunks = absChunks; // what paperService stores after the full text stops being available
  const second = await I(h, {}, small);
  assert.equal(second.body.cache.status, "MISS", "identical evidence but a different coverage must not reuse the full-text analysis");
  assert.equal(second.body.contentCoverage, "ABSTRACT_ONLY");
  assert.equal(h.calls(), 2);
});

// Prompt/profile/validator text is identified ONLY by hand-bumped version strings. This guard turns "forgot to bump" into a
// failing test: the fingerprint below is pinned to the versions. Change a prompt -> this fails -> bump the version AND update
// the fingerprint in the same commit (which also changes every cache key, so no stale answer survives).
//
// What is fingerprinted (audit P1-2: the first version of this guard hashed only the two system prompts, so a change to how the
// untrusted text is escaped, how the prompts are assembled or how the model's numbers are validated went unnoticed):
//   - the two system prompts and the analysis profiles;
//   - the BEHAVIOUR of everything that shapes what the model receives or what is kept of its answer, run on fixed inputs:
//     neutralizeTags, safeTitleAttribute, buildUserPrompt (question), buildIntelligencePrompt (every coverage), validateIntelligence
//     (grounding, support, quantitative results) and computeConfidence. Behaviour, not source text, so reformatting or comments do not
//     move it and the pin is the same for LF and CRLF checkouts.
// The copilot system prompt is read from copilotService.js SOURCE (it is not exported); a Windows checkout (git core.autocrlf)
// stores that file with CRLF line endings, which would change the hash without changing a single prompt character, so line
// endings are normalised before hashing.
const normalizeLineEndings = (text) => text.replace(/\r\n/g, "\n");

const LLM_DIR = path.resolve(__dirname, "../../llm");
/** The real implementations and constants; a test can pass altered ones (or a variant loaded from a copy of the source). */
const realBehaviour = () => loadBehaviour(LLM_DIR);

/** The fingerprint: SHA-256 over (a) the copilot system prompt, read from source because it is not exported, and (b) everything
 *  fingerprintProbes.behaviourMaterial collects: versions, prompts, profiles, limits and the outputs of the real functions on fixed
 *  sweeps. Only behaviour and exported values are hashed, so comments, formatting, renames and line endings cannot move it. */
function promptFingerprint(copilotSrc, behaviour = realBehaviour()) {
  const sysCopilot = /const SYSTEM_PROMPT = \[([\s\S]*?)\]\.join\("\\n"\);/.exec(normalizeLineEndings(copilotSrc));
  assert.ok(sysCopilot, "copilot SYSTEM_PROMPT block not found: update this guard together with the refactor");
  const material = JSON.stringify({ copilotSystem: sysCopilot[1], behaviour: behaviourMaterial(behaviour) });
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 16);
}
const readCopilotSource = () => require("fs").readFileSync(require.resolve("../../llm/copilotService"), "utf8");

test("guard: prompt text, prompt assembly, escaping, validation, analysis profiles and cache schema are pinned to their version strings", () => {
  const fp = promptFingerprint(readCopilotSource());
  assert.equal(fp, PINNED_FINGERPRINT, `Prompt/profile/validation behaviour or schema changed (fingerprint ${fp}). Bump PROMPT_VERSION / INTEL_PROMPT_VERSION (so cache keys change) and then update PINNED_FINGERPRINT.`);
});

test("guard: the fingerprint is the same for LF and CRLF checkouts (Windows and Linux)", () => {
  const lf = normalizeLineEndings(readCopilotSource());
  const crlf = lf.replace(/\n/g, "\r\n");
  assert.ok(crlf.includes("\r\n") && !lf.includes("\r"), "the test input must really contain both line-ending styles");
  assert.equal(promptFingerprint(crlf), promptFingerprint(lf));
  assert.equal(promptFingerprint(lf), PINNED_FINGERPRINT);
});

test("guard is not vacuous: changing the escaping, the prompt assembly, the number grounding, the limits or the parsing changes the fingerprint", () => {
  const real = realBehaviour();
  const src = readCopilotSource();
  assert.equal(promptFingerprint(src, real), PINNED_FINGERPRINT, "control: the real behaviour matches the pin");
  const altered = {
    "neutralizeTags": { ...real, neutralizeTags: (t) => String(t).replace(/<\/?\s*excerpt\b[^>]*>/gi, "[tag removed]") }, // the old, weaker escaping
    "safeTitleAttribute": { ...real, safeTitleAttribute: (t) => String(t == null ? "" : t).replace(/"/g, "'") },
    "question prompt": { ...real, buildUserPrompt: (a) => `${real.buildUserPrompt(a)}\n` },
    "analysis prompt": { ...real, buildIntelligencePrompt: (a) => real.buildIntelligencePrompt(a).replace("Extract", "Summarise") },
    "number grounding": {
      ...real,
      // the old substring check: "5" is accepted as grounded in "15"
      validateIntelligence: (parsed, chunks) => real.validateIntelligence({ ...parsed, quantitativeResults: [] }, chunks)
    },
    "confidence": { ...real, computeConfidence: (a) => ({ ...real.computeConfidence(a), score: 1 }) },
    "model-JSON parsing": { ...real, parseModelJson: () => null },
    "a limit constant": { ...real, constants: { ...real.constants, intelLimits: { ...real.constants.intelLimits, MAX_LIST: real.constants.intelLimits.MAX_LIST + 1 } } },
    "a safety limit constant": { ...real, constants: { ...real.constants, safetyLimits: { ...real.constants.safetyLimits, TAG_ATTRIBUTE_MAX: 201 } } },
    // claimGuard (F1): a loosened threshold, a weaker strong-word list, and a validator that skips the statement-level checks
    "a claim-guard threshold": { ...real, constants: { ...real.constants, claimGuard: { ...real.constants.claimGuard, negationOverlap: 0.9 } } },
    "the strong-word list": { ...real, constants: { ...real.constants, claimGuard: { ...real.constants.claimGuard, strong: "prove" } } },
    "statement-level checks removed": {
      ...real,
      // what the validator did before F1: a narrative statement is kept when it cites a chunk and overlaps it lexically
      validateIntelligence: (parsed, chunks) => {
        const v = real.validateIntelligence(parsed, chunks);
        const loose = real.validateIntelligence({ tldr: { text: "Sparse routing reached 91.7 percent accuracy compared with 79.1 percent for the baseline.", evidence: [chunks[0].chunkId] }, quantitativeResults: [] }, chunks);
        return { ...v, intelligence: { ...v.intelligence, tldr: v.intelligence.tldr || loose.intelligence.tldr }, kept: v.kept + 1 };
      }
    }
  };
  for (const [what, behaviour] of Object.entries(altered)) {
    assert.notEqual(promptFingerprint(src, behaviour), PINNED_FINGERPRINT, `a change to the ${what} must move the fingerprint`);
  }
});

// ---- fixed-input regression tests: each security-sensitive limit or rule has its own explicit expectation, so a failure names it.
//      (The fingerprint above detects any change; these say exactly what the current behaviour is and why.)
const behaviour = realBehaviour();
const nt = behaviour.neutralizeTags;
const wordsOf = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, "0")}`);
const ev = (n, text) => ({ chunkId: `${PAPER_ID}_chunk_${n}`, paperId: PAPER_ID, ordinal: n, section: "RESULTS", heading: "H", page: null, text });

test("regression: lexical support threshold is 20% (a statement with 19% of its words in the cited text is dropped, 20% is kept)", () => {
  const w = wordsOf("a", 100);
  const chunk = [ev(1, w.join(" "))];
  const at = (k) => behaviour.validateIntelligence({ tldr: { text: [...w.slice(0, k), ...wordsOf("b", 100 - k)].join(" "), evidence: [chunk[0].chunkId] } }, chunk);
  assert.equal(at(19).kept, 0);
  assert.equal(at(19).reasons.WEAK_SUPPORT, 1);
  assert.equal(at(20).kept, 1);
  assert.equal(at(100).kept, 1);
  assert.equal(require("../../llm/intelligence").LIMITS.MIN_SUPPORT_OVERLAP, 0.2);
});

test("regression: a statement is cut at 700 characters, a list at 8 items, citations at 6 per statement", () => {
  const long = wordsOf("w", 200).join(" ");
  assert.ok(long.length > 900);
  assert.equal(behaviour.validateIntelligence({ tldr: { text: long, evidence: [ev(1, long).chunkId] } }, [ev(1, long)]).intelligence.tldr.text.length, 700);
  const many = Array.from({ length: 12 }, (_, i) => ev(i + 1, "shared evidence words alpha beta gamma delta"));
  const ids = many.map((c) => c.chunkId);
  assert.equal(behaviour.validateIntelligence({ tldr: { text: "shared evidence words alpha beta gamma delta", evidence: ids } }, many).intelligence.tldr.evidence.length, 6);
  const item = { text: "shared evidence words alpha beta gamma delta", evidence: [ids[0]] };
  assert.equal(behaviour.validateIntelligence({ contributions: Array.from({ length: 20 }, () => item) }, many).intelligence.contributions.length, 8);
});

test("regression: result rows (30), metric (200), value (100), context (400) and keywords (10 items, 60 characters) are capped", () => {
  const chunk = [ev(1, "the value 5 was measured")];
  const rows = Array.from({ length: 40 }, (_, i) => ({ metric: `m${i}`, value: "5", evidence: [chunk[0].chunkId] }));
  rows[0] = { metric: "M".repeat(300), value: "5 ".repeat(80), context: "C".repeat(500), evidence: [chunk[0].chunkId] };
  const q = behaviour.validateIntelligence({ quantitativeResults: rows }, chunk).intelligence.quantitativeResults;
  assert.deepEqual({ rows: q.length, metric: q[0].metric.length, value: q[0].value.length, context: q[0].context.length }, { rows: 30, metric: 200, value: 100, context: 400 });
  const kw = [58, 59, 60, 61, 62].map((n) => "k".repeat(n)).concat(Array.from({ length: 14 }, (_, i) => `kw${i}`));
  assert.deepEqual(behaviour.validateIntelligence({ keywords: kw }, chunk).intelligence.keywords.map((x) => x.length), [58, 59, 60, 3, 3, 3, 3, 3, 3, 3]);
});

test("regression: basis labels - only the exact string INFERRED stays INFERRED; a missing or any other label is STATED", () => {
  const chunk = [ev(1, "We study sparse coding accuracy in trials.")];
  const basisOf = (label, withLabel = true) => {
    const it = { text: "sparse coding accuracy", evidence: [chunk[0].chunkId] };
    if (withLabel) it.basis = label;
    const v = behaviour.validateIntelligence({ tldr: it, contributions: [{ ...it }] }, chunk);
    assert.equal(v.kept, 2);
    assert.equal(v.intelligence.tldr.basis, v.intelligence.contributions[0].basis, "single and list items are coerced the same way");
    return v.intelligence.tldr.basis;
  };
  assert.equal(basisOf("INFERRED"), "INFERRED");
  assert.equal(basisOf("STATED"), "STATED");
  assert.equal(basisOf(undefined, false), "STATED", "no label: STATED, not INFERRED");
  for (const other of ["inferred", "Inferred", " INFERRED", "INFERRED ", "INFERRED\n", "stated", "EXTRACTED_VERBATIM", "SERVER_COMPUTED_HEURISTIC", "", null, 0, 1, true, false, {}, [], ["INFERRED"]]) {
    assert.equal(basisOf(other), "STATED", `label ${JSON.stringify(other)} must not be trusted`);
  }
});

test("regression: statement, metric, value, context and keyword text is trimmed (String.trim white space only), and trimmed BEFORE it is cut", () => {
  const chunk = [ev(1, "We study sparse coding accuracy. The value 5 was measured.")];
  const id = chunk[0].chunkId;
  const text = (t) => behaviour.validateIntelligence({ tldr: { text: t, evidence: [id] } }, chunk).intelligence.tldr;
  for (const pad of [" ", "\t", "\n", "\r\n", "  \t\n ", "\u00a0", "\ufeff", "\u2003", "\u2028", "\u3000"]) assert.equal(text(`${pad}sparse coding accuracy${pad}`).text, "sparse coding accuracy", JSON.stringify(pad));
  // zero-width space and U+180E are not white space for String.trim and stay (the guard pins today's behaviour)
  assert.equal(text("\u200bsparse coding accuracy\u200b").text, "\u200bsparse coding accuracy\u200b");
  assert.equal(text("sparse   coding\taccuracy").text, "sparse   coding\taccuracy", "inner white space is not collapsed");
  for (const blank of ["", " ", "\t\n", "\u00a0", "\u2003"]) {
    const v = behaviour.validateIntelligence({ tldr: { text: blank, evidence: [id] } }, chunk);
    assert.deepEqual([v.kept, v.dropped, v.reasons], [0, 1, { MALFORMED_ITEM: 1 }], `blank statement ${JSON.stringify(blank)} is malformed`);
  }
  // trim first, then cut: 100 leading blanks do not shorten the 700 characters that are kept
  const long = wordsOf("w", 200).join(" ");
  const longChunk = [ev(1, long)];
  const cut = behaviour.validateIntelligence({ tldr: { text: " ".repeat(100) + long, evidence: [id] } }, longChunk).intelligence.tldr.text;
  assert.equal(cut.length, 700);
  assert.equal(cut.slice(0, 4), "w000", "it starts at the first real character, not at the blanks");

  const q = behaviour.validateIntelligence({ quantitativeResults: [{ metric: "  \t accuracy \n", value: "\n 5 \t", context: "  in trials  ", evidence: [id] }] }, chunk).intelligence.quantitativeResults[0];
  assert.deepEqual([q.metric, q.value, q.context], ["accuracy", "5", "in trials"]);
  const longQ = behaviour.validateIntelligence({ quantitativeResults: [{ metric: " ".repeat(150) + "M".repeat(100), value: " ".repeat(60) + "5", context: " ".repeat(300) + "C".repeat(200), evidence: [id] }] }, chunk).intelligence.quantitativeResults[0];
  assert.deepEqual([longQ.metric.length, longQ.value, longQ.context.length], [100, "5", 200], "metric, value and context are trimmed before their caps apply");

  // keywords: trimmed; the 60-character limit looks at the text as received (before trimming); blank ones are dropped
  const kw = ["  kw  ", "\tkw", " ".repeat(2) + "k".repeat(58) + " ".repeat(2), " " + "k".repeat(59), "k".repeat(60), "   ", "", "\u00a0kw\u00a0"];
  assert.deepEqual(behaviour.validateIntelligence({ keywords: kw }, chunk).intelligence.keywords, ["kw", "kw", "k".repeat(59), "k".repeat(60), "kw"]);
});

test("regression: citation ids - unknown and non-string ids are dropped, repeats removed (first kept, order kept) BEFORE the cap of 6, cited-chunk list has each chunk once", () => {
  const eight = Array.from({ length: 8 }, (_, i) => ev(i + 1, "shared evidence words alpha beta gamma delta"));
  const idn = (n) => eight[n - 1].chunkId;
  const t = "shared evidence words alpha beta gamma delta";
  const cites = (ids) => behaviour.validateIntelligence({ tldr: { text: t, evidence: ids } }, eight);
  const ev1 = (ids) => (cites(ids).intelligence.tldr || {}).evidence;
  assert.deepEqual(ev1([1, 1, 1, 2, 2, 3].map(idn)), [1, 2, 3].map(idn), "repeats removed");
  assert.deepEqual(ev1([3, 1, 3, 2, 1].map(idn)), [3, 1, 2].map(idn), "first occurrence kept, order kept");
  assert.deepEqual(ev1([1, 1, 1, 1, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8].map(idn)), [1, 2, 3, 4, 5, 6].map(idn), "seven repeats of one id do not use up the cap: duplicates are removed first");
  assert.deepEqual(ev1([8, 7, 6, 5, 4, 3, 2, 1].map(idn)), [8, 7, 6, 5, 4, 3].map(idn), "the cap keeps the FIRST six");
  assert.deepEqual(ev1([idn(1), "x", 1, null, idn(2), {}, [], idn(3), "arxiv:2401.00001_chunk_99", true]), [1, 2, 3].map(idn), "unknown and non-string ids are dropped");
  assert.deepEqual(ev1([idn(1).toUpperCase(), ` ${idn(2)}`, `${idn(3)} `, idn(4)]), [idn(4)], "ids must match exactly");
  for (const bad of [[], "not a list", { 0: idn(1), length: 1 }, undefined]) {
    const v = cites(bad);
    assert.deepEqual([v.kept, v.reasons.NO_VALID_CITATION], [0, 1], JSON.stringify(bad));
  }
  const shared = (ids) => ({ text: t, evidence: ids.map(idn) });
  const multi = behaviour.validateIntelligence({ tldr: shared([2, 1]), findings: shared([1, 3, 3]), contributions: [shared([3, 4, 4]), shared([2, 8])] }, eight);
  assert.deepEqual(multi.citedChunkIds, [2, 1, 3, 4, 8].map(idn), "each cited chunk once, in the order first cited");
  const rows = behaviour.validateIntelligence({ quantitativeResults: [{ metric: "m", value: "5", evidence: [idn(1), idn(1), idn(2)] }] }, [ev(1, "the value 5 was measured"), ev(2, "also 5 here")]);
  assert.deepEqual(rows.intelligence.quantitativeResults[0].evidence, [idn(1), idn(2)], "result rows de-duplicate their citations too");
});

test("regression: a model reply over 120000 characters is not parsed; fenced and chatty replies are", () => {
  const pad = (n) => `{"a":"${"x".repeat(n - 8)}"}`;
  assert.notEqual(behaviour.parseModelJson(pad(120000)), null);
  assert.equal(behaviour.parseModelJson(pad(120001)), null);
  assert.deepEqual(behaviour.parseModelJson("```json\n{\"a\":1}\n```"), { a: 1 });
  assert.deepEqual(behaviour.parseModelJson("Sure: {\"a\":{\"b\":2}} done"), { a: { b: 2 } });
  assert.equal(behaviour.parseModelJson("[1,2]"), null);
});

test("regression: the attribute run of a known tag is capped (whole tag removed up to the cap, the tail of a longer one is left visible)", () => {
  assert.equal(nt(`<excerpt ${"a".repeat(199)}>tail`), "[tag removed]tail");
  assert.equal(nt(`<excerpt ${"a".repeat(200)}>tail`), "[tag removed]a>tail", "one character over the cap: the scan stops, '<' is consumed with the run");
  assert.equal(require("../../llm/promptSafety").LIMITS.TAG_ATTRIBUTE_MAX, 200);
  // and a scan over a hostile string stays fast (the cap is what keeps it linear)
  const t0 = Date.now();
  nt("<excerpt ".repeat(50000));
  assert.ok(Date.now() - t0 < 2000, "neutralising 450 KB of '<excerpt ' must stay linear");
});

test("regression: which '<' are kept as mathematics and which are escaped (every character class that may follow it)", () => {
  for (const kept of ["a <=b", "a <5", "a <-3", "a <+3", "a <.5", "a <(x)", "a <[x]", "a <−2", "a <   5", "a < -3", "a <= b"]) assert.equal(nt(kept), kept, `kept: ${JSON.stringify(kept)}`);
  for (const [raw, out] of [["a <a", "a &lt;a"], ["a </x", "a &lt;/x"], ["a <!x", "a &lt;!x"], ["a <?x", "a &lt;?x"], ["a <    5", "a &lt;    5"], ["a ＜b", "a &lt;b"], ["a ﹤b", "a &lt;b"]]) assert.equal(nt(raw), out, `escaped: ${JSON.stringify(raw)}`);
  // the four server tags are removed in every spelling, and only whole names count
  for (const t of ["<coverage>", "</COVERAGE>", "< / coverage >", "<question x=1>", "＜/excerpt＞", "<paper_excerpts a=b>"]) assert.equal(nt(t), "[tag removed]", t);
  assert.equal(nt("<excerpts>"), "&lt;excerpts>", "'excerpts' is not the tag 'excerpt'");
});

test("regression: confidence level boundaries (HIGH from 0.75, MEDIUM from 0.50) and the score formula", () => {
  const { SINGLE_FIELDS, LIST_FIELDS } = require("../../llm/intelligence");
  const intel = (s, l, q) => { const o = { quantitativeResults: q ? [{}] : [] }; SINGLE_FIELDS.forEach((f, i) => { o[f] = i < s ? {} : null; }); LIST_FIELDS.forEach((f, i) => { o[f] = i < l ? [{}] : []; }); return o; };
  const c = (coverage, s, l, q, kept, dropped, contextTruncated = false) => behaviour.computeConfidence({ coverage, kept, dropped, intelligence: intel(s, l, q), contextTruncated });
  assert.deepEqual([c("FULL_TEXT", 3, 5, 1, 12, 1).score, c("FULL_TEXT", 3, 5, 1, 12, 1).level], [0.75, "HIGH"]);
  assert.deepEqual([c("FULL_TEXT", 4, 5, 1, 1, 0, true).score, c("FULL_TEXT", 4, 5, 1, 1, 0, true).level], [0.74, "MEDIUM"]);
  assert.deepEqual([c("FULL_TEXT", 0, 0, 0, 5, 1).score, c("FULL_TEXT", 0, 0, 0, 5, 1).level], [0.5, "MEDIUM"]);
  assert.deepEqual([c("FULL_TEXT", 0, 1, 1, 3, 1).score, c("FULL_TEXT", 0, 1, 1, 3, 1).level], [0.49, "LOW"]);
  assert.equal(c("FULL_TEXT", 12, 5, 1, 10, 0).score, 1, "full coverage, everything kept and filled");
  assert.equal(c("ABSTRACT_ONLY", 12, 5, 1, 10, 0).score, 0.45, "partial coverage is weighted 0.45");
  assert.equal(c("FULL_TEXT", 12, 5, 1, 10, 0, true).score, 0.9, "a truncated context costs 10%");
  assert.deepEqual([c("FULL_TEXT", 12, 5, 1, 0, 3).level, c("FULL_TEXT", 12, 5, 1, 0, 3).score], ["NOT_ASSESSED", null]);
});

// ---- the guard against real source variants: copies of backend/llm with the code changed, fingerprinted with the same probes.
//      Harmless edits must NOT move the fingerprint; every behaviour change below MUST. The mutation list is the audit's 14
//      realistic changes plus extra ones. If a mutation stops applying because the code was refactored, update its `find` text:
//      this meta-test fails loudly instead of silently testing nothing.
function variantFingerprint(transforms) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shords-fp-"));
  try {
    fs.mkdirSync(path.join(dir, "llm"));
    fs.mkdirSync(path.join(dir, "papers"));
    for (const f of fs.readdirSync(LLM_DIR).filter((x) => x.endsWith(".js"))) {
      let src = fs.readFileSync(path.join(LLM_DIR, f), "utf8");
      for (const t of transforms.filter((x) => x.file === f || x.file === "*")) src = t.apply(src, f);
      fs.writeFileSync(path.join(dir, "llm", f), src);
    }
    fs.copyFileSync(path.resolve(__dirname, "../../papers/identity.js"), path.join(dir, "papers", "identity.js"));
    const copilotSrc = fs.readFileSync(path.join(dir, "llm", "copilotService.js"), "utf8");
    return promptFingerprint(copilotSrc, loadBehaviour(path.join(dir, "llm")));
  } finally {
    for (const k of Object.keys(require.cache)) if (k.startsWith(dir)) delete require.cache[k];
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const edit = (file, find, replace) => ({ file, apply: (src) => { assert.ok(src.includes(find), `mutation did not apply (update the test): ${JSON.stringify(find)} not found in ${file}`); return src.replace(find, replace); } });

test("guard: comments, blank lines, indentation, trailing spaces and CRLF line endings in the source do not change the fingerprint", () => {
  assert.equal(variantFingerprint([]), PINNED_FINGERPRINT, "control: an unmodified copy has the pinned fingerprint");
  const harmless = [
    { file: "*", apply: (src, f) => `// harmless comment in ${f}\n${src}\n/* trailing block comment */\n` },
    { file: "promptSafety.js", apply: (src) => src.replace("const MAX_TITLE_CHARS = 500;", "\n\n   const   MAX_TITLE_CHARS   =   500 ;   // reformatted\n") },
    { file: "intelligence.js", apply: (src) => src.replace("const MAX_LIST = 8;", "const MAX_LIST = 8; /* the list cap */") },
    { file: "*", apply: (src) => src.replace(/\r?\n/g, "\r\n") }
  ];
  assert.equal(variantFingerprint(harmless), PINNED_FINGERPRINT);
});

const S = String.raw;
const MUTATIONS = [
  // the audit's 14 realistic changes
  ["1  drop the 'coverage' tag name", edit("promptSafety.js", '"question", "coverage"]', '"question"]')],
  ["2  tag attribute cap 200 -> 400", edit("promptSafety.js", "const TAG_ATTRIBUTE_MAX = 200;", "const TAG_ATTRIBUTE_MAX = 400;")],
  ["3  MIN_SUPPORT_OVERLAP 0.2 -> 0.1", edit("intelligence.js", "const MIN_SUPPORT_OVERLAP = 0.2;", "const MIN_SUPPORT_OVERLAP = 0.1;")],
  ["4  title cap 500 -> 800", edit("promptSafety.js", "const MAX_TITLE_CHARS = 500;", "const MAX_TITLE_CHARS = 800;")],
  ["5  drop the U+FE64 look-alike bracket", edit("promptSafety.js", S`\\uFF1C\\uFE64]`, S`\\uFF1C]`)],
  ["6  '<-' is no longer treated as maths", edit("promptSafety.js", S`+\\-\\u2212`, S`+\\u2212`)],
  ["7  U+2212 minus no longer normalised", edit("intelligence.js", "[−‒–]", "[‒–]")],
  ["8  MAX_CITES 6 -> 9", edit("intelligence.js", "const MAX_CITES = 6;", "const MAX_CITES = 9;")],
  ["9  keyword length 60 -> 100", edit("intelligence.js", "k.length <= 60", "k.length <= 100")],
  ["10 confidence HIGH 0.75 -> 0.7", edit("intelligence.js", "score >= 0.75", "score >= 0.7")],
  ["11 MAX_TEXT 700 -> 900", edit("intelligence.js", "const MAX_TEXT = 700;", "const MAX_TEXT = 900;")],
  ["12 chunk text no longer neutralised", edit("intelligence.js", "${neutralizeTags(c.text)}", "${c.text}")],
  ["13 title quotes no longer replaced", edit("promptSafety.js", `.replace(/"/g, "'")`, "")],
  ["14 MAX_LIST 8 -> 12", edit("intelligence.js", "const MAX_LIST = 8;", "const MAX_LIST = 12;")],
  // extra
  ["15 model payload cap 120000 -> 130000", edit("intelligence.js", "const MAX_MODEL_PAYLOAD_CHARS = 120000;", "const MAX_MODEL_PAYLOAD_CHARS = 130000;")],
  ["16 result rows 30 -> 40", edit("intelligence.js", "quantitativeResults.slice(0, 30)", "quantitativeResults.slice(0, 40)")],
  ["17 metric 200 -> 300", edit("intelligence.js", "r.metric.trim().slice(0, 200)", "r.metric.trim().slice(0, 300)")],
  ["18 value 100 -> 150", edit("intelligence.js", "r.value.trim().slice(0, 100)", "r.value.trim().slice(0, 150)")],
  ["19 context 400 -> 500", edit("intelligence.js", "r.context.trim().slice(0, 400)", "r.context.trim().slice(0, 500)")],
  ["20 keywords 10 -> 12", edit("intelligence.js", ".map((k) => k.trim()).slice(0, 10)", ".map((k) => k.trim()).slice(0, 12)")],
  ["21 partial-coverage weight 0.45 -> 0.5", edit("intelligence.js", '"FULL_TEXT" ? 1 : 0.45', '"FULL_TEXT" ? 1 : 0.5')],
  ["22 truncation factor 0.9 -> 0.95", edit("intelligence.js", "score *= 0.9", "score *= 0.95")],
  ["23 confidence MEDIUM 0.5 -> 0.4", edit("intelligence.js", "score >= 0.5 ?", "score >= 0.4 ?")],
  ["24 score weights 0.6/0.4 -> 0.5/0.5", edit("intelligence.js", "0.6 * support + 0.4 * completeness", "0.5 * support + 0.5 * completeness")],
  ["25 words of 3 characters count as words", edit("intelligence.js", "{3,}/g) || [])", "{2,}/g) || [])")],
  ["26 tag names no longer need a word boundary", edit("promptSafety.js", S`)\\b[^<>`, S`)[^<>`)],
  // final hardening: basis coercion, trimming, citation de-duplication
  ["27 basis label compared case-insensitively", edit("intelligence.js", 'basis: raw.basis === "INFERRED" ? "INFERRED" : "STATED"', 'basis: String(raw.basis).toUpperCase() === "INFERRED" ? "INFERRED" : "STATED"')],
  ["28 an unknown basis label is passed through", edit("intelligence.js", 'basis: raw.basis === "INFERRED" ? "INFERRED" : "STATED"', 'basis: raw.basis || "STATED"')],
  ["29 a missing basis label defaults to INFERRED", edit("intelligence.js", 'basis: raw.basis === "INFERRED" ? "INFERRED" : "STATED"', 'basis: raw.basis === "STATED" ? "STATED" : "INFERRED"')],
  ["30 statement text no longer trimmed", edit("intelligence.js", "raw.text.trim().slice(0, MAX_TEXT)", "raw.text.slice(0, MAX_TEXT)")],
  ["31 statement cut BEFORE it is trimmed", edit("intelligence.js", "raw.text.trim().slice(0, MAX_TEXT)", "raw.text.slice(0, MAX_TEXT).trim()")],
  ["32 statement inner white space collapsed", edit("intelligence.js", "raw.text.trim().slice(0, MAX_TEXT)", 'raw.text.trim().replace(/\\s+/g, " ").slice(0, MAX_TEXT)')],
  ["33 metric no longer trimmed", edit("intelligence.js", "r.metric.trim().slice(0, 200)", "r.metric.slice(0, 200)")],
  ["34 value no longer trimmed", edit("intelligence.js", "r.value.trim().slice(0, 100)", "r.value.slice(0, 100)")],
  ["35 context no longer trimmed", edit("intelligence.js", "r.context.trim().slice(0, 400)", "r.context.slice(0, 400)")],
  ["36 context cut before it is trimmed", edit("intelligence.js", "r.context.trim().slice(0, 400)", "r.context.slice(0, 400).trim()")],
  ["37 keywords no longer trimmed", edit("intelligence.js", ".map((k) => k.trim()).slice(0, 10)", ".slice(0, 10)")],
  ["38 keyword length limit applied after trimming", edit("intelligence.js", "k.length <= 60", "k.trim().length <= 60")],
  ["39 citations no longer de-duplicated", edit("intelligence.js", "byId.has(id) && !out.includes(id)", "byId.has(id)")],
  ["40 citations capped before de-duplication", edit("intelligence.js", "for (const id of arr) if", "for (const id of arr.slice(0, MAX_CITES)) if")],
  ["41 citations de-duplicated keeping the LAST occurrence", edit("intelligence.js", "byId.has(id) && !out.includes(id)) out.push(id);", "byId.has(id)) { const at = out.indexOf(id); if (at !== -1) out.splice(at, 1); out.push(id); }")],
  ["42 cited-chunk list sorted", edit("intelligence.js", "citedChunkIds: [...cited]", "citedChunkIds: [...cited].sort()")],
  ["43 cited-chunk list may repeat a chunk", edit("intelligence.js", "const cited = new Set();", "const cited = { arr: [], add(x) { this.arr.push(x); }, [Symbol.iterator]() { return this.arr[Symbol.iterator](); } };")]
];

test("guard: every realistic behaviour change moves the fingerprint (the audit's 14 mutations plus extra ones)", () => {
  const undetected = [];
  for (const [name, mutation] of MUTATIONS) if (variantFingerprint([mutation]) === PINNED_FINGERPRINT) undetected.push(name);
  assert.deepEqual(undetected, [], `these changes would NOT be noticed by the fingerprint guard: ${undetected.join("; ")}`);
});

// Entries written under the prompt versions that were current BEFORE the security changes to prompt escaping and number grounding
// (audit P1-2) must be unreachable now: a different version is a different key, so the stored answer is never served and the
// model is called again. They simply expire by TTL; nothing needs to be flushed.
const PREVIOUS_QUESTION_PROMPT_VERSION = "2026.2";
const PREVIOUS_INTEL_PROMPT_VERSION = "2026.3-intel"; // the version before the Phase 6 claim-guard fix (direction forms, "from X to Y" order)

test("cache invalidation: answers stored under the previous prompt versions are not served; the current version still hits", async () => {
  const { buildCacheKey, contentHash } = require("../../llm/resultCache");
  assert.notEqual(PROMPT_VERSION, PREVIOUS_QUESTION_PROMPT_VERSION);
  assert.notEqual(INTEL_PROMPT_VERSION, PREVIOUS_INTEL_PROMPT_VERSION);
  const evidence = mkChunks(PAPER_ID).map((c) => ({ chunkId: c.chunkId, paperId: PAPER_ID, section: c.section, page: null, text: c.text, heading: c.heading }));
  const stale = (marker) => ({ httpStatus: 200, body: { marker, requestId: "req_old", modelMode: "EXTERNAL_CLAUDE", fallbackUsed: false, status: "UNVERIFIED", provider: "anthropic", model: "claude-sonnet-5-5", tokens: { source: "REAL_PROVIDER", inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0.01, costStatus: "ESTIMATED" } } });
  const questionKey = (promptVersion) => buildCacheKey({ tenantId: "tenant_a", projectId: "prj_1", paperId: PAPER_ID, contentHash: contentHash(evidence), model: "claude-sonnet-5-5", mode: "QUESTION:STANDARD", promptVersion, query: "What accuracy was reached?" });
  const intelKey = (promptVersion) => buildCacheKey({ tenantId: "tenant_a", projectId: "prj_1", paperId: PAPER_ID, contentHash: contentHash(evidence), model: "claude-sonnet-5-5", mode: `INTELLIGENCE:v${INTEL_SCHEMA_VERSION}:STANDARD`, promptVersion, query: JSON.stringify(["STRUCTURED_INTELLIGENCE", "Sparse coding", "FULL_TEXT"]) });
  assert.notEqual(questionKey(PREVIOUS_QUESTION_PROMPT_VERSION), questionKey(PROMPT_VERSION));
  assert.notEqual(intelKey(PREVIOUS_INTEL_PROMPT_VERSION), intelKey(INTEL_PROMPT_VERSION));

  // previous version: not served, the model is called
  const old = harness();
  await old.cache.set(questionKey(PREVIOUS_QUESTION_PROMPT_VERSION), stale("OLD_QUESTION"));
  await old.cache.set(intelKey(PREVIOUS_INTEL_PROMPT_VERSION), stale("OLD_INTELLIGENCE"));
  let q, i;
  assert.equal(await missed(old, async () => { q = await Q(old); }), true, "question answer from the previous prompt version was reused");
  assert.equal(await missed(old, async () => { i = await I(old); }), true, "analysis from the previous prompt version was reused");
  assert.equal(q.body.marker, undefined);
  assert.equal(i.body.marker, undefined);
  assert.equal(q.body.promptVersion, PROMPT_VERSION);
  assert.equal(i.body.promptVersion, INTEL_PROMPT_VERSION);

  // control: the same stale body under the CURRENT version is served (so the miss above is caused by the version, not by a harness gap)
  const cur = harness();
  await cur.cache.set(questionKey(PROMPT_VERSION), stale("CURRENT_QUESTION"));
  await cur.cache.set(intelKey(INTEL_PROMPT_VERSION), stale("CURRENT_INTELLIGENCE"));
  assert.equal(await missed(cur, async () => { q = await Q(cur); }), false);
  assert.equal(await missed(cur, async () => { i = await I(cur); }), false);
  assert.equal(q.body.marker, "CURRENT_QUESTION");
  assert.equal(i.body.marker, "CURRENT_INTELLIGENCE");
});

const PINNED_FINGERPRINT = "038765b54e2dc768"; // re-pinned in Phase 6 with INTEL_PROMPT_VERSION 2026.4-intel (claim-guard direction and order fix); previous pin 280e95885fc9ffeb
