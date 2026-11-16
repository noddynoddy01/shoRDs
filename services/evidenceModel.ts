/**
 * Evidence display model: turns the backend's structured analysis (POST /api/v1/analysis -> job result, `intelligence` + `verification`) and the
 * evidence endpoint's answer (GET /api/v1/papers/:id/evidence/:chunkId) into what a screen may honestly say.
 *
 * Rules this file enforces (and evidenceModel tests check):
 *  - An automatic check is never presented as a guarantee. Nothing here produces the words "verified", "accurate" or "guaranteed", and the
 *    server's `confidence` score is not exposed at all (it measures how many statements survived the checks, not whether they are right).
 *  - The source sentence comes ONLY from the evidence endpoint, which applies the paper's licence. Chunk text that may appear in other response
 *    fields is never used to build a quotation here.
 *  - A statement with no matching sentence says so; a licence that does not allow showing text says so and points to the paper.
 *  - Unknown or malformed fields are dropped, never replaced by invented values.
 */

export type EvidenceSpan = { chunkId: string; start: number; end: number };

export type QualifierKey = "HEDGE_DROPPED" | "SCOPE_LIMIT_DROPPED";

export type StatementView = {
  key: string;
  field: string;
  label: string;
  text: string;
  basis: "STATED" | "INFERRED";
  qualifiers: { key: QualifierKey; note: string }[];
  /** Sentence-level pointers into the cited chunks. Empty when no single sentence matched the statement. */
  spans: EvidenceSpan[];
};

export type ResultView = { key: string; metric: string; value: string; context: string; spans: EvidenceSpan[] };

export type RemovedSummary = {
  /** Statements the automatic checks removed from the analysis. */
  count: number;
  kept: number;
  reasons: { code: string; label: string; count: number }[];
  /** Free text removed from results that were kept (a number in it was not in the source). */
  detailsRemoved: number;
  message: string;
};

export type AnalysisView = {
  paperId: string;
  title: string | null;
  doi: string | null;
  sourceUrl: string | null;
  coverage: string;
  statements: StatementView[];
  results: ResultView[];
  removed: RemovedSummary | null;
  /** Always present: what the checks are and are not. */
  checkNote: string;
  /** False when the server says no AI model produced this (the labelled local fallback). */
  aiUsed: boolean;
  /** True when the paper's licence means the server withheld excerpt text from this response (and will withhold the source sentences). */
  textWithheld: boolean;
  license: string | null;
};

export const EVIDENCE_COPY = {
  checkNote: "Checked by automatic rules only (numbers, wording, citations). The rules can miss errors and cannot tell whether the source really supports a statement. Read the source sentence before you rely on it.",
  removedNone: "The automatic checks removed no statements. The checks are limited, so errors can remain.",
  removedOne: "1 statement was removed by the automatic checks.",
  removedMany: (n: number) => `${n} statements were removed by the automatic checks.`,
  showSentence: "Show source sentence",
  hideSentence: "Hide source sentence",
  loading: "Loading the source sentence...",
  retry: "Try again",
  licenseWithheld: "The source sentence is not shown here because of the paper's licence. Open the original paper to read it.",
  noSpan: "No single sentence in the paper matched this statement closely enough. Open the paper and look in the cited section.",
  notFound: "This sentence is no longer available. Open the original paper.",
  openPaper: "Open original paper",
  hedge: "The source words this cautiously; this statement does not.",
  scope: "The source limits this to a specific case (for example with the word \"only\" or \"single\"); this statement does not.",
  inferred: "Inferred from the paper, not stated in it.",
  noAi: "No AI model was used for this result. Only the opening sentences of the abstract are shown.",
  textWithheldNote: "This paper's licence does not clearly allow showing its text here, so source sentences are not displayed. Use the link to open the original paper and check each statement there."
} as const;

const FIELD_LABELS: [string, string][] = [
  ["tldr", "In brief"], ["researchProblem", "Problem"], ["motivation", "Motivation"], ["methodology", "Method"], ["architecture", "Architecture"],
  ["dataset", "Data"], ["experimentalSetup", "Setup"], ["findings", "Findings"], ["novelty", "Novelty"], ["whyItMatters", "Why it matters"],
  ["practicalImplications", "Practical implications"], ["futureWork", "Future work"],
  ["contributions", "Contributions"], ["techniques", "Techniques"], ["strengths", "Strengths"], ["limitations", "Limitations"], ["assumptions", "Assumptions"]
];
const LIST_FIELDS = new Set(["contributions", "techniques", "strengths", "limitations", "assumptions"]);

