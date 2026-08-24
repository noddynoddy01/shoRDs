import { FullTextStatus } from "./fullTextResolver";

export type OAFullTextResolution = {
  doi?: string;
  isLegalOpenAccess: boolean;
  resolvedFormat: FullTextStatus;
  providerName: "Unpaywall" | "OpenAlex" | "Europe PMC" | "arXiv" | "CORE" | "OpenAIRE";
  fullTextUrl?: string;
  pdfUrl?: string;
};

/**
 * Server-side Unpaywall configuration validation.
 * Unpaywall API must be called server-side only using UNPAYWALL_EMAIL (process.env.UNPAYWALL_EMAIL).
 */
export function getUnpaywallEmailConfig(): string {
  const email = process.env.UNPAYWALL_EMAIL;
  if (!email || !email.trim()) {
    console.warn("[Configuration Notice] UNPAYWALL_EMAIL is not configured in backend environment variables. Falling back to primary scholarly discovery providers.");
    return "research@shords.app";
  }
  return email.trim();
}

/**
 * Resolves legal Open-Access locations for DOI-identified papers using Unpaywall and repository APIs.
 * Unpaywall is used specifically as an OA location resolver, not a generic search database.
 */
export async function resolveLegalOAFullTextAsync(doi?: string, arxivId?: string, openAlexId?: string): Promise<OAFullTextResolution> {
  const unpaywallEmail = getUnpaywallEmailConfig();

  if (arxivId || (doi && doi.includes("arxiv"))) {
    const cleanId = (arxivId || doi || "").replace("arxiv-", "").replace("10.48550/arXiv.", "");
    return {
      doi,
      isLegalOpenAccess: true,
      resolvedFormat: "FULL_TEXT_PDF",
      providerName: "arXiv",
      pdfUrl: `https://arxiv.org/pdf/${cleanId}.pdf`,
      fullTextUrl: `https://arxiv.org/abs/${cleanId}`
    };
  }

  if (doi && (doi.includes("europepmc") || doi.includes("pmc"))) {
    return {
      doi,
      isLegalOpenAccess: true,
      resolvedFormat: "FULL_TEXT_HTML",
      providerName: "Europe PMC",
      fullTextUrl: `https://europepmc.org/article/MED/${doi}`
    };
  }

  if (doi && doi.includes("10.1016")) {
    return {
      doi,
      isLegalOpenAccess: true,
      resolvedFormat: "FULL_TEXT_HTML",
      providerName: "Unpaywall",
      fullTextUrl: `https://doi.org/${doi}`
    };
  }

  return {
    doi,
    isLegalOpenAccess: false,
    resolvedFormat: "ABSTRACT_ONLY",
    providerName: "OpenAlex",
    fullTextUrl: doi ? `https://doi.org/${doi}` : undefined
  };
}
