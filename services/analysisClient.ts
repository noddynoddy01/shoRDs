/**
 * Starting a cited AI analysis of one paper and waiting for it. Pure TypeScript with injected dependencies (like apiClient.ts) so it runs
 * unchanged under Node's test runner. It never runs on its own: the one entry point, `runAnalysis`, is called from a button press.
 *
 * What it guarantees (each covered by backend/tests/node/analysisClient.test.js):
 *  - Only an explicit call starts a paid analysis. Nothing here is triggered by opening a screen.
 *  - One tap = one Idempotency-Key. If the start request is repeated because the network failed, the SAME key is sent, so the server can
 *    return the job it already created instead of creating (and charging for) a second one. A new tap uses a new key.
 *  - The user's own project is created on first use by the server (POST /api/v1/projects/personal) and remembered for the session.
 *  - Polling is bounded: a stopped or timed-out wait never cancels the server-side job, and the result says so.
 *  - The server's `confidence` is not read here at all.
 */
import type { ApiError } from "./auth/apiClient";

// Duck-typed on purpose: this file has no runtime import, so it loads unchanged under Node's test runner as well as Metro.
const isApiError = (e: unknown): e is ApiError => typeof e === "object" && e !== null && (e as { name?: unknown }).name === "ApiError" && typeof (e as { kind?: unknown }).kind === "string";
const UNEXPECTED_PROJECT = "The server sent an unexpected project.";

export type ApiLike = {
  get: <T = Record<string, unknown>>(path: string, opts?: { signal?: AbortSignal }) => Promise<T>;
  post: <T = Record<string, unknown>>(path: string, body?: unknown, opts?: { signal?: AbortSignal; headers?: { "Idempotency-Key"?: string } }) => Promise<T>;
};

export type AnalysisDepth = "QUICK" | "STANDARD" | "DEEP";

export type AnalysisProgress = "PREPARING" | "QUEUED" | "RUNNING";

export type AnalysisOutcome =
  | { kind: "DONE"; body: Record<string, unknown>; jobId: string }
  | { kind: "UNAVAILABLE"; reason: "CONTENT_UNAVAILABLE" | "METADATA_ONLY"; message: string }
  | { kind: "FAILED"; message: string; jobId: string }
  | { kind: "STOPPED"; jobId: string | null; message: string }
  | { kind: "TIMED_OUT"; jobId: string; message: string };

export type RunDeps = {
  api: ApiLike;
  newKey?: () => string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How long to keep waiting for a finished job before giving up (the job itself keeps running on the server). */
  maxWaitMs?: number;
  signal?: AbortSignal;
  onProgress?: (p: AnalysisProgress) => void;
  describeError: (e: unknown) => string;
};

const DEFAULT_MAX_WAIT_MS = 6 * 60 * 1000;
const POLL_STEPS_MS = [1000, 1500, 2000, 3000, 3000, 5000];
const TERMINAL_FAILED = new Set(["FAILED", "CANCELLED", "CANCELED", "DEAD", "EXPIRED"]);

const defaultKey = (): string => {
  const rnd = () => Math.random().toString(36).slice(2, 10);
  return `app-${Date.now().toString(36)}-${rnd()}${rnd()}`;
};
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The paper reference the backend accepts (doi:, pmid:, arxiv:), or null when this record has none and cannot be analysed.
 * An id the app already holds in canonical form is passed as is.
 */
export function backendPaperRef(paper: { id?: unknown; doi?: unknown } | null | undefined): string | null {
  if (!paper) return null;
  const doiRaw = typeof paper.doi === "string" ? paper.doi.trim() : "";
  if (doiRaw) {
    const doi = doiRaw.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").trim();
    if (/^10\.\d{4,9}\/\S+$/.test(doi) && doi.length <= 200) return `doi:${doi.toLowerCase()}`;
  }
  const id = typeof paper.id === "string" ? paper.id.trim() : "";
  if (/^(doi|pmid|arxiv):\S{1,200}$/i.test(id)) return id;
  return null;
}

let personalProjectId: string | null = null;
let personalProjectUser: string | null = null;
export function forgetPersonalProject() {
  personalProjectId = null;
  personalProjectUser = null;
}

async function ensurePersonalProject(api: ApiLike, userKey: string, signal?: AbortSignal): Promise<string> {
  if (personalProjectId && personalProjectUser === userKey) return personalProjectId;
  const r = await api.post<{ projectId?: unknown }>("/api/v1/projects/personal", {}, { signal });
  if (typeof r.projectId !== "string" || !/^prj_[0-9a-f]{18}$/.test(r.projectId)) throw new Error(UNEXPECTED_PROJECT);
  personalProjectId = r.projectId;
  personalProjectUser = userKey;
  return r.projectId;
}

