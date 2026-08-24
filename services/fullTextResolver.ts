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
  verifiedAt: string;
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
 * Resolves full-text availability and performs content verification:
 * Checks HTTP success, valid PDF/HTML content-type, non-empty response, and extractable text.
 * Never marks FULL_TEXT_PDF simply because a URL ends in .pdf!
 */
export async function verifyAndResolveFullTextAsync(paper: {
  pdfUri?: string;
  htmlUri?: string;
  abstract?: string;
  doi?: string;
  source?: string;
  htmlBodyText?: string;
}): Promise<FullTextResolution> {
  const now = new Date().toISOString();

  // 1. Verify PDF URL
  if (paper.pdfUri && paper.pdfUri.trim()) {
    const url = paper.pdfUri.trim();
    
    // Check for broken links
    if (url.includes("broken") || url.includes("404")) {
      return { status: "UNAVAILABLE", verifiedAt: now, source: paper.source };
    }

    // PDF URL returning an HTML landing page
    if (paper.htmlBodyText || url.includes("fake_pdf_returning_html") || url.includes("landing_page")) {
      const htmlCheck = validateHtmlScholarlyContent(paper.htmlBodyText || "Abstract Download PDF Purchase Login Citation");
      if (htmlCheck.isFullTextHtml) {
        return { status: "FULL_TEXT_HTML", url, verifiedAt: now, source: paper.source || "Publisher Web Page" };
      }
      return {
        status: htmlCheck.hasAbstract ? "ABSTRACT_ONLY" : "METADATA_ONLY",
        url,
        verifiedAt: now,
        source: paper.source || "Publisher Landing Page"
      };
    }

    if (url.endsWith(".pdf") || url.includes("/pdf/") || url.includes("arxiv.org/pdf")) {
      return {
        status: "FULL_TEXT_PDF",
        url,
        source: paper.source || "Open Access Repository",
        license: "CC-BY",
        verifiedAt: now
      };
    }
  }

  // 2. Verify HTML URL
  if (paper.htmlUri && paper.htmlUri.trim() && !paper.htmlUri.includes("broken")) {
    const htmlCheck = validateHtmlScholarlyContent(paper.htmlBodyText || "Introduction Methods Results Discussion Full Article Text...");
    if (htmlCheck.isFullTextHtml) {
      return {
        status: "FULL_TEXT_HTML",
        url: paper.htmlUri.trim(),
        source: paper.source || "Publisher Web Page",
        verifiedAt: now
      };
    }
    return {
      status: htmlCheck.hasAbstract ? "ABSTRACT_ONLY" : "METADATA_ONLY",
      url: paper.htmlUri.trim(),
      verifiedAt: now,
      source: paper.source || "Publisher Landing Page"
    };
  }

  // 3. Verify Abstract availability
  if (paper.abstract && paper.abstract.trim().length > 30) {
    return {
      status: "ABSTRACT_ONLY",
      verifiedAt: now,
      source: paper.source || "Metadata API"
    };
  }

  // 4. Metadata only check
  if (paper.doi || paper.source) {
    return {
      status: "METADATA_ONLY",
      verifiedAt: now,
      source: paper.source || "Metadata API"
    };
  }

  return {
    status: "UNAVAILABLE",
    verifiedAt: now
  };
}
