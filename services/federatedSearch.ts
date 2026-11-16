import { Paper } from "@/types/models";
import { registerPaperBatch } from "./paperRegistry";

/**
 * Public scholarly-metadata discovery from the app, straight to the OpenAlex API (no key is attached; see the audit note below).
 *
 * What this module deliberately does NOT do any more:
 *  - It no longer calls `${API}/api/v1/search`. The backend has no such route, so every search paid a failed round trip first.
 *  - It no longer pretends to search arXiv, Crossref, Europe PMC, CORE, DOAJ or PubMed separately. Only OpenAlex is queried.
 *    A filter this module cannot honour is reported in `ignoredFilters` so the UI can say so instead of silently dropping it.
 *
 * Facts about the provider (from help.openalex.org, checked 2026-11-03; not re-verified against the live API from the build environment):
 *  - `host_venue` is removed (use `primary_location`); `concepts` is deprecated (use `primary_topic`); `mailto`/polite pool is gone.
 *  - HTTP 429 means either the request rate or the daily credit budget was exceeded; it is not retried here.
 *  - `per_page` allows at most 100.
 */

export type SearchFilters = {
  yearRange?: [number, number];
  openAccessOnly?: boolean;
  sortBy?: "relevance" | "recency" | "oldest" | "citations" | "impact";
  /** Not supported by this provider call. Reported back in `ignoredFilters` if set. */
  domain?: string;
  /** Only OpenAlex is queried. Any other value is reported back in `ignoredFilters`. */
  sources?: string[];
};

export type FederatedPaper = Paper & {
  sourceTag: "[OpenAlex]";
  citationCount?: number;
  doi?: string;
  publication?: string;
  publisher?: string;
  is_open_access?: boolean;
};

export type SearchStatus = "ok" | "rate_limited" | "timeout" | "network" | "server_error" | "bad_response";

export type FederatedSearchResult = {
  papers: FederatedPaper[];
  /** True only when the device could not reach the provider at all (no network or timeout). */
  isOffline: boolean;
  status: SearchStatus;
  /** Filters the caller asked for that were not applied. Never empty-and-silent. */
  ignoredFilters: string[];
  fromCache: boolean;
};

export const OPENALEX_WORKS_URL = "https://api.openalex.org/works";
export const SEARCH_TIMEOUT_MS = 8000;
export const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 60;
const PAGE_SIZE = 15;

