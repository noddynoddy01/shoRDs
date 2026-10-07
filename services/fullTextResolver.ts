export type FullTextStatus =
  | "FULL_TEXT_PDF"
  | "FULL_TEXT_HTML"
  | "ABSTRACT_ONLY"
  | "METADATA_ONLY"
  | "UNAVAILABLE";

export interface FullTextResolution {
  status: FullTextStatus;
  url?: string;
  source?: string;
  license?: string;
  /** Set only when a check really ran. This module makes no network call, so it never sets it. */
  verifiedAt?: string;
}

/**
 * Validates whether an HTML document contains the actual full scholarly article body
 * vs a publisher/repository landing page containing only an abstract or download link.
 */
export function validateHtmlScholarlyContent(htmlContent: string): { isFullTextHtml: boolean; hasAbstract: boolean } {
  if (!htmlContent || htmlContent.length < 500) {
    return { isFullTextHtml: false, hasAbstract: htmlContent.toLowerCase().includes("abstract") };
  }

  const lower = htmlContent.toLowerCase();

  // Landing page indicators:
  // Pages containing only "Download PDF", "Purchase", "Login to view", "Cite this article"
  // without main body section headers are landing pages.
  const hasLandingPageOnlyText = lower.includes("download pdf") || lower.includes("purchase article") || lower.includes("login to access");
  const hasFullArticleSections = (lower.includes("introduction") && lower.includes("method")) || 
                                (lower.includes("results") && lower.includes("discussion")) ||
                                lower.includes("<article>") || lower.includes("section-body");

  const hasSubstantialText = htmlContent.length > 2500;

  if (hasFullArticleSections && hasSubstantialText && !hasLandingPageOnlyText) {
    return { isFullTextHtml: true, hasAbstract: true };
  }

  const hasAbstract = lower.includes("abstract") || htmlContent.length > 300;
  return { isFullTextHtml: false, hasAbstract };
}

/**
 * Says what the record itself contains. It does NOT fetch or verify anything: a link ending in ".pdf" proves nothing about
 * what is behind it, so a URL never makes a record "full text", and no licence or verification time is claimed.
 * Real full text exists only when text was actually retrieved and extracted (the backend does that: POST /api/v1/papers/resolve).
 * (An earlier version returned FULL_TEXT_PDF with a "CC-BY" licence for any URL ending in .pdf, and contained test hooks such as
 * "fake_pdf_returning_html" in production code.)
 */
export async function verifyAndResolveFullTextAsync(paper: {
  pdfUri?: string;
  htmlUri?: string;
  abstract?: string;
  doi?: string;
  source?: string;
  htmlBodyText?: string;
}): Promise<FullTextResolution> {
  if (paper.abstract && paper.abstract.trim().length > 30) {
    return { status: "ABSTRACT_ONLY", source: paper.source };
  }
  if (paper.doi || paper.source) {
    return { status: "METADATA_ONLY", source: paper.source };
  }
  return { status: "UNAVAILABLE" };
}
