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

const { createAiPipeline } = require("../../llm/aiPipeline");
const { createResultCache, CACHE_SCHEMA_VERSION } = require("../../llm/resultCache");
const { PROMPT_VERSION } = require("../../llm/copilotService");
const { INTEL_PROMPT_VERSION, INTEL_SCHEMA_VERSION } = require("../../llm/intelligence");
const { modelStub } = require("./helpers");

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
  return { state, stub, make, scope, calls: () => stub.calls.length };
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
// KNOWN GAPS (documented, not hidden). `todo` = desired behaviour; reported as todo while the gap exists.
// ---------------------------------------------------------------------------------------------------------------
test("GAP: a changed paper title (it is part of the structured-analysis prompt) invalidates the cached analysis",
  { todo: "title is sent to the model but is not part of the cache identity (docs/architecture/AI_SUBSYSTEM_AUDIT.md, finding C2)" },
  async () => {
    const h = harness();
    await I(h);
    h.state.paper = { ...h.state.paper, title: "A completely different title" };
    assert.equal(await missed(h, () => I(h)), true);
  });

test("GAP: a changed coverage notice / paper header does not leave a stale header in a cached answer",
  { todo: "cached bodies embed the paper header and coverage notice captured when the entry was written (finding C4)" },
  async () => {
    const h = harness();
    await Q(h);
    h.state.paper = { ...h.state.paper, venue: "A New Venue" };
    const out = await Q(h);
    assert.equal(out.body.paper && out.body.paper.venue, "A New Venue");
  });

// Prompt/profile/validator text is identified ONLY by hand-bumped version strings. This guard turns "forgot to bump" into a
// failing test: the fingerprint below is pinned to the versions. Change a prompt -> this fails -> bump the version AND update
// the fingerprint in the same commit (which also changes every cache key, so no stale answer survives).
test("guard: prompt text, analysis profiles and cache schema are pinned to their version strings", () => {
  const intel = require("../../llm/intelligence");
  const client = require("../../llm/anthropicClient");
  const copilotSrc = require("fs").readFileSync(require.resolve("../../llm/copilotService"), "utf8");
  const sysCopilot = /const SYSTEM_PROMPT = \[([\s\S]*?)\]\.join\("\\n"\);/.exec(copilotSrc);
  assert.ok(sysCopilot, "copilot SYSTEM_PROMPT block not found: update this guard together with the refactor");
  const material = JSON.stringify({
    cacheSchema: CACHE_SCHEMA_VERSION,
    copilotPromptVersion: PROMPT_VERSION,
    copilotSystem: sysCopilot[1],
    intelPromptVersion: INTEL_PROMPT_VERSION,
    intelSchemaVersion: INTEL_SCHEMA_VERSION,
    intelSystem: intel.SYSTEM_PROMPT,
    profiles: client.ANALYSIS_PROFILES
  });
  const fp = crypto.createHash("sha256").update(material).digest("hex").slice(0, 16);
  assert.equal(fp, PINNED_FINGERPRINT, `Prompt/profile/schema text changed (fingerprint ${fp}). Bump PROMPT_VERSION / INTEL_PROMPT_VERSION (so cache keys change) and then update PINNED_FINGERPRINT.`);
});

const PINNED_FINGERPRINT = "31bf630b783e5b29";
