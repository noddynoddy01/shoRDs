import AsyncStorage from "@react-native-async-storage/async-storage";
import { Paper } from "@/types/models";
import { registerPaperBatch } from "./paperRegistry";

export type SearchFilters = {
  yearRange?: [number, number];
  openAccessOnly?: boolean;
  sortBy?: "relevance" | "recency" | "oldest" | "citations" | "impact";
  domain?: string;
  sources?: string[]; // Publication Filter: All, arXiv, OpenAlex, Europe PMC, CORE, DOAJ, Crossref, bioRxiv, medRxiv, Zenodo, OpenAIRE
};

export type FederatedPaper = Paper & {
  sourceTag: "[OpenAlex]" | "[arXiv]" | "[Crossref]" | "[Europe PMC]" | "[CORE]" | "[DOAJ]" | "[PubMed]" | "[bioRxiv]" | "[medRxiv]" | "[Zenodo]";
  citationCount?: number;
  doi?: string;
  publication?: string;
  publisher?: string;
  is_open_access?: boolean;
};

const BACKEND_API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

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

export async function executeLiveFederatedSearch(
  query: string,
  page: number = 1,
  filters: SearchFilters = {}
): Promise<{ papers: FederatedPaper[]; isOffline: boolean }> {
  try {
    const params = new URLSearchParams({
      q: query,
      page: page.toString(),
      limit: "15",
      open_access_only: filters.openAccessOnly ? "true" : "false",
      sort_by: filters.sortBy || "relevance"
    });

    if (filters.yearRange) {
      params.append("year_start", filters.yearRange[0].toString());
      params.append("year_end", filters.yearRange[1].toString());
    }

    if (filters.sources && filters.sources.length > 0 && !filters.sources.includes("all")) {
      params.append("sources", filters.sources.join(","));
    }

    const response = await fetch(`${BACKEND_API_URL}/api/v1/search?${params.toString()}`);
    if (response.ok) {
      const data = await response.json();
      const mapped: FederatedPaper[] = (data.papers || []).map((p: any) => ({
        id: p.id,
        title: p.title || "Untitled Paper",
        domain: p.research_field || "Science",
        summary: p.abstract || `Indexed by ${p.source}.`,
        fullExplanation: p.abstract || `Detailed metadata record for ${p.title}.`,
        authorId: "federated-author",
        authorName: Array.isArray(p.authors) ? p.authors.join(", ") : (p.authors || "Academic Scholar"),
        authorRole: "Researcher",
        originalLink: p.html_url || p.pdf_url || (p.doi ? `https://doi.org/${p.doi}` : "https://shords.app"),
        pdfUri: p.pdf_url,
        tags: [p.source.toLowerCase(), "peer-reviewed"],
        readingTime: "5 min read",
        savedCount: p.citation_count || 0,
        createdAt: new Date(),
        organization: p.institution || p.publication || p.source,
        pubYear: p.year || 2026,
        doi: p.doi,
        sourceTag: `[${(p.source || "OpenAlex").split(",")[0].trim()}]` as any,
        citationCount: p.citation_count || 0,
        publication: p.publication,
        publisher: p.publisher,
        is_open_access: p.is_open_access,
        insights: [
          `Cited ${p.citation_count || 0} times in literature.`,
          `Published in ${p.publication || p.source} (${p.year || 2026}).`
        ]
      }));

      await registerPaperBatch(mapped as any);
      return { papers: mapped, isOffline: false };
    }
  } catch (err) {
    console.warn("Backend API call failed, falling back to direct OpenAlex & arXiv fetchers:", err);
  }

  return fallbackClientSearch(query, page, filters);
}

async function fallbackClientSearch(
  query: string, 
  page: number,
  filters: SearchFilters
): Promise<{ papers: FederatedPaper[]; isOffline: boolean }> {
  try {
    let sortParam = "relevance";
    if (filters.sortBy === "recency") sortParam = "publication_date:desc";
    else if (filters.sortBy === "citations" || filters.sortBy === "impact") sortParam = "cited_by_count:desc";

    let url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=15&page=${page}`;
    if (sortParam !== "relevance") {
      url += `&sort=${sortParam}`;
    }
    if (filters.openAccessOnly) {
      url += `&filter=is_oa:true`;
    }

    const response = await fetch(url);
    if (!response.ok) return { papers: [], isOffline: true };

    const data = await response.json();
    const results = data.results || [];

    const mapped: FederatedPaper[] = results.map((work: any, idx: number) => {
      const title = work.title || `Manuscript ${work.id?.split("/").pop() || idx}`;
      const doi = work.doi ? work.doi.replace("https://doi.org/", "") : undefined;
      
      const authorNames = (work.authorships || []).map((a: any) => a.author?.display_name).filter(Boolean);
      const authorName = authorNames.length > 0 ? authorNames.slice(0, 3).join(", ") : "Academic Scholar";
      
      const org = work.host_venue?.display_name || "OpenAlex Journal";
      const pubYear = work.publication_year || 2026;
      const citationCount = work.cited_by_count || 0;
      const pdfUri = work.open_access?.oa_url || (work.doi ? work.doi : undefined);

      const fullAbstract = work.abstract || reconstructOpenAlexAbstract(work.abstract_inverted_index) || `Indexed by OpenAlex in ${org}. Cited by ${citationCount} publications.`;

      return {
        id: `openalex-${work.id?.split("/").pop() || idx}`,
        title,
        domain: work.concepts?.[0]?.display_name || "Computer Science",
        summary: fullAbstract,
        fullExplanation: fullAbstract,
        authorId: "openalex-author",
        authorName,
        authorRole: "OpenAlex Researcher",
        originalLink: work.doi || work.id || "https://openalex.org",
        pdfUri,
        tags: ["openalex", "peer-reviewed"],
        readingTime: "5 min read",
        savedCount: citationCount,
        createdAt: new Date(),
        organization: org,
        pubYear,
        doi,
        sourceTag: "[OpenAlex]",
        citationCount,
        publication: org,
        is_open_access: work.open_access?.is_oa || false,
        insights: [
          `Cited ${citationCount} times in peer-reviewed literature.`,
          `Published in ${org} (${pubYear}).`
        ]
      };
    });

    await registerPaperBatch(mapped as any);
    return { papers: mapped, isOffline: false };
  } catch (err) {
    return { papers: [], isOffline: true };
  }
}

export async function searchFederatedPapers(
  query: string,
  filters: SearchFilters = {},
  page: number = 1
): Promise<FederatedPaper[]> {
  const result = await executeLiveFederatedSearch(query, page, filters);
  return result.papers;
}
