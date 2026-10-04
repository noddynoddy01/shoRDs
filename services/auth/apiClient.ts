/**
 * The authenticated API client. Every protected request to the shoRDs backend goes through here.
 *
 *   Firebase sign-in -> ID token -> this client -> `Authorization: Bearer <token>` -> Railway backend
 *
 * Guarantees (each covered by backend/tests/node/frontendAuth.test.js):
 *  - No protected request is made before authentication state is known, or while signed out: the call fails locally with
 *    SIGNED_OUT and nothing is sent.
 *  - The token travels ONLY in the Authorization header: never in the URL or query string, never in the body, never in a log
 *    line or an error message, and never to any origin other than the configured backend (paths must start with /api/v1/;
 *    absolute URLs are refused; redirects are not followed).
 *  - A remote backend must be https. Plain http is accepted only for localhost development.
 *  - 401 -> the ID token is force-refreshed ONCE and the request retried once. If the retry is also 401 (or the refresh
 *    fails) the session is reported rejected and the caller gets UNAUTHENTICATED. No loops.
 *  - 403 (not a member / role too low), 404, 429, 503, 5xx, network failures and timeouts are typed errors, not retried here.
 *
 * No imports: pure TypeScript with injected dependencies so it runs unchanged under Node's test runner.
 */

export type ApiErrorKind =
  | "SIGNED_OUT"
  | "NOT_CONFIGURED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "INVALID_REQUEST"
  | "SERVER"
  | "NETWORK"
  | "TIMEOUT";

export class ApiError extends Error {
  kind: ApiErrorKind;
  status: number | null;
  code: string | null;
  retryAfterSec: number | null;
  requestId: string | null;
  constructor(kind: ApiErrorKind, message: string, extra: { status?: number | null; code?: string | null; retryAfterSec?: number | null; requestId?: string | null } = {}) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = extra.status ?? null;
    this.code = extra.code ?? null;
    this.retryAfterSec = extra.retryAfterSec ?? null;
    this.requestId = extra.requestId ?? null;
  }
}

export type AuthReadiness = "SIGNED_IN" | "SIGNED_OUT" | "UNCONFIGURED";

export type ApiClientDeps = {
  /** e.g. process.env.EXPO_PUBLIC_API_URL */
  baseUrl: string | undefined | null;
  /** Firebase `user.getIdToken(forceRefresh)`; null when nobody is signed in. */
  getIdToken: (forceRefresh: boolean) => Promise<string | null>;
  /** Resolves when auth state is known (not LOADING). */
  waitForAuthReady: () => Promise<AuthReadiness>;
  fetchImpl?: (url: string, init: Record<string, unknown>) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;
  /** Called when the backend still refuses a freshly refreshed token. */
  onSessionRejected?: (reason: "EXPIRED" | "INVALID") => void;
  timeoutMs?: number;
};

export type RequestOptions = { body?: unknown; query?: Record<string, string | number | boolean | undefined>; signal?: AbortSignal };

const PATH_RE = /^\/api\/v1\/[A-Za-z0-9_\-./:%~]*$/;
const MAX_MESSAGE = 300;

/** Validate and normalise the configured backend origin. Returns null when unusable (so no token can be sent anywhere). */
export function normalizeBaseUrl(raw: string | undefined | null): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch (_) {
    return null;
  }
  if (u.username || u.password || u.search || u.hash) return null;
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]" || u.hostname === "::1";
  if (u.protocol === "https:") {
    // ok
  } else if (u.protocol === "http:" && local) {
    // development only
  } else return null;
  const path = u.pathname.replace(/\/+$/, "");
  return `${u.protocol}//${u.host}${path}`;
}

export function buildUrl(base: string, path: string, query?: RequestOptions["query"]): string {
  if (typeof path !== "string" || !PATH_RE.test(path) || path.includes("..") || path.includes("//")) {
    throw new ApiError("INVALID_REQUEST", "Invalid API path.");
  }
  let url = base + path;
  if (query) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      // a credential must never be placed in a URL, whatever the caller does
      if (/^(token|access_token|id_token|authorization|auth|key|api_key|apikey)$/i.test(k)) throw new ApiError("INVALID_REQUEST", "Credentials cannot be sent in the URL.");
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    if (parts.length) url += `?${parts.join("&")}`;
  }
  return url;
}

function parseRetryAfter(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 3600 ? Math.ceil(n) : null;
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch (_) {
    return null;
  }
}

const clip = (s: unknown): string => (typeof s === "string" ? s.replace(/[\r\n]+/g, " ").slice(0, MAX_MESSAGE) : "");

