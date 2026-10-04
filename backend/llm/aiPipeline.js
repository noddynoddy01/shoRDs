"use strict";
/**
 * THE one AI execution path of the production runtime. The synchronous route (POST /api/v1/copilot/query) and the background
 * worker (analysis jobs) both call these two functions, so paper retrieval, coverage gating, evidence selection, the cache,
 * single-flight, model selection, Sonnet 5.5 request rules, telemetry, retries and the per-request usage ledger are identical
 * on both paths.
 *
 *   paper id -> resolve canonical paper (store | providers) -> coverage gate -> server-side evidence -> cache -> model -> ledger
 *
 * Gate: CONTENT_UNAVAILABLE and METADATA_ONLY never reach the model (no tokens are spent). ABSTRACT_ONLY reaches it with an
 * explicit "abstract only" instruction and a coverage notice in the response.
 * Evidence: always read from the server's paper store. A client may name chunk ids to focus a question; ids are validated.
 */

const { handleCopilotQuery, validateRequest, PROMPT_VERSION } = require("./copilotService");
const { handleIntelligence, INTEL_PROMPT_VERSION, INTEL_SCHEMA_VERSION } = require("./intelligence");
const { resolveApiKey, resolveModelConfig, resolveProfile } = require("./anthropicClient");
const { buildCacheKey, contentHash, cachedAiCall, isRealCompleteAnswer } = require("./resultCache");
const { validateChunkIds, selectForQuestion, selectForIntelligence, DEFAULT_MAX_CONTEXT_CHARS } = require("./evidence");

const MAX_QUERY_CHARS = 2000;
const FORBIDDEN_EVIDENCE_KEYS = ["evidenceChunks", "chunks", "evidence", "sources", "context", "paperText", "text"];

class PipelineError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const header = (p) => ({ paperId: p.paperId, title: p.title, authors: p.authors, year: p.year, venue: p.venue, doi: p.doi, pmid: p.pmid, arxivId: p.arxivId, source: p.source, sourceUrl: p.sourceUrl, license: p.license });

/** Evidence supplied by a client is refused outright: shoRDs only presents evidence it retrieved itself. */
function assertNoClientEvidence(body) {
  for (const k of FORBIDDEN_EVIDENCE_KEYS) {
    if (body[k] !== undefined) throw new PipelineError("EVIDENCE_NOT_ACCEPTED", `\`${k}\` is not accepted: evidence is retrieved by the server from the paper itself. Send only \`paperId\` (and optionally \`chunkIds\`).`);
  }
}