export const REASON_LABELS: Record<string, string> = {
  STATEMENT_NUMBER_NOT_IN_EVIDENCE: "contained a number that is not in the cited text",
  NUMBER_NOT_IN_EVIDENCE: "contained a number that is not in the cited text",
  REVERSED_MEANING: "appeared to reverse the cited sentence",
  OVERCLAIM: "used a stronger word than the source",
  WEAK_SUPPORT: "had little wording in common with the cited text",
  NO_VALID_CITATION: "cited nothing that exists",
  MALFORMED_ITEM: "was not in a usable form",
  MALFORMED_RESULT: "was not in a usable form"
};
const DETAILS_REMOVED = "CONTEXT_STRIPPED_NUMBER_NOT_IN_EVIDENCE";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const nonNegInt = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1e9 ? v : null);

/** Spans from the server. Only well-formed ones survive; at most three per statement. */
export function parseSpans(raw: unknown): EvidenceSpan[] {
  if (!Array.isArray(raw)) return [];
  const out: EvidenceSpan[] = [];
  for (const s of raw) {
    if (!isObj(s)) continue;
    const chunkId = str(s.chunkId, 300);
    const start = nonNegInt(s.start);
    const end = nonNegInt(s.end);
    if (!chunkId || start === null || end === null || end <= start) continue;
    out.push({ chunkId, start, end });
    if (out.length === 3) break;
  }
  return out;
}

function qualifiersOf(raw: unknown): StatementView["qualifiers"] {
  if (!Array.isArray(raw)) return [];
  const out: StatementView["qualifiers"] = [];
  if (raw.includes("HEDGE_DROPPED")) out.push({ key: "HEDGE_DROPPED", note: EVIDENCE_COPY.hedge });
  if (raw.includes("SCOPE_LIMIT_DROPPED")) out.push({ key: "SCOPE_LIMIT_DROPPED", note: EVIDENCE_COPY.scope });
  return out;
}

function statementFrom(raw: unknown, field: string, label: string, key: string): StatementView | null {
  if (!isObj(raw)) return null;
  const text = str(raw.text, 800);
  if (!text) return null;
  return { key, field, label, text, basis: raw.basis === "INFERRED" ? "INFERRED" : "STATED", qualifiers: qualifiersOf(raw.qualifiers), spans: parseSpans(raw.evidenceSpans) };
}

export function summariseRemoved(verification: unknown): RemovedSummary | null {
  if (!isObj(verification)) return null;
  const count = nonNegInt(verification.statementsDropped);
  const kept = nonNegInt(verification.statementsKept);
  if (count === null || kept === null) return null;
  const reasons: RemovedSummary["reasons"] = [];
  let detailsRemoved = 0;
  if (isObj(verification.droppedReasons)) {
    for (const [code, n] of Object.entries(verification.droppedReasons)) {
      const c = nonNegInt(n);
      if (c === null || c === 0) continue;
      if (code === DETAILS_REMOVED) { detailsRemoved += c; continue; }
      reasons.push({ code, label: REASON_LABELS[code] || "did not pass a check", count: c });
    }
  }
  reasons.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  const message = count === 0 ? EVIDENCE_COPY.removedNone : count === 1 ? EVIDENCE_COPY.removedOne : EVIDENCE_COPY.removedMany(count);
  return { count, kept, reasons, detailsRemoved, message };
}

/** Build the display model from a completed analysis body. Returns null when there is nothing to show (no `intelligence`). */
export function parseAnalysisForDisplay(body: unknown): AnalysisView | null {
  if (!isObj(body) || !isObj(body.intelligence)) return null;
  const intel = body.intelligence;
  const paper = isObj(body.paper) ? body.paper : {};
  const statements: StatementView[] = [];
  for (const [field, label] of FIELD_LABELS) {
    const v = intel[field];
    if (LIST_FIELDS.has(field)) {
      if (Array.isArray(v)) v.slice(0, 8).forEach((item, i) => { const s = statementFrom(item, field, label, `${field}:${i}`); if (s) statements.push(s); });
    } else {
      const s = statementFrom(v, field, label, field);
      if (s) statements.push(s);
    }
  }
  const results: ResultView[] = [];
  if (Array.isArray(intel.quantitativeResults)) {
    intel.quantitativeResults.slice(0, 30).forEach((r, i) => {
      if (!isObj(r)) return;
      const metric = str(r.metric, 200);
      const value = str(r.value, 100);
      if (!metric || !value) return;
      results.push({ key: `result:${i}`, metric, value, context: str(r.context, 400) || "", spans: parseSpans(r.evidenceSpans) });
    });
  }
  const doi = str(paper.doi, 200);
  return {
    paperId: str(paper.paperId, 200) || "",
    title: str(paper.title, 500),
    doi,
    sourceUrl: str(paper.sourceUrl, 500) || (doi ? `https://doi.org/${doi}` : null),
    coverage: str(body.contentCoverage, 40) || "UNKNOWN",
    statements,
    results,
    removed: summariseRemoved(body.verification),
    checkNote: EVIDENCE_COPY.checkNote,
    aiUsed: body.aiCalled === true,
    textWithheld: isObj(body.textPolicy) && body.textPolicy.evidenceText === "WITHHELD_BY_LICENSE",
    license: str(paper.license, 80)
  };
}