export function createApiClient(deps: ApiClientDeps) {
  const base = normalizeBaseUrl(deps.baseUrl);
  const doFetch = deps.fetchImpl || ((url: string, init: Record<string, unknown>) => (globalThis as unknown as { fetch: NonNullable<ApiClientDeps["fetchImpl"]> }).fetch(url, init));
  const timeoutMs = deps.timeoutMs ?? 30000;
  let refreshing: Promise<string | null> | null = null;

  /** One shared forced refresh, however many requests hit a 401 at once. */
  function refreshToken(): Promise<string | null> {
    if (!refreshing) {
      refreshing = deps.getIdToken(true).then(
        (t) => {
          refreshing = null;
          return t;
        },
        () => {
          refreshing = null;
          return null;
        }
      );
    }
    return refreshing;
  }

  async function send(method: string, url: string, token: string, opts: RequestOptions) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    if (opts.signal && controller) opts.signal.addEventListener("abort", () => controller.abort());
    try {
      const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${token}` };
      let body: string | undefined;
      if (opts.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(opts.body);
      }
      return await doFetch(url, { method, headers, body, redirect: "error", credentials: "omit", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
    } catch (e) {
      const aborted = controller && controller.signal.aborted;
      throw new ApiError(aborted ? "TIMEOUT" : "NETWORK", aborted ? "The request took too long." : "Could not reach the server. Check your connection.");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function toError(res: { status: number; headers: { get(name: string): string | null } }, text: string): ApiError {
    const j = safeJson(text);
    const code = j && typeof j.error === "string" ? j.error.slice(0, 60) : null;
    const message = clip(j && j.message) || `Request failed (${res.status}).`;
    const extra = { status: res.status, code, retryAfterSec: parseRetryAfter(res.headers.get("retry-after")), requestId: j && typeof j.requestId === "string" ? j.requestId.slice(0, 80) : null };
    if (res.status === 401) return new ApiError("UNAUTHENTICATED", "Your session could not be verified. Sign in again.", extra);
    if (res.status === 403) return new ApiError("FORBIDDEN", message, extra);
    if (res.status === 404) return new ApiError("NOT_FOUND", message, extra);
    if (res.status === 429) return new ApiError("RATE_LIMITED", message, extra);
    if (res.status === 503) return new ApiError("UNAVAILABLE", message, extra);
    if (res.status >= 400 && res.status < 500) return new ApiError("INVALID_REQUEST", message, extra);
    return new ApiError("SERVER", "The server had a problem. Try again shortly.", extra);
  }

  async function request<T = Record<string, unknown>>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    if (!base) throw new ApiError("NOT_CONFIGURED", "The API address is not configured (EXPO_PUBLIC_API_URL must be an https URL).");
    const url = buildUrl(base, path, opts.query);

    // Nothing protected is sent until we know who (if anyone) is signed in.
    const readiness = await deps.waitForAuthReady();
    if (readiness !== "SIGNED_IN") throw new ApiError("SIGNED_OUT", "Sign in to continue.");
    let token = await deps.getIdToken(false);
    if (!token) throw new ApiError("SIGNED_OUT", "Sign in to continue.");

    let res = await send(method, url, token, opts);
    if (res.status === 401) {
      const fresh = await refreshToken();
      if (!fresh) {
        deps.onSessionRejected && deps.onSessionRejected("EXPIRED");
        throw new ApiError("UNAUTHENTICATED", "Your session expired. Sign in again.", { status: 401 });
      }
      token = fresh;
      res = await send(method, url, token, opts); // exactly one retry
      if (res.status === 401) {
        deps.onSessionRejected && deps.onSessionRejected("INVALID");
        throw new ApiError("UNAUTHENTICATED", "Your session could not be verified. Sign in again.", { status: 401 });
      }
    }
    const text = await res.text();
    if (res.status >= 200 && res.status < 300) {
      const j = safeJson(text);
      if (j === null) throw new ApiError("SERVER", "The server sent an unreadable response.", { status: res.status });
      return j as T;
    }
    throw toError(res, text);
  }

  return {
    configured: base !== null,
    request,
    get: <T = Record<string, unknown>>(path: string, opts?: Omit<RequestOptions, "body">) => request<T>("GET", path, opts),
    post: <T = Record<string, unknown>>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">) => request<T>("POST", path, { ...opts, body: body ?? {} }),
    put: <T = Record<string, unknown>>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">) => request<T>("PUT", path, { ...opts, body: body ?? {} })
  };
}

/** What to say to a user for an error (never includes tokens or internals). */
export function describeApiError(e: unknown): string {
  if (!(e instanceof ApiError)) return "Something went wrong. Try again.";
  switch (e.kind) {
    case "SIGNED_OUT":
    case "UNAUTHENTICATED":
      return "Sign in to continue.";
    case "FORBIDDEN":
      return "You do not have access to that project or action.";
    case "NOT_FOUND":
      return "That item was not found.";
    case "RATE_LIMITED":
      return e.retryAfterSec ? `Too many requests. Try again in ${e.retryAfterSec} seconds.` : "Too many requests. Try again shortly.";
    case "UNAVAILABLE":
      return e.message;
    case "NETWORK":
      return "Could not reach the server. Check your connection.";
    case "TIMEOUT":
      return "The request took too long. Try again.";
    case "NOT_CONFIGURED":
      return "This build is not connected to a server.";
    default:
      return e.message || "Something went wrong. Try again.";
  }
}
