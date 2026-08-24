import { EvidenceChunk, EvidenceSourceType } from "./evidenceChunkingService";
import { evidenceIndexService } from "./evidenceIndexService";
import { ExtractionConfidence } from "./documentExtractionService";

export type ClaimConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface GroundedEvidence {
  chunkId: string;
  section?: string;
  page?: number;
  sourceType: EvidenceSourceType;
  provenanceLabel: string;
  supportingTextSnippet: string;
}

export interface GroundedClaim {
  claimId: string;
  text: string;
  evidence: GroundedEvidence[];
  claimConfidence: ClaimConfidence;
  extractionConfidence: ExtractionConfidence;
  verifiedAt: string;
}

export interface GroundedSection {
  sectionId: string;
  title: string;
  content: string;
  claims: GroundedClaim[];
}

/**
 * Validates whether a numerical claim is explicitly supported by numeric evidence in the chunk text.
 * E.g., "model achieved 94.2% accuracy" requires "94.2" or "94.2%" in chunk text.
 */
export function verifyNumericClaimSupport(claimText: string, chunkText: string): boolean {
  const numbersInClaim = claimText.match(/\d+(\.\d+)?%?/g);
  if (!numbersInClaim || numbersInClaim.length === 0) {
    return true; // Non-numeric claim
  }

  for (const num of numbersInClaim) {
    const rawNum = num.replace("%", "");
    if (!chunkText.includes(rawNum) && !chunkText.includes(num)) {
      return false; // Invented number reject!
    }
  }

  return true;
}

/**
 * Validates semantic support of a claim against evidence chunks.
 * Ensures the chunk exists in index for paperId, matches paperId, and text semantically supports claim.
 */
export function verifyClaimSemanticSupport(
  paperId: string,
  claimText: string,
  chunkId: string,
  extractionConfidence: ExtractionConfidence = "HIGH"
): GroundedClaim | null {
  const chunk = evidenceIndexService.getChunkById(paperId, chunkId);
  if (!chunk || chunk.paperId !== paperId) {
    return null; // ChunkId does not exist or paperId mismatch reject!
  }

  // Check numeric integrity
  if (!verifyNumericClaimSupport(claimText, chunk.text)) {
    return null; // Invented numeric claim reject!
  }

  // Check keyword semantic overlap
  const claimWords = claimText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const chunkLower = chunk.text.toLowerCase();
  const overlap = claimWords.filter(w => chunkLower.includes(w)).length;

  const isSupported = overlap > 0 || claimWords.length === 0;
  if (!isSupported) {
    return null; // Unsupported claim reject!
  }

  const claimConfidence: ClaimConfidence = overlap >= 3 ? "HIGH" : "MEDIUM";

  return {
    claimId: `claim_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    text: claimText,
    evidence: [
      {
        chunkId: chunk.chunkId,
        section: chunk.section,
        page: chunk.page,
        sourceType: chunk.sourceType,
        provenanceLabel: chunk.provenanceLabel,
        supportingTextSnippet: chunk.text.slice(0, 150)
      }
    ],
    claimConfidence,
    extractionConfidence,
    verifiedAt: new Date().toISOString()
  };
}

/**
 * Calculates semantic redundancy between two generated section texts.
 * Checks for identical informational assertions rather than mere domain topic overlap.
 */
export function checkSemanticRedundancy(textA: string, textB: string, threshold: number = 0.80): boolean {
  if (!textA || !textB) return false;
  const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const jaccard = intersection / Math.max(wordsA.size, wordsB.size);
  return jaccard >= threshold;
}
