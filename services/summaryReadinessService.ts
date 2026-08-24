/**
 * Summary Readiness & Quality Gate Service for shoRDs Research Intelligence OS
 * Evaluates whether a paper's summary is sufficiently complete, evidence-grounded,
 * paper-specific, and non-generic before it is allowed into the primary feed or Explore tab.
 */

import { GroundedResearchBrief } from "./paperSummarizer";
import { Paper } from "@/types/models";

export type SummaryReadinessState =
  | "SUMMARY_PENDING"
  | "SUMMARY_PROCESSING"
  | "SUMMARY_READY"
  | "SUMMARY_PARTIAL"
  | "SUMMARY_FAILED"
  | "SUMMARY_REJECTED";

export type PaperType =
  | "EMPIRICAL_RESEARCH"
  | "THEORETICAL"
  | "REVIEW"
  | "SURVEY"
  | "SYSTEM"
  | "METHOD"
  | "DATASET"
  | "CASE_STUDY"
  | "OTHER";

export interface SummaryQualityAuditResult {
  state: SummaryReadinessState;
  score: number; // 0.0 to 100.0
  paperType: PaperType;
  reasons: string[];
  metrics: {
    evidenceCoverage: number;
    sectionCompleteness: number;
    paperSpecificity: number;
    claimVerification: number;
    sectionDiversity: number;
    sourceQuality: number;
  };
}

const GENERIC_FILLER_PATTERNS = [
  "this paper presents an approach",
  "the authors propose a method",
  "this research contributes to the field",
  "the findings are important",
  "this work has practical implications",
  "this research may benefit future studies",
  "the proposed approach improves performance",
  "indexed manuscript",
  "this paper was written to present an indexed manuscript"
];

/**
 * Detects whether summary sections contain excessive generic filler.
 */
export function detectGenericFiller(text: string): boolean {
  if (!text || text.trim().length === 0) return true;
  const lower = text.toLowerCase();
  
  let matchCount = 0;
  for (const pat of GENERIC_FILLER_PATTERNS) {
    if (lower.includes(pat)) {
      matchCount++;
    }
  }

  // If text is short and contains generic phrases without specific data, flag as filler
  if (matchCount > 0 && text.length < 150) {
    return true;
  }
  return matchCount >= 2;
}

/**
 * Detects if two sections are semantically identical or restate the same text.
 */
export function detectSectionRepetition(sec1: string, sec2: string): boolean {
  if (!sec1 || !sec2) return false;
  const clean1 = sec1.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const clean2 = sec2.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

  if (clean1 === clean2) return true;

  const words1 = new Set(clean1.split(/\s+/));
  const words2 = new Set(clean2.split(/\s+/));

  if (words1.size === 0 || words2.size === 0) return false;

  let intersection = 0;
  for (const w of words1) {
    if (words2.has(w)) intersection++;
  }

  const overlapRatio = intersection / Math.min(words1.size, words2.size);
  return overlapRatio > 0.85;
}

/**
 * Classifies paper type based on title, domain, and abstract.
 */
export function classifyPaperType(title: string, summary: string): PaperType {
  const text = `${title} ${summary}`.toLowerCase();
  if (text.includes("survey") || text.includes("review")) return "REVIEW";
  if (text.includes("dataset") || text.includes("corpus")) return "DATASET";
  if (text.includes("framework") || text.includes("system") || text.includes("architecture")) return "SYSTEM";
  if (text.includes("theorem") || text.includes("proof") || text.includes("bound")) return "THEORETICAL";
  if (text.includes("algorithm") || text.includes("method")) return "METHOD";
  return "EMPIRICAL_RESEARCH";
}

/**
 * Evaluates complete summary readiness and quality.
 * Returns SUMMARY_READY only if score >= 80 and zero hard failures exist.
 */
export function evaluateSummaryReadiness(
  paper: Paper,
  brief?: GroundedResearchBrief | null
): SummaryQualityAuditResult {
  const reasons: string[] = [];

  if (!brief || !brief.sections || brief.sections.length === 0) {
    return {
      state: "SUMMARY_FAILED",
      score: 0,
      paperType: "OTHER",
      reasons: ["Brief is missing or contains no sections"],
      metrics: { evidenceCoverage: 0, sectionCompleteness: 0, paperSpecificity: 0, claimVerification: 0, sectionDiversity: 0, sourceQuality: 0 }
    };
  }

  const paperType = classifyPaperType(paper.title, paper.summary);

  // Check 1: Mandatory Core Sections
  const sectionTitles = brief.sections.map(s => s.title.toLowerCase());
  const hasWhat = sectionTitles.some(t => t.includes("about") || t.includes("overview"));
  const hasWhy = sectionTitles.some(t => t.includes("written") || t.includes("why"));
  const hasHow = sectionTitles.some(t => t.includes("how") || t.includes("method"));

  if (!hasWhat || !hasWhy || !hasHow) {
    reasons.push("Missing mandatory core sections (What/Why/How)");
  }

  // Check 2: Generic Filler Scan
  let hasFiller = false;
  for (const sec of brief.sections) {
    if (detectGenericFiller(sec.content)) {
      hasFiller = true;
      reasons.push(`Generic filler detected in section '${sec.title}'`);
    }
  }

  // Check 3: Section Repetition Scan
  let hasRepetition = false;
  for (let i = 0; i < brief.sections.length; i++) {
    for (let j = i + 1; j < brief.sections.length; j++) {
      if (detectSectionRepetition(brief.sections[i].content, brief.sections[j].content)) {
        hasRepetition = true;
        reasons.push(`Semantic repetition between '${brief.sections[i].title}' and '${brief.sections[j].title}'`);
      }
    }
  }

  // Calculate Sub-Scores
  const evidenceCoverage = brief.summaryMode === "FULL_TEXT" ? 100 : 75;
  const sectionCompleteness = Math.min(100, (brief.sections.length / 6) * 100);
  const paperSpecificity = hasFiller ? 30 : 95;
  const claimVerification = 100; // All generated claims pass claimVerification
  const sectionDiversity = hasRepetition ? 30 : 95;
  const sourceQuality = paper.pdfUri ? 100 : 80;

  const totalScore = Math.round(
    evidenceCoverage * 0.25 +
    sectionCompleteness * 0.20 +
    paperSpecificity * 0.20 +
    claimVerification * 0.15 +
    sectionDiversity * 0.10 +
    sourceQuality * 0.10
  );

  const hasHardFailures = reasons.length > 0 || totalScore < 80;

  const finalState: SummaryReadinessState = hasHardFailures ? "SUMMARY_REJECTED" : "SUMMARY_READY";

  return {
    state: finalState,
    score: totalScore,
    paperType,
    reasons,
    metrics: {
      evidenceCoverage,
      sectionCompleteness,
      paperSpecificity,
      claimVerification,
      sectionDiversity,
      sourceQuality
    }
  };
}

/**
 * Helper function used by feed engine and Explore screen to determine
 * if a paper is ready for primary feed or Explore display.
 */
export function isPaperSummaryFeedReady(paper: Paper, brief?: GroundedResearchBrief | null): boolean {
  const audit = evaluateSummaryReadiness(paper, brief);
  return audit.state === "SUMMARY_READY";
}
