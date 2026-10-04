"use strict";
/**
 * What a worker does with one claimed analysis job: run structured paper intelligence through the same pipeline the HTTP
 * routes use (aiPipeline.analyzePaper: resolve paper -> coverage gate -> server-side evidence -> cache -> Claude Sonnet 5.5 |
 * labelled local fallback -> usage ledger).
 *
 * The job stores only `{paperId, depth}`. Paper text is never part of a job: the worker reads it from the shared paper store
 * (any replica can run any job). It never upgrades a result to VERIFIED.
 *
 * Outcomes:
 *   result UNVERIFIED | FALLBACK                  -> COMPLETED (the result says which, and which model/provider produced it)
 *   CONTENT_UNAVAILABLE | METADATA_ONLY coverage  -> FAILED with that code and a plain explanation (no model call, no cost)
 *   scholarly sources down                         -> retryable failure (re-queued up to max_attempts)
 *   model output unusable                          -> FAILED (not retried: a retry would pay for the same failure again)
 */

const { PaperError } = require("../papers/paperService");
const { PipelineError } = require("../llm/aiPipeline");

class ProcessingError extends Error {
  constructor(code, message, retryable) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function createAnalysisProcessor({ pipeline }) {
  return {
    async process(job) {
      const req = job.request; // { paperId, depth } as validated at creation
      if (!req || typeof req.paperId !== "string") throw new ProcessingError("INVALID_JOB", "job has no paper to analyse", false);
      let out;
      try {
        out = await pipeline.analyzePaper({ paperId: req.paperId, analysisDepth: req.depth }, { scope: { tenantId: job.tenant_id, projectId: job.project_id }, uid: job.user_id, jobId: job.job_id });
      } catch (e) {
        if (e instanceof PaperError) throw new ProcessingError(e.code, e.message, e.retryable);
        if (e instanceof PipelineError) throw new ProcessingError(e.code, e.message, false);
        throw e;
      }
      if (out.httpStatus !== 200) {
        throw new ProcessingError(out.body.error || "ANALYSIS_REJECTED", out.body.message || "analysis could not be completed", false);
      }
      const status = out.body.verificationStatus;
      if (status === "CONTENT_UNAVAILABLE" || status === "METADATA_ONLY") {
        throw new ProcessingError(status, out.body.coverageNotice || "no paper content is available to analyse", false);
      }
      if (status === "VERIFIED") {
        throw new ProcessingError("UNEARNED_VERIFIED", "VERIFIED may only be produced by a verification pipeline that proves entailment", false);
      }
      return out.body;
    }
  };
}

module.exports = { createAnalysisProcessor, ProcessingError };
