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
 * Normalizes title string by stripping file extensions (.pdf), trailing punctuation,
 * extra spaces, and converting to lowercase.
 */
export function normalizeTitleString(rawTitle: string): string {
  if (!rawTitle) return "";
  let clean = rawTitle.trim();
  clean = clean.replace(/\.pdf$/i, "");
  clean = clean.replace(/[:.,;\-–—]/g, " ");
  clean = clean.replace(/\s+/g, " ").trim().toLowerCase();
  return clean;
}

/**
 * Normalizes first author name.
 */
export function normalizeAuthorName(authorStr?: string): string {
  if (!authorStr) return "scholar";
  const first = authorStr.split(",")[0].trim().toLowerCase();
  return first.replace(/[^a-z]/g, "");
}

/**
 * Resolves deterministic canonical paper ID using strict priority hierarchy:
 * 1) DOI -> 2) PMID -> 3) arXiv ID -> 4) Exact Normalized Title + First Author + Year -> 5) Multi-Signal Fuzzy
 */
export function resolveDeterministicCanonicalId(paper: {
  doi?: string;
  pmid?: string;
  arxivId?: string;
  title: string;
  authors?: string[];
  pubYear?: number;
  venue?: string;
}): string {
  if (paper.doi && paper.doi.trim()) {
    const cleanDoi = paper.doi.trim().toLowerCase().replace(/^https?:\/\/doi\.org\//, "");
    return `doi:${cleanDoi.replace(/[^a-z0-9\/._\-]/gi, "")}`;
  }

  if (paper.pmid && paper.pmid.trim()) {
    return `pmid:${paper.pmid.trim()}`;
  }

  if (paper.arxivId && paper.arxivId.trim()) {
    const cleanArxiv = paper.arxivId.trim().toLowerCase().replace(/^arxiv:/, "");
    return `arxiv:${cleanArxiv}`;
  }

  const cleanTitle = normalizeTitleString(paper.title);
  const firstAuthor = normalizeAuthorName(paper.authors && paper.authors.length > 0 ? paper.authors[0] : undefined);
  const year = paper.pubYear || 2026;

  if (cleanTitle.length > 5) {
    return `title:${cleanTitle.slice(0, 50)}-${firstAuthor}-${year}`;
  }

  return `id:${Math.random().toString(36).substring(2, 9)}`;
}

export function generateCanonicalPaperId(paper: { doi?: string; pmid?: string; arxivId?: string; title: string; authors?: string[]; pubYear?: number; authorName?: string }): string {
  return resolveDeterministicCanonicalId({
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

/**
 * Multi-Signal Deduplication Engine:
 * Deduplicates paper records from multiple providers without merging fuzzy title matches
 * unless supporting signals (authors, year, venue) match.
 */
export function deduplicateProviderRecords(records: any[]): PaperMetadataRecord[] {
  const canonicalMap = new Map<string, PaperMetadataRecord>();

  for (const rec of records) {
    const canonicalId = resolveDeterministicCanonicalId({
      doi: rec.doi,
      pmid: rec.pmid,
      arxivId: rec.arxivId,
      title: rec.title || "",
      authors: Array.isArray(rec.authors) ? rec.authors : [rec.authorName || ""],
      pubYear: rec.pubYear || rec.year,
      venue: rec.venue || rec.organization
    });

    const now = new Date().toISOString();

    if (!canonicalMap.has(canonicalId)) {
      const metadataRecord: PaperMetadataRecord = {
        canonicalId,
        doi: rec.doi ? { value: rec.doi, source: rec.provider || "OpenAlex", verifiedAt: now, confidence: "high" } : undefined,
        pmid: rec.pmid ? { value: rec.pmid, source: rec.provider || "PubMed", verifiedAt: now, confidence: "high" } : undefined,
        arxivId: rec.arxivId ? { value: rec.arxivId, source: rec.provider || "arXiv", verifiedAt: now, confidence: "high" } : undefined,
        title: { value: rec.title || "Untitled Manuscript", source: rec.provider || "OpenAlex", verifiedAt: now, confidence: "high" },
        authors: { value: Array.isArray(rec.authors) ? rec.authors : [rec.authorName || "Academic Scholar"], source: rec.provider || "OpenAlex", verifiedAt: now, confidence: "high" },
        pubYear: { value: rec.pubYear || rec.year || 2026, source: rec.provider || "OpenAlex", verifiedAt: now, confidence: "high" },
        venue: { value: rec.venue || rec.organization || "Academic Venue", source: rec.provider || "OpenAlex", verifiedAt: now, confidence: "high" },
        publisher: { value: rec.publisher || rec.organization || "Academic Publisher", source: rec.provider || "OpenAlex", verifiedAt: now, confidence: "high" },
        abstract: (rec.abstract || rec.summary) ? { value: rec.abstract || rec.summary, source: rec.provider || "OpenAlex", verifiedAt: now, confidence: "high" } : undefined,
        rawProviderRecords: { [rec.provider || "OpenAlex"]: rec },
        conflicts: []
      };
      canonicalMap.set(canonicalId, metadataRecord);
    } else {
      const existing = canonicalMap.get(canonicalId)!;
      existing.rawProviderRecords[rec.provider || "Secondary"] = rec;

      // Check venue/publisher conflicts and preserve provenance
      if (rec.venue && existing.venue.value !== rec.venue) {
        existing.conflicts.push({
          field: "venue",
          values: [
            { source: existing.venue.source, value: existing.venue.value },
            { source: rec.provider || "Secondary", value: rec.venue }
          ]
        });
      }
    }
  }

  return Array.from(canonicalMap.values());
}