export function reconstructOpenAlexAbstract(invertedIndex: Record<string, number[]> | undefined): string {
  if (!invertedIndex || typeof invertedIndex !== "object") return "";
  try {
    const positions: [number, string][] = [];
    for (const [word, posList] of Object.entries(invertedIndex)) {
      if (Array.isArray(posList)) {
        for (const pos of posList) {
          positions.push([pos, word]);
        }
      }
    }
    positions.sort((a, b) => a[0] - b[0]);
    return positions.map(p => p[1]).join(" ");
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------------------------------------ request building

export type OpenAlexQuery = {
  query: string;
  page?: number;
  perPage?: number;
  sortBy?: SearchFilters["sortBy"];
  openAccessOnly?: boolean;
  yearRange?: [number, number];
};

/** Build the OpenAlex works URL. Pure, so it is unit-testable. */
export function buildOpenAlexUrl(q: OpenAlexQuery): string {
  const params: string[] = [];
  params.push(`search=${encodeURIComponent(q.query)}`);
  params.push(`per_page=${Math.max(1, Math.min(100, Math.floor(q.perPage ?? PAGE_SIZE)))}`);
  params.push(`page=${Math.max(1, Math.floor(q.page ?? 1))}`);
  const filters: string[] = [];
  if (q.openAccessOnly) filters.push("is_oa:true");
  if (q.yearRange) {
    const lo = Math.floor(Math.min(q.yearRange[0], q.yearRange[1]));
    const hi = Math.floor(Math.max(q.yearRange[0], q.yearRange[1]));
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      filters.push(`from_publication_date:${String(lo).padStart(4, "0")}-01-01`, `to_publication_date:${String(hi).padStart(4, "0")}-12-31`);
    }
  }
  if (filters.length) params.push(`filter=${filters.join(",")}`);
  // "impact" is not a measured quantity here: it is the citation count, so it is sorted as such and called that.
  const sort = q.sortBy === "recency" ? "publication_date:desc" : q.sortBy === "oldest" ? "publication_date:asc" : q.sortBy === "citations" || q.sortBy === "impact" ? "cited_by_count:desc" : "";
  if (sort) params.push(`sort=${sort}`);
  return `${OPENALEX_WORKS_URL}?${params.join("&")}`;
}

/** Filters the caller set that this provider call does not honour. */
export function ignoredFiltersFor(filters: SearchFilters): string[] {
  const out: string[] = [];
  if (filters.domain && filters.domain.trim()) out.push("domain");
  const sources = (filters.sources || []).filter(s => s && s !== "all" && s.toLowerCase() !== "openalex");
  if (sources.length) out.push("sources");
  return out;
}

// ------------------------------------------------------------------------------------------------ mapping

function venueOf(work: any): string {
  // `host_venue` was removed from OpenAlex; `primary_location.source` is its replacement.
  return work?.primary_location?.source?.display_name || "";
}

/** Map one OpenAlex work to the app's paper shape. Unknown stays unknown: nothing is invented. */
export function mapOpenAlexWork(work: any, idx: number): FederatedPaper {
  const shortId = typeof work?.id === "string" ? work.id.split("/").pop() : "";
  const title = work?.title || work?.display_name || `Manuscript ${shortId || idx}`;
  const doi = work?.doi ? String(work.doi).replace("https://doi.org/", "") : undefined;
  const authorNames = (work?.authorships || []).map((a: any) => a?.author?.display_name).filter(Boolean);
  const authorName = authorNames.length > 0 ? authorNames.slice(0, 3).join(", ") : "";
  const venue = venueOf(work);
  const pubYear = typeof work?.publication_year === "number" ? work.publication_year : undefined;
  const citationCount = typeof work?.cited_by_count === "number" ? work.cited_by_count : 0;
  const oaUrl = work?.open_access?.oa_url || work?.primary_location?.pdf_url || undefined;
  const abstract = reconstructOpenAlexAbstract(work?.abstract_inverted_index) || "";
  const topic = work?.primary_topic?.field?.display_name || work?.primary_topic?.display_name || work?.concepts?.[0]?.display_name || "General Science";
  return {
    id: `openalex-${shortId || idx}`,
    title,
    domain: topic,
    summary: abstract,
    fullExplanation: abstract,
    authorId: "openalex-author",
    authorName,
    authorRole: "",
    originalLink: work?.doi || work?.id || "",
    pdfUri: oaUrl || undefined,
    tags: ["openalex"],
    readingTime: "",
    savedCount: citationCount,
    createdAt: new Date(),
    organization: venue,
    pubYear,
    doi,
    sourceTag: "[OpenAlex]",
    citationCount,
    publication: venue,
    publisher: work?.primary_location?.source?.host_organization_name || venue,
    is_open_access: !!work?.open_access?.is_oa,
    insights: []
  };
}

// ------------------------------------------------------------------------------------------------ transport

export function classifyHttpStatus(status: number): SearchStatus {
  if (status >= 200 && status < 300) return "ok";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "bad_response";
}

type CacheEntry = { at: number; papers: FederatedPaper[] };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<{ status: SearchStatus; papers: FederatedPaper[] }>>();

export function clearSearchCache() {
  cache.clear();
  inFlight.clear();
}

function remember(key: string, papers: FederatedPaper[], now: number) {
  cache.set(key, { at: now, papers });
  while (cache.size > SEARCH_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function requestOnce(url: string, timeoutMs: number, doFetch: typeof fetch): Promise<{ status: SearchStatus; papers: FederatedPaper[] }> {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await doFetch(url, ctl ? { signal: ctl.signal } : undefined);
    const status = classifyHttpStatus(res.status);
    if (status !== "ok") return { status, papers: [] };
    let data: any;
    try {
      data = await res.json();
    } catch {
      return { status: "bad_response", papers: [] };
    }
    if (!data || !Array.isArray(data.results)) return { status: "bad_response", papers: [] };
    return { status: "ok", papers: data.results.map((w: any, i: number) => mapOpenAlexWork(w, i)) };
  } catch (err: any) {
    return { status: err && err.name === "AbortError" ? "timeout" : "network", papers: [] };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * One cached, de-duplicated, time-limited OpenAlex page. A 5xx or a network error is retried once (after a short pause) because those are
 * usually transient; a 429 is never retried here because it can mean the daily credit budget is spent.
 * Shared by the search screens and the feed so both get the same timeout, error classification and cache.
 */
export async function fetchOpenAlexPage(
  q: OpenAlexQuery,
  opts: { timeoutMs?: number; now?: () => number; doFetch?: typeof fetch; retryDelayMs?: number } = {}
): Promise<{ status: SearchStatus; papers: FederatedPaper[]; fromCache: boolean }> {
  const now = (opts.now || Date.now)();
  const url = buildOpenAlexUrl(q);
  const hit = cache.get(url);
  if (hit && now - hit.at < SEARCH_CACHE_TTL_MS) return { status: "ok", papers: hit.papers, fromCache: true };

  const pending = inFlight.get(url);
  if (pending) return { ...(await pending), fromCache: false };

  const doFetch = opts.doFetch || fetch;
  const timeoutMs = opts.timeoutMs ?? SEARCH_TIMEOUT_MS;
  const run = (async () => {
    let r = await requestOnce(url, timeoutMs, doFetch);
    if (r.status === "server_error" || r.status === "network" || r.status === "timeout") {
      await new Promise(res => setTimeout(res, opts.retryDelayMs ?? 800));
      r = await requestOnce(url, timeoutMs, doFetch);
    }
    if (r.status === "ok") remember(url, r.papers, now);
    return r;
  })();
  inFlight.set(url, run);
  try {
    return { ...(await run), fromCache: false };
  } finally {
    inFlight.delete(url);
  }
}

// ------------------------------------------------------------------------------------------------ public API

export async function executeLiveFederatedSearch(
  query: string,
  page: number = 1,
  filters: SearchFilters = {}
): Promise<FederatedSearchResult> {
  const ignoredFilters = ignoredFiltersFor(filters);
  const trimmed = (query || "").trim();
  if (!trimmed) return { papers: [], isOffline: false, status: "ok", ignoredFilters, fromCache: false };
  const r = await fetchOpenAlexPage({
    query: trimmed,
    page,
    sortBy: filters.sortBy,
    openAccessOnly: filters.openAccessOnly,
    yearRange: filters.yearRange
  });
  if (r.status === "ok" && r.papers.length > 0) {
    try {
      await registerPaperBatch(r.papers as any);
    } catch {
      // The registry is a local convenience; a failure there must not hide results that were fetched.
    }
  }
  return { papers: r.papers, isOffline: r.status === "network" || r.status === "timeout", status: r.status, ignoredFilters, fromCache: r.fromCache };
}

export async function searchFederatedPapers(
  query: string,
  filters: SearchFilters = {},
  page: number = 1
): Promise<FederatedPaper[]> {
  const result = await executeLiveFederatedSearch(query, page, filters);
  return result.papers;
}
