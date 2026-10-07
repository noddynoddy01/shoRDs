import { FullTextStatus } from "./fullTextResolver";

export type PaperEligibility =
  | "FULL_ANALYSIS"
  | "ABSTRACT_ANALYSIS"
  | "METADATA_ONLY"
  | "REJECTED";

/**
 * Hard Paper Eligibility Gate:
 * FULL_TEXT_PDF / FULL_TEXT_HTML -> FULL_ANALYSIS (Eligible for main feed)
 * ABSTRACT_ONLY -> ABSTRACT_ANALYSIS (Eligible for main feed with abstract badge)
 * METADATA_ONLY -> METADATA_ONLY (NOT ELIGIBLE FOR MAIN FEED)
 * UNAVAILABLE -> REJECTED (NEVER SHOW)
 */
export function determinePaperEligibility(fullTextStatus: FullTextStatus): PaperEligibility {
  switch (fullTextStatus) {
    case "FULL_TEXT_PDF":
    case "FULL_TEXT_HTML":
      return "FULL_ANALYSIS";
    case "ABSTRACT_ONLY":
      return "ABSTRACT_ANALYSIS";
    case "METADATA_ONLY":
      return "METADATA_ONLY";
    case "UNAVAILABLE":
    default:
      return "REJECTED";
  }
}
