/**
 * Looks a paper up through the backend (POST /api/v1/papers/resolve) with the signed-in user's ID token.
 * The backend parses the reference (DOI, arXiv id, PMID, DOI/arXiv URL or canonical id), retrieves the record from its
 * scholarly providers and says honestly how much content it has (`coverage`). Nothing is fetched or invented in the browser.
 */

import { api } from "./auth/firebaseSession";

export type ResolvedPaper = {
  paperId: string;
  title: string;
  abstract: string | null;
  doi: string | null;
  venue: string | null;
  year: number | null;
  authors: string[];
  coverage: string;
  coverageNotice: string | null;
};

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Validate the server's paper view; unexpected shapes become null fields rather than guesses. */
export function parseResolvedPaper(json: unknown): ResolvedPaper {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const year = typeof j.year === "number" && Number.isInteger(j.year) && j.year > 0 ? j.year : null;
  return {
    paperId: str(j.paperId, 200) || "",
    title: str(j.title, 500) || "",
    abstract: str(j.abstract, 20000),
    doi: str(j.doi, 200),
    venue: str(j.venue, 300),
    year,
    authors: Array.isArray(j.authors) ? j.authors.filter((a): a is string => typeof a === "string").slice(0, 100) : [],
    coverage: str(j.coverage, 40) || "CONTENT_UNAVAILABLE",
    coverageNotice: str(j.coverageNotice, 600)
  };
}

export async function resolvePaperReference(reference: string): Promise<ResolvedPaper> {
  const json = await api.post("/api/v1/papers/resolve", { paperId: reference.trim() });
  return parseResolvedPaper(json);
}
