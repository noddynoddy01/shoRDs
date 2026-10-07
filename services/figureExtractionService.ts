/**
 * Figure & table types and helpers. Extraction itself is NOT IMPLEMENTED (see retrieveOriginalFiguresAsync): no figure is shown
 * unless it was really taken from the paper.
 */

export type VisualSourceType =
  | "ORIGINAL_PAPER_FIGURE"
  | "ORIGINAL_PAPER_TABLE"
  | "ORIGINAL_PAPER_EQUATION"
  | "AI_GENERATED_EXPLANATION"
  | "NONE";

export interface ResearchFigure {
  id: string;
  paperId: string;
  figureNumber?: string; // e.g., "Figure 2" or "Table 1"
  title?: string; // e.g., "Proposed System Architecture"
  caption: string; // Original paper caption
  imageUrl?: string;
  sourceUrl?: string;
  sourceType: "HTML" | "XML" | "PDF" | "REPOSITORY";
  visualSource: VisualSourceType;
  pageNumber?: number;
  section?: string; // e.g., "METHODOLOGY" | "RESULTS"
  originalFigure: boolean;
  provenance: {
    doi?: string;
    canonicalId: string;
    provider: string;
    retrievedAt: string;
  };
  relevanceScore?: number;
  explanation?: {
    whatItShows: string;
    whyItMatters: string;
  };
}

/**
 * Original figures and tables of a paper.
 *
 * NOT IMPLEMENTED: no component of shoRDs extracts figures from a paper today (the production backend returns text chunks
 * only), so this returns an empty list. It previously built entries from guessed image addresses, invented captions and
 * explanations, and, for papers with a DOI, a stock photograph labelled "Figure 3: Core Experimental Results" with
 * `originalFigure: true`. That presented invented content as the paper's own figures and has been removed.
 *
 * When real extraction exists (server-side, with the figure's own caption and a link to the source), implement it here and
 * keep two rules: `originalFigure` is true only for an image that was actually taken from the paper, and every caption is the
 * paper's own text.
 */
export async function retrieveOriginalFiguresAsync(_paper: {
  id: string;
  title: string;
  pdfUri?: string;
  doi?: string;
  htmlUri?: string;
  domain?: string;
}): Promise<ResearchFigure[]> {
  return [];
}

/**
 * Selects 1 to 3 most informative figures, prioritizing methodology & key results graphs.
 */
export function selectTopInformativeFigures(figures: ResearchFigure[], maxCount: number = 3): ResearchFigure[] {
  if (figures.length <= maxCount) return figures;

  return figures
    .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
    .slice(0, maxCount);
}

/**
 * Validates that a figure is strictly bound to its canonical paper ID,
 * preventing cross-paper contamination.
 */
export function verifyFigureCanonicalBinding(figure: ResearchFigure, expectedCanonicalId: string): boolean {
  if (!figure || !expectedCanonicalId) return false;
  return figure.provenance.canonicalId === expectedCanonicalId;
}