/** A quantitative result shown with the same card as a statement (metric, value, context; spans point at the numbers' sentences). */
export function resultAsStatement(r: ResultView): StatementView {
  return { key: r.key, field: "quantitativeResults", label: "Result", text: r.context ? `${r.metric}: ${r.value} (${r.context})` : `${r.metric}: ${r.value}`, basis: "STATED", qualifiers: [], spans: r.spans };
}

// ------------------------------------------------------------------------------------------------ the sentence itself

export type SentenceSource = { title: string | null; license: string | null; attributionRequired: boolean; sourceUrl: string | null; doi: string | null };

export type SentenceResult =
  | { state: "AVAILABLE"; text: string; section: string | null; source: SentenceSource; notice: string | null }
  | { state: "LICENSE_WITHHELD"; source: SentenceSource; notice: string | null }
  | { state: "NOT_FOUND" }
  | { state: "ERROR"; message: string };

function sourceFrom(raw: unknown): SentenceSource {
  const s = isObj(raw) ? raw : {};
  const doi = str(s.doi, 200);
  return { title: str(s.title, 500), license: str(s.license, 80), attributionRequired: s.attributionRequired === true, sourceUrl: str(s.sourceUrl, 500) || (doi ? `https://doi.org/${doi}` : null), doi };
}

/** The evidence endpoint's JSON body (HTTP 200) as a display state. Text is accepted only when the server says it is available. */
export function parseSentenceResponse(json: unknown): SentenceResult {
  if (!isObj(json)) return { state: "ERROR", message: "The server sent an unexpected answer." };
  const source = sourceFrom(json.source);
  const notice = str(json.notice, 600);
  if (json.available === true) {
    const text = typeof json.text === "string" ? json.text.trim().slice(0, 1500) : "";
    if (!text) return { state: "ERROR", message: "The server sent an empty sentence." };
    return { state: "AVAILABLE", text, section: str(json.section, 80), source, notice };
  }
  if (json.available === false) return { state: "LICENSE_WITHHELD", source, notice };
  return { state: "ERROR", message: "The server sent an unexpected answer." };
}

/** Path of the evidence endpoint for one span. The paper id and chunk id contain "/" and ":" for DOIs, so both are encoded. */
export function evidencePath(paperId: string, span: EvidenceSpan): string {
  return `/api/v1/papers/${encodeURIComponent(paperId)}/evidence/${encodeURIComponent(span.chunkId)}`;
}
export function evidenceQuery(span: EvidenceSpan): { start: number; end: number } {
  return { start: span.start, end: span.end };
}

type GetClient = { get: <T = Record<string, unknown>>(path: string, opts?: { query?: Record<string, string | number | boolean | undefined>; signal?: AbortSignal }) => Promise<T> };
const MAX_CACHE = 100;
const cache = new Map<string, SentenceResult>();
export function clearEvidenceCache() { cache.clear(); }

/**
 * Fetch one source sentence. `client` is the app's authenticated API client (injected so this stays testable). Only AVAILABLE and
 * LICENSE_WITHHELD answers are remembered; errors are not, so "Try again" really asks again.
 */
export async function loadSentence(client: GetClient, paperId: string, span: EvidenceSpan, describeError: (e: unknown) => string, isNotFound: (e: unknown) => boolean): Promise<SentenceResult> {
  const key = `${paperId}|${span.chunkId}|${span.start}|${span.end}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const json = await client.get(evidencePath(paperId, span), { query: evidenceQuery(span) });
    const r = parseSentenceResponse(json);
    if (r.state === "AVAILABLE" || r.state === "LICENSE_WITHHELD") {
      cache.set(key, r);
      while (cache.size > MAX_CACHE) { const oldest = cache.keys().next().value; if (oldest === undefined) break; cache.delete(oldest); }
    }
    return r;
  } catch (e) {
    if (isNotFound(e)) return { state: "NOT_FOUND" };
    return { state: "ERROR", message: describeError(e) };
  }
}
