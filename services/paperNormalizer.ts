import { Paper } from "@/types/models";

export type NormalizedPaper = Paper & {
  venue: string; // Authentic venue name (e.g. "Nature", "IEEE TPAMI", "NeurIPS")
  publisher: string; // Publisher (e.g. "Elsevier", "IEEE", "ACM", "Springer", "Nature Publishing Group")
  metadataSource: string; // Provider (e.g. "OpenAlex", "Crossref", "Europe PMC")
  isPeerReviewed: boolean;
};

/**
 * Brings a provider record into the app's Paper shape. It only reshapes what the record says: an unknown author, venue,
 * publisher, year or source stays empty. (Earlier versions guessed the venue from words in the title - "attention" became
 * "IEEE TPAMI", "clinical" became "The Lancet", anything else "NeurIPS Proceedings" - defaulted the author to "Academic Scholar",
 * the year to 2026, the source to "OpenAlex", and marked every paper peer-reviewed.)
 */
export function normalizeAndValidatePaper(rawInput: any): NormalizedPaper {
  if (!rawInput || typeof rawInput !== "object") {
    return {
      id: "unknown-paper",
      title: "Untitled record",
      domain: "",
      summary: "",
      fullExplanation: "",
      authorId: "",
      authorName: "",
      authorRole: "",
      organization: "",
      originalLink: "",
      tags: [],
      readingTime: "",
      savedCount: 0,
      createdAt: new Date(),
      venue: "",
      publisher: "",
      metadataSource: "",
      isPeerReviewed: false
    };
  }

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const title = str(rawInput.title) || str(rawInput.name) || "Untitled record";
  const summaryText = str(rawInput.summary) || str(rawInput.abstract) || str(rawInput.fullExplanation);
  const authors = Array.isArray(rawInput.authors) ? rawInput.authors.filter((a: unknown) => typeof a === "string").join(", ") : str(rawInput.authorName) || str(rawInput.authors);

  const venue = str(rawInput.venue) || str(rawInput.journal) || str(rawInput.publication);
  const publisher = str(rawInput.publisher) || str(rawInput.organization);
  const metadataSource = str(rawInput.metadataSource) || str(rawInput.suppliedProvider);
  const organization = [venue, publisher && publisher !== venue ? `(${publisher})` : ""].filter(Boolean).join(" ");

  return {
    id: rawInput.id || `paper-${Date.now()}`,
    title,
    domain: str(rawInput.domain),
    summary: summaryText,
    fullExplanation: str(rawInput.fullExplanation) || summaryText,
    authorId: str(rawInput.authorId),
    authorName: authors,
    authorRole: str(rawInput.authorRole),
    organization,
    originalLink: str(rawInput.originalLink) || str(rawInput.url),
    pdfUri: rawInput.pdfUri,
    tags: Array.isArray(rawInput.tags) ? rawInput.tags : [],
    readingTime: str(rawInput.readingTime),
    savedCount: typeof rawInput.savedCount === "number" ? rawInput.savedCount : 0,
    createdAt: rawInput.createdAt ? new Date(rawInput.createdAt) : new Date(),
    pubYear: typeof rawInput.pubYear === "number" ? rawInput.pubYear : undefined,
    doi: rawInput.doi,
    illustrations: rawInput.illustrations,
    venue,
    publisher,
    metadataSource,
    isPeerReviewed: rawInput.isPeerReviewed === true // only when the source said so
  };
}
