export type ProvenanceField<T = string> = {
  value: T;
  source: string;
  verifiedAt: string;
  confidence: "high" | "medium" | "low";
};

export type PaperMetadataRecord = {
  canonicalId: string;
  doi?: ProvenanceField<string>;
  pmid?: ProvenanceField<string>;
  arxivId?: ProvenanceField<string>;
  title: ProvenanceField<string>;
  authors: ProvenanceField<string[]>;
  pubYear: ProvenanceField<number>;
  venue: ProvenanceField<string>;
  publisher: ProvenanceField<string>;
  abstract?: ProvenanceField<string>;
  rawProviderRecords: Record<string, any>;
  conflicts: Array<{ field: string; values: Array<{ source: string; value: any }> }>;
};

/**
 * Normalizes a title for identity purposes: strips ".pdf", accents and all punctuation, lowercases, collapses spaces.
 * MUST stay identical to backend/papers/identity.js (backend/tests/node/paperIdentity.test.js checks both on a shared corpus).
 */
export function normalizeTitleString(rawTitle: string): string {
  if (typeof rawTitle !== "string") return "";
  let clean = rawTitle.trim().replace(/\.pdf$/i, "");
  clean = clean.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return clean.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Normalizes first author name. */
export function normalizeAuthorName(authorStr?: string): string {
  if (typeof authorStr !== "string" || !authorStr.trim()) return "scholar";
  return authorStr.split(",")[0].trim().toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "") || "scholar";
}

const DOI_RE = /^10\.\d{4,9}\/[a-z0-9\/._\-]+$/;
const ARXIV_NEW_RE = /^\d{4}\.\d{4,5}$/;
const ARXIV_OLD_RE = /^[a-z\-]+(\.[a-z]{2})?\/\d{7}$/;

function normalizeDoi(raw?: string): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/^(https?:\/\/)?(dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");
  s = s.replace(/[^a-z0-9\/._\-]/g, "");
  return DOI_RE.test(s) && s.length <= 150 ? s : null;
}

function normalizeArxiv(raw?: string): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/^(https?:\/\/)?(www\.)?arxiv\.org\/(abs|pdf|html)\//, "").replace(/\.pdf$/, "").replace(/^arxiv:\s*/, "");
  s = s.replace(/v\d+$/, "");
  return ARXIV_NEW_RE.test(s) || ARXIV_OLD_RE.test(s) ? s : null;
}

/**
 * The paper identity the backend uses (DOI -> PMID -> arXiv -> normalized title + first author + year), or null when the
 * fields do not identify a paper. No random value and no default year is ever invented.
 * MUST stay identical to backend/papers/identity.js canonicalPaperId.
 */
export function strictCanonicalPaperId(paper: {
  doi?: string;
  pmid?: string | number;
  arxivId?: string;
  title?: string;
  authors?: string[];
  authorName?: string;
  pubYear?: number;
}): string | null {
  if (!paper || typeof paper !== "object") return null;
  const doi = paper.doi ? normalizeDoi(paper.doi) : null;
  if (doi) {
    const m = /^10\.48550\/arxiv\.(.+)$/.exec(doi);
    const fromDoi = m ? normalizeArxiv(m[1]) : null;
    return fromDoi ? `arxiv:${fromDoi}` : `doi:${doi}`;
  }
  if (paper.pmid !== undefined && paper.pmid !== null && paper.pmid !== "") {
    const p = String(paper.pmid).trim().toLowerCase().replace(/^pmid:?\s*/, "");
    if (/^\d{1,9}$/.test(p)) return `pmid:${p}`;
  }
  const ax = paper.arxivId ? normalizeArxiv(paper.arxivId) : null;
  if (ax) return `arxiv:${ax}`;

  const title = normalizeTitleString(paper.title as string).slice(0, 50).trim();
  const year = Number(paper.pubYear);
  if (title.length >= 6 && Number.isInteger(year) && year >= 1500 && year <= 2200) {
    const first = normalizeAuthorName(Array.isArray(paper.authors) && paper.authors.length ? paper.authors[0] : paper.authorName);
    return `title:${title}-${first.slice(0, 40)}-${year}`;
  }
  return null;
}

/**
 * Identity for LOCAL grouping and de-duplication only. When the fields do not identify a paper, the result is a
 * deterministic `local:` key (not a backend identity; the backend rejects it). Use strictCanonicalPaperId for API calls.
 */
export function resolveDeterministicCanonicalId(paper: {
  doi?: string;
  pmid?: string;
  arxivId?: string;
  title: string;
  authors?: string[];
  pubYear?: number;
  venue?: string;
  id?: string;
}): string {
  return strictCanonicalPaperId(paper) ?? `local:${paper.id ?? normalizeTitleString(paper.title)}`;
}

export function generateCanonicalPaperId(paper: { id?: string; doi?: string; pmid?: string; arxivId?: string; title: string; authors?: string[]; pubYear?: number; authorName?: string }): string {
  return resolveDeterministicCanonicalId({
    id: paper.id,
    doi: paper.doi,
    pmid: paper.pmid,
    arxivId: paper.arxivId,
    title: paper.title,
    authors: paper.authors || (paper.authorName ? [paper.authorName] : []),
    pubYear: paper.pubYear
  });
}

export function deduplicatePaperList<T extends { id: string; title: string; doi?: string; pmid?: string; arxivId?: string; authors?: string[]; authorName?: string; pubYear?: number }>(papers: T[]): T[] {
  const seenIds = new Set<string>();
  const unique: T[] = [];

  for (const p of papers) {
    const cId = generateCanonicalPaperId(p);
    if (!seenIds.has(cId)) {
      seenIds.add(cId);
      unique.push(p);
    }
  }

  return unique;
}
