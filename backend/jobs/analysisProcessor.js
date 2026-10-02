"use strict";
/**
 * What a worker does with one claimed analysis job: run the stored, already-validated request through the same grounded
 * copilot pipeline the synchronous route uses (runCopilot: cache -> single-flight -> Claude Sonnet 5.5 | labelled local
 * fallback). It never upgrades a result to VERIFIED: claim-to-evidence verification does not exist yet.
 */

const { runCopilot } = require("../llm/runCopilot");

const ANALYSIS_QUESTION =
  "Give a structured analysis of this paper using only the supplied excerpts: the research question, the methods, the key findings, " +
  "the stated limitations, and which excerpt supports each point. Say explicitly where the excerpts do not cover something.";

class ProcessingError extends Error {
  constructor(code, message, retryable) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function createAnalysisProcessor(deps) {
  return {
    async process(job) {
      const req = job.request; // { query, paperId, chunks, depth } as validated at creation
      if (!req || !Array.isArray(req.chunks) || req.chunks.length === 0) {
        throw new ProcessingError("NO_PAPER_CONTENT", "job has no evidence chunks to analyse", false);
      }
      const body = { query: req.query || ANALYSIS_QUESTION, paperId: req.paperId, evidenceChunks: req.chunks, analysisDepth: req.depth };
      const out = await runCopilot(body, { tenantId: job.tenant_id, projectId: job.project_id }, deps);
      if (out.httpStatus !== 200) {
        // validation failures are deterministic: retrying cannot help
        throw new ProcessingError(out.body.error || "ANALYSIS_REJECTED", out.body.message || "analysis request rejected", false);
      }
      if (out.body.verificationStatus === "VERIFIED") {
        throw new ProcessingError("UNEARNED_VERIFIED", "VERIFIED may only be produced by the verification pipeline", false);
      }
      return out.body;
    }
  };
}

module.exports = { createAnalysisProcessor, ProcessingError, ANALYSIS_QUESTION };
