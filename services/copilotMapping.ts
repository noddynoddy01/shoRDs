/**
 * Maps the backend's copilot / analysis responses to the UI's response type, WITHOUT improving them.
 *
 *  - A status is shown exactly as the server computed it. The client never produces VERIFIED / PARTIALLY_VERIFIED:
 *    the server's mechanical checks (citation existence, numbers, lexical overlap) do not prove entailment, and the server
 *    says UNVERIFIED. If a response ever claims VERIFIED, it is shown as UNVERIFIED (the client cannot confirm it).
 *  - Evidence is exactly the chunks the server retrieved for the paper. Nothing is added here.
 *  - Coverage (FULL_TEXT / ABSTRACT_ONLY / METADATA_ONLY / CONTENT_UNAVAILABLE) is surfaced, with the server's notice.
 *
 * No imports (type-only imports are erased), so it is unit-tested in Node.
 */

import type { ResearchCopilotResponse } from "../types/researchCopilot";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 5000): string => (typeof v === "string" ? v.slice(0, max) : "");

const STATUS: Record<string, ResearchCopilotResponse["status"]> = {
  UNVERIFIED: "UNVERIFIED",
  FALLBACK: "FALLBACK",
  CONTENT_UNAVAILABLE: "CONTENT_UNAVAILABLE",
  METADATA_ONLY: "METADATA_ONLY"
};

export function mapCopilotResponse(json: unknown, now: () => number = Date.now): ResearchCopilotResponse {
  const created = new Date(now()).toISOString();
  if (!isObj(json)) return failed("The server sent an unreadable response.", created);

  const rawStatus = str(json.verificationStatus, 40);
  const status = STATUS[rawStatus] ?? (rawStatus === "VERIFIED" ? "UNVERIFIED" : "FAILED");
  const coverage = str(json.contentCoverage, 40) || undefined;
  const requestId = str(json.requestId, 80) || `local_${created}`;

  const paper = isObj(json.paper) ? json.paper : null;
  const sources = paper
    ? [{
        paperId: str(paper.paperId, 200),
        title: str(paper.title, 500),
        authors: Array.isArray(paper.authors) ? paper.authors.map((a) => (typeof a === "string" ? a : isObj(a) ? str(a.name, 200) : "")).filter(Boolean).slice(0, 50) : [],
        year: typeof paper.year === "number" ? paper.year : 0,
        doi: typeof paper.doi === "string" ? paper.doi : undefined
      }]
    : [];

  const evidence = Array.isArray(json.evidence)
    ? json.evidence.filter(isObj).slice(0, 100).map((e) => ({
        chunkId: str(e.chunkId, 300),
        paperId: str(e.paperId, 200),
        section: str(e.section, 80),
        page: typeof e.page === "number" ? e.page : null,
        text: str(e.text, 1500)
      }))
    : [];

  const limitations: string[] = [];
  const notice = str(json.coverageNotice, 600);
  if (notice) limitations.push(notice);
  if (status === "UNVERIFIED") limitations.push("Not verified: the cited excerpts were checked mechanically, but whether they logically support each statement was not.");
  if (status === "FALLBACK") limitations.push(`No AI model produced this answer${json.fallbackReason ? ` (${str(json.fallbackReason, 80)})` : ""}. It is an extractive summary of retrieved text only.`);
  if (rawStatus === "VERIFIED") limitations.push("The server reported a status this client cannot confirm, so it is shown as unverified.");
  if (isObj(json.context) && json.context.truncated === true) limitations.push("The paper was longer than the context limit, so only part of it was used.");

  return {
    responseId: requestId,
    queryId: requestId,
    status,
    mode: "ASK",
    answer: str(json.answer, 20000) || (notice || "No answer was produced."),
    claims: [], // the server returns an answer with citations; it does not return per-claim verification, so none is shown
    sources,
    evidence,
    graphContext: [],
    suggestedActions: [],
    uncertainty: coverage ? `Coverage: ${coverage}` : undefined,
    limitations,
    createdAt: created,
    coverage,
    coverageNotice: notice || undefined,
    aiCalled: typeof json.aiCalled === "boolean" ? json.aiCalled : undefined,
    model: typeof json.model === "string" ? json.model : undefined,
    cacheStatus: isObj(json.cache) ? str(json.cache.status, 20) : undefined
  };
}

export function failed(message: string, createdAt: string, notice?: string): ResearchCopilotResponse {
  return {
    responseId: `local_${createdAt}`,
    queryId: `local_${createdAt}`,
    status: "FAILED",
    mode: "ASK",
    answer: message,
    claims: [],
    sources: [],
    evidence: [],
    graphContext: [],
    suggestedActions: [],
    limitations: notice ? [notice] : [],
    createdAt
  };
}

/** A response for "nothing to ask about yet" (no paper selected): honest, no server call. */
export function needsPaper(createdAt: string): ResearchCopilotResponse {
  return { ...failed("Choose a paper first: enter a DOI, PMID or arXiv id, then ask your question.", createdAt), status: "NEEDS_CLARIFICATION" };
}