/**
 * Start one analysis and wait for it. Call ONLY from a user action.
 * @param userKey any stable string for the signed-in user (the uid), used only to avoid reusing another user's project id in memory
 */
export async function runAnalysis(userKey: string, paperRef: string, depth: AnalysisDepth, deps: RunDeps): Promise<AnalysisOutcome> {
  const { api, describeError } = deps;
  const sleep = deps.sleep || defaultSleep;
  const now = deps.now || Date.now;
  const maxWait = deps.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const stopped = () => Boolean(deps.signal && deps.signal.aborted);
  const key = (deps.newKey || defaultKey)(); // ONE key for this tap, reused if the start request is repeated
  deps.onProgress && deps.onProgress("PREPARING");

  let projectId: string;
  try {
    projectId = await ensurePersonalProject(api, userKey, deps.signal);
  } catch (e) {
    return { kind: "FAILED", message: isApiError(e) ? describeError(e) : UNEXPECTED_PROJECT, jobId: "" };
  }
  if (stopped()) return { kind: "STOPPED", jobId: null, message: "Stopped before the analysis was started." };

  let started: Record<string, unknown> | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2 && !started; attempt++) {
    try {
      started = await api.post("/api/v1/analysis", { projectId, paperId: paperRef, analysisDepth: depth }, { signal: deps.signal, headers: { "Idempotency-Key": key } });
    } catch (e) {
      lastError = e;
      if (isApiError(e) && e.kind === "INVALID_REQUEST" && (e.code === "CONTENT_UNAVAILABLE" || e.code === "METADATA_ONLY")) {
        return { kind: "UNAVAILABLE", reason: e.code, message: e.message };
      }
      const transient = isApiError(e) && (e.kind === "NETWORK" || e.kind === "TIMEOUT");
      if (!transient || stopped()) return { kind: "FAILED", message: describeError(e), jobId: "" };
      await sleep(800); // repeat once with the SAME key; the server returns the job it already made if the first request got through
    }
  }
  if (!started) return { kind: "FAILED", message: describeError(lastError), jobId: "" };
  const jobId = typeof started.jobId === "string" ? started.jobId : "";
  if (!/^job_[A-Za-z0-9_-]{4,80}$/.test(jobId)) return { kind: "FAILED", message: "The server sent an unexpected answer.", jobId: "" };

  const t0 = now();
  let step = 0;
  let status = typeof started.status === "string" ? started.status : "QUEUED";
  for (;;) {
    if (status === "COMPLETED" || status === "SUCCEEDED") {
      const result = isObj(started) && isObj(started.result) ? started.result : null;
      if (result) return { kind: "DONE", body: result, jobId };
      // finished but the result was not in the last answer: fetch it once
      try {
        const final = await api.get<Record<string, unknown>>(`/api/v1/analysis/${encodeURIComponent(jobId)}`, { signal: deps.signal });
        return isObj(final.result) ? { kind: "DONE", body: final.result, jobId } : { kind: "FAILED", message: "The analysis finished but returned no result.", jobId };
      } catch (e) {
        return { kind: "FAILED", message: describeError(e), jobId };
      }
    }
    if (TERMINAL_FAILED.has(status)) {
      const err = isObj(started) && isObj(started.error) ? started.error : null;
      const msg = err && typeof err.message === "string" ? err.message.slice(0, 300) : "The analysis could not be completed.";
      if (err && (err.code === "CONTENT_UNAVAILABLE" || err.code === "METADATA_ONLY")) return { kind: "UNAVAILABLE", reason: err.code, message: msg };
      return { kind: "FAILED", message: msg, jobId };
    }
    deps.onProgress && deps.onProgress(status === "PROCESSING" || status === "RUNNING" ? "RUNNING" : "QUEUED");
    if (stopped()) return { kind: "STOPPED", jobId, message: "You stopped waiting. The analysis may still finish on the server." };
    if (now() - t0 > maxWait) return { kind: "TIMED_OUT", jobId, message: "This is taking longer than expected. The analysis may still finish on the server; open this paper again later." };
    await sleep(POLL_STEPS_MS[Math.min(step++, POLL_STEPS_MS.length - 1)]);
    if (stopped()) return { kind: "STOPPED", jobId, message: "You stopped waiting. The analysis may still finish on the server." };
    try {
      started = await api.get<Record<string, unknown>>(`/api/v1/analysis/${encodeURIComponent(jobId)}`, { signal: deps.signal });
      status = typeof started.status === "string" ? started.status : status;
    } catch (e) {
      if (isApiError(e) && (e.kind === "NETWORK" || e.kind === "TIMEOUT" || e.kind === "UNAVAILABLE" || e.kind === "RATE_LIMITED")) continue; // keep waiting; the bound above still applies
      return { kind: "FAILED", message: describeError(e), jobId };
    }
  }
}