function createAiPipeline({ paperService, cache = null, ledger = null, telemetry = null, client, env = process.env, replicaId, logger = console, now = Date.now }) {
  const maxContextChars = () => Math.max(2000, Number(env.AI_MAX_CONTEXT_CHARS) || DEFAULT_MAX_CONTEXT_CHARS);

  function gated(kind, paper, requestId, started) {
    telemetry && telemetry.record({ served: "FALLBACK", fallbackReason: `COVERAGE_${paper.coverage}` });
    const tokens = { source: "NONE", inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, costStatus: "NO_AI_CALL" };
    const common = { requestId, replicaId, paper: header(paper), contentCoverage: paper.coverage, coverageNotice: paper.coverageNotice, status: paper.coverage, verificationStatus: paper.coverage, aiCalled: false, provider: "none", model: null, modelMode: "NONE", fallbackUsed: false, fallbackReason: null, evidence: [], tokens, latencyMs: now() - started, cache: { status: "BYPASS" } };
    return {
      httpStatus: 200,
      body: kind === "INTELLIGENCE"
        ? { ...common, queryType: "STRUCTURED_INTELLIGENCE", intelligence: null, confidence: { level: "NOT_ASSESSED", score: null, basis: "NONE" } }
        : { ...common, queryType: "RESEARCH_QUESTION", answer: paper.coverageNotice, claims: [], citedChunkIds: [] }
    };
  }

  async function finish(out, ctx) {
    if (ledger) await ledger.record(out, ctx);
    return out;
  }

  /**
   * Answer a question about one paper.
   * @param {{query:string, paperId:string, chunkIds?:string[], analysisDepth?:string}} body  (already JSON-parsed client input)
   * @param {{scope:{tenantId:string, projectId:string}, uid:string, jobId?:string}} ctx
   */
  async function answerQuestion(body, ctx) {
    const started = now();
    assertNoClientEvidence(body);
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) throw new PipelineError("INVALID_QUERY", "`query` is required.");
    if (query.length > MAX_QUERY_CHARS) throw new PipelineError("QUERY_TOO_LONG", `\`query\` must be at most ${MAX_QUERY_CHARS} characters.`);
    const paperRef = typeof body.paperId === "string" ? body.paperId : Array.isArray(body.paperIds) ? body.paperIds[0] : undefined;
    if (paperRef === undefined) throw new PipelineError("PAPER_ID_REQUIRED", "`paperId` is required.");

    const { paper } = await paperService.resolve(paperRef); // PaperError: INVALID_PAPER_ID / RETRIEVAL_UNAVAILABLE
    const requestId = `req_cop_${now()}_${Math.random().toString(36).slice(2, 7)}`;
    const base = { kind: "COPILOT", scope: ctx.scope, uid: ctx.uid, jobId: ctx.jobId, paperId: paper.paperId, replicaId };
    if (paper.coverage !== "FULL_TEXT" && paper.coverage !== "ABSTRACT_ONLY") return finish(gated("COPILOT", paper, requestId, started), base);

    const stored = await paperService.loadChunks(paper.paperId);
    const wanted = validateChunkIds(paper.paperId, body.chunkIds, stored);
    const budget = maxContextChars();
    let selection;
    if (wanted.length) {
      const set = new Set(wanted);
      const picked = stored.filter((c) => set.has(c.chunkId));
      selection = { chunks: picked, omitted: stored.length - picked.length, truncated: false };
      if (picked.reduce((n, c) => n + c.text.length, 0) > budget) throw new PipelineError("CONTEXT_TOO_LARGE", "The requested chunks exceed the context budget.");
    } else selection = selectForQuestion(stored, query, { maxChars: budget });

    const chunks = selection.chunks.map((c) => ({ chunkId: c.chunkId, paperId: paper.paperId, section: c.section, page: null, text: c.text, heading: c.heading }));
    const rawBody = { query, paperId: paper.paperId, evidenceChunks: chunks, analysisDepth: body.analysisDepth };
    const limits = { maxChunks: 80, maxTotalChars: budget };
    const modelCfg = resolveModelConfig(env);
    const hasKey = Boolean(resolveApiKey(env));
    const depth = resolveProfile(body.analysisDepth).name;

    const out = await cachedAiCall({
      cache,
      key: cache && hasKey && chunks.length > 0
        ? buildCacheKey({ tenantId: ctx.scope.tenantId, projectId: ctx.scope.projectId, paperId: paper.paperId, contentHash: contentHash(chunks), model: modelCfg.model, mode: `QUESTION:${depth}`, promptVersion: PROMPT_VERSION, query })
        : null,
      produce: () => handleCopilotQuery(rawBody, { env, telemetry, replicaId, client, logger, now, limits, coverage: paper.coverage, coverageNotice: paper.coverageNotice, paper: header(paper), context: { chunksSent: chunks.length, chunksOmitted: selection.omitted, truncated: selection.truncated }, requestId }),
      cacheableOf: isRealCompleteAnswer,
      replicaId,
      now,
      telemetry
    });
    return finish(out, base);
  }

  /**
   * Structured intelligence for one paper (the analysis job body and the synchronous analysis path).
   * @param {{paperId:string, analysisDepth?:string}} body
   */
  async function analyzePaper(body, ctx) {
    const started = now();
    assertNoClientEvidence(body);
    if (typeof body.paperId !== "string") throw new PipelineError("PAPER_ID_REQUIRED", "`paperId` is required.");
    const { paper } = await paperService.resolve(body.paperId);
    const requestId = `req_int_${now()}_${Math.random().toString(36).slice(2, 7)}`;
    const base = { kind: "INTELLIGENCE", scope: ctx.scope, uid: ctx.uid, jobId: ctx.jobId, paperId: paper.paperId, replicaId };
    if (paper.coverage !== "FULL_TEXT" && paper.coverage !== "ABSTRACT_ONLY") return finish(gated("INTELLIGENCE", paper, requestId, started), base);

    const stored = await paperService.loadChunks(paper.paperId);
    const selection = selectForIntelligence(stored, { maxChars: maxContextChars() });
    const chunks = selection.chunks.map((c) => ({ chunkId: c.chunkId, paperId: paper.paperId, section: c.section, page: null, text: c.text, heading: c.heading }));
    const modelCfg = resolveModelConfig(env);
    const hasKey = Boolean(resolveApiKey(env));
    const depth = resolveProfile(body.analysisDepth).name;

    const out = await cachedAiCall({
      cache,
      key: cache && hasKey && chunks.length > 0
        ? buildCacheKey({ tenantId: ctx.scope.tenantId, projectId: ctx.scope.projectId, paperId: paper.paperId, contentHash: contentHash(chunks), model: modelCfg.model, mode: `INTELLIGENCE:v${INTEL_SCHEMA_VERSION}:${depth}`, promptVersion: INTEL_PROMPT_VERSION, query: "STRUCTURED_INTELLIGENCE" })
        : null,
      produce: () => handleIntelligence({ paper, chunks, depth: body.analysisDepth, selection }, { env, telemetry, replicaId, client, logger, now, requestId }),
      cacheableOf: isRealCompleteAnswer,
      replicaId,
      now,
      telemetry
    });
    return finish(out, base);
  }

  return { answerQuestion, analyzePaper };
}

module.exports = { createAiPipeline, PipelineError, assertNoClientEvidence, FORBIDDEN_EVIDENCE_KEYS };
