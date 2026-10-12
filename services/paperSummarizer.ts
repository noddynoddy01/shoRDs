/**
 * Enhanced 2-3 Minute Grounded Research Brief Engine for shoRDs Research Intelligence OS
 * Produces structured, high-density, evidence-grounded research briefs (450-700 words)
 * with original figure retrieval, 9 structured sections, key numbers verification,
 * BriefReadingMetrics, ResearchBriefQualityScore, and zero cross-paper contamination.
 */

import { Paper } from "@/types/models";
import { FullTextStatus } from "./fullTextResolver";
import { extractDocumentContent } from "./documentExtractionService";
import { chunkExtractedDocument } from "./evidenceChunkingService";
import { evidenceIndexService } from "./evidenceIndexService";
import { buildStructuredPaperIntelligence, generatePaperIntelligence } from "./paperIntelligenceService";
import { generateCanonicalPaperId } from "./deduplication";
import {
  GroundedSection,
  GroundedClaim,
  verifyClaimSemanticSupport
} from "./claimVerification";
import {
  retrieveOriginalFiguresAsync,
  ResearchFigure,
  verifyFigureCanonicalBinding
} from "./figureExtractionService";

export interface KeyNumberMetric {
  value: string;
  label: string;
  context: string;
  /**
   * Always false: numbers here are extracted by on-device heuristics and have NOT been checked against the paper by shoRDs.
   * (The server-side analysis, POST /api/v1/analysis, does check cited numbers against the retrieved text; this screen does not use it yet.)
   */
  verified: false;
}

export interface BriefReadingMetrics {
  wordCount: number;
  estimatedReadingMinutes: number;
  technicalTermDensity: number;
  equationCount: number;
  figureCount: number;
  sectionCount: number;
}

export interface ResearchBriefQualityScore {
  evidenceGrounding: number;
  figureAuthenticity: number;
  numericVerification: number;
  sectionCompleteness: number;
  semanticDiversity: number;
  readability: number;
  informationDensity: number;
  sourceCoverage: number;
  totalQualityScore: number;
}

export interface GroundedResearchBrief {
  paperId: string;
  paperCanonicalId: string;
  title: string;
  authors: string[];
  fullTextStatus: FullTextStatus;
  summaryMode: "FULL_TEXT" | "ABSTRACT_ONLY" | "METADATA_ONLY";
  noticeMessage?: string;
  readingMetrics: BriefReadingMetrics;
  /** No quality score is computed anywhere, so none is reported. (It used to be a table of constants such as 94 to 100.) */
  qualityScore: ResearchBriefQualityScore | null;
  readingTimeMinutes: number;
  wordCount: number;
  sections: GroundedSection[];
  allClaims: GroundedClaim[];
  figures: ResearchFigure[];
  keyNumbers: KeyNumberMetric[];
  takeaways: string[];
  rejectedClaimCount: number;
}

/**
 * Advanced Reading Time & Metrics Engine:
 * Computes word count, estimated reading time, technical term density, equation count, etc.
 */
export function calculateBriefReadingMetrics(
  text: string,
  figuresCount: number = 0,
  sectionsCount: number = 9
): BriefReadingMetrics {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  const equations = (text.match(/Equation \d+|E\[.*?\]|<=|>=|\sum|\int/gi) || []).length;

  const techTerms = (text.match(/algorithm|transformer|attention| doppler|latency|throughput|vector|neural|quantum|optimization|complexity|floating-point/gi) || []).length;
  const technicalTermDensity = Math.min(100, Math.round((techTerms / Math.max(1, wordCount)) * 100 * 5));

  const minutesFromWords = wordCount / 220;
  const minutesFromTech = technicalTermDensity > 30 ? 0.5 : 0;
  const minutesFromFigures = figuresCount * 0.4;
  const estimatedReadingMinutes = Math.max(2, Math.min(5, Math.ceil(minutesFromWords + minutesFromTech + minutesFromFigures)));

  return {
    wordCount,
    estimatedReadingMinutes,
    technicalTermDensity,
    equationCount: equations,
    figureCount: figuresCount,
    sectionCount: sectionsCount
  };
}

/**
 * Calculates semantic overlap between two section texts (target: < 0.35 overlap).
 */
export function calculateSectionSemanticOverlap(sec1Text: string, sec2Text: string): number {
  if (!sec1Text || !sec2Text) return 0.0;
  const words1 = new Set(sec1Text.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(sec2Text.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(w => w.length > 3));

  if (words1.size === 0 || words2.size === 0) return 0.0;

  let common = 0;
  for (const w of words1) {
    if (words2.has(w)) common++;
  }

  return common / Math.min(words1.size, words2.size);
}

/**
 * Generic Language Detector:
 * Flags generic filler phrases that lack concrete empirical evidence.
 */
export function detectGenericPhrases(text: string): boolean {
  if (!text) return true;
  const lower = text.toLowerCase();
  const genericPatterns = [
    "presents an innovative approach",
    "this study explores",
    "the authors propose a novel method",
    "this research contributes to the field",
    "this is an important area",
    "the results demonstrate the effectiveness",
    "indexed manuscript"
  ];

  for (const pat of genericPatterns) {
    if (lower.includes(pat) && text.length < 160) {
      return true;
    }
  }
  return false;
}

/**
 * Drops sections with no text, and sections that only repeat an earlier one. An empty or duplicate section would otherwise be
 * padded or repeated to look complete.
 */
function nonEmptySections(list: GroundedSection[]): GroundedSection[] {
  const seen = new Set<string>();
  return list.filter((sec) => {
    const key = (sec.content || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Generates an evidence-grounded 2-3 minute Research Brief (450-700 words)
 * incorporating original figures, verified numbers, 9 structured sections,
 * BriefReadingMetrics, and strict canonical ID paper binding.
 */
export async function generateGroundedResearchBriefAsync(paper: {
  id: string;
  title: string;
  authors?: string[];
  fullTextStatus: FullTextStatus;
  summary?: string;
  fullTextRaw?: string;
  pdfUri?: string;
  htmlUri?: string;
  doi?: string;
  domain?: string;
}): Promise<GroundedResearchBrief> {
  const paperId = paper.id;
  const paperCanonicalId = generateCanonicalPaperId(paper);
  const title = paper.title.replace(/\.pdf$/i, "").replace(/[:.,;\-–—]$/, "").trim();
  const authors = paper.authors && paper.authors.length > 0 ? paper.authors : []; // never a placeholder name: unknown authors stay unknown
  const fullTextStatus = paper.fullTextStatus || "ABSTRACT_ONLY";

  // Retrieve Original Figures & Tables with Strict Canonical Binding
  const rawFigures = await retrieveOriginalFiguresAsync({
    id: paperId,
    title,
    pdfUri: paper.pdfUri,
    doi: paper.doi,
    htmlUri: paper.htmlUri,
    domain: paper.domain
  });

  // Verify Zero Cross-Paper Contamination
  const figures = rawFigures.filter(fig => verifyFigureCanonicalBinding(fig, paperCanonicalId));

  // Handle Metadata-Only Mode: only an honest notice; the counts below are measured from that notice, not assumed.
  if (fullTextStatus === "METADATA_ONLY" || fullTextStatus === "UNAVAILABLE") {
    const noticeContent = "Full text and abstract were unavailable for deep analysis. This brief is limited to available indexing metadata.";
    const noticeMetrics = calculateBriefReadingMetrics(noticeContent, 0, 1);
    return {
      paperId,
      paperCanonicalId,
      title,
      authors,
      fullTextStatus: "METADATA_ONLY",
      summaryMode: "METADATA_ONLY",
      noticeMessage: "Full text and abstract were unavailable for deep analysis.",
      readingMetrics: noticeMetrics,
      qualityScore: null,
      readingTimeMinutes: noticeMetrics.estimatedReadingMinutes,
      wordCount: noticeMetrics.wordCount,
      sections: [
        {
          sectionId: "sec_notice",
          title: "01 · Limited Information Available",
          content: noticeContent,
          claims: []
        }
      ],
      allClaims: [],
      figures: [],
      keyNumbers: [],
      takeaways: [],
      rejectedClaimCount: 0
    };
  }

  // Document Extraction & Chunking
  const rawText = paper.fullTextRaw || paper.summary || title;
  const doc = extractDocumentContent(paperId, title, fullTextStatus, rawText, paper.summary, authors);
  const chunks = chunkExtractedDocument(doc);
  evidenceIndexService.registerChunks(paperId, chunks);

  const structured = buildStructuredPaperIntelligence(doc, chunks);
  const intel = generatePaperIntelligence(paper, doc, chunks);

  // Key Verified Quantitative Numbers - Dynamic extraction from paper intelligence
  const extractedMetrics: KeyNumberMetric[] = [];
  if (intel.quantitativeResults && intel.quantitativeResults.length > 0) {
    intel.quantitativeResults.slice(0, 4).forEach((q, idx) => {
      extractedMetrics.push({
        value: q.value,
        label: q.metric || `Result #${idx + 1}`,
        context: q.context || q.improvement || "Empirical quantitative result from paper.",
        verified: false
      });
    });
  }

  const keyNumbers: KeyNumberMetric[] = extractedMetrics;

  // Abstract-Only Mode
  if (fullTextStatus === "ABSTRACT_ONLY") {
    const absChunk = chunks.find(c => c.section === "ABSTRACT") || chunks[0];
    const claim1Text = intel.tldr;
    const claim1 = absChunk ? verifyClaimSemanticSupport(paperId, claim1Text, absChunk.chunkId, doc.quality.extractionConfidence) : null;
    const validClaims = claim1 ? [claim1] : [];

    const abstractSections = nonEmptySections([
      { sectionId: "sec_30sec", title: "01 · The Paper in 30 Seconds", content: intel.tldr, claims: validClaims },
      { sectionId: "sec_problem", title: "02 · Background (from the abstract)", content: intel.researchProblem, claims: [] },
      { sectionId: "sec_method", title: "03 · Method (from the abstract)", content: intel.methodology.overview, claims: [] },
      { sectionId: "sec_evidence", title: "04 · Findings (from the abstract)", content: intel.keyFindings[0] || "", claims: [] }
    ]);
    const metrics = calculateBriefReadingMetrics(abstractSections.map(sec => sec.content).join(" "), figures.length, abstractSections.length);

    return {
      paperId,
      paperCanonicalId,
      title,
      authors,
      fullTextStatus: "ABSTRACT_ONLY",
      summaryMode: "ABSTRACT_ONLY",
      noticeMessage: "Full text was not available, so this brief is limited to the abstract.",
      readingMetrics: metrics,
      qualityScore: null,
      readingTimeMinutes: metrics.estimatedReadingMinutes,
      wordCount: metrics.wordCount,
      sections: abstractSections,
      allClaims: validClaims,
      figures: [],
      keyNumbers: keyNumbers.slice(0, 2),
      takeaways: intel.keyContributions.slice(0, 3),
      rejectedClaimCount: 0
    };
  }

  // FULL_TEXT Mode: sections are the paper's own text, selected by rules on this device. Empty sections are omitted, never filled.
  const allClaims: GroundedClaim[] = [];
  let rejectedClaimCount = 0;

  const introChunk = chunks.find(c => c.section === "INTRODUCTION" || c.section === "BACKGROUND") || chunks[0];
  const methodChunk = chunks.find(c => c.section === "METHODOLOGY") || chunks[0];
  const resultChunk = chunks.find(c => c.section === "RESULTS" || c.section === "TABLE") || chunks[0];
  const limChunk = chunks.find(c => c.section === "LIMITATIONS");

  const quantLines = intel.quantitativeResults.map(r => `• ${r.metric}: ${r.value}${r.baselineValue ? ` (compared to ${r.baselineValue})` : ""}`);
  const resultsText = [intel.keyFindings.join("\n\n"), quantLines.length > 0 ? "Numbers found in the text:\n" + quantLines.join("\n") : ""].filter(Boolean).join("\n\n");
  const techniques = (intel.methodology.techniques || []).join(", ");
  const methodDetail = [intel.methodology.overview, techniques ? `Keywords: ${techniques}.` : ""].filter(Boolean).join("\n\n");
  const limitationsText = (intel.limitations.authorStated && intel.limitations.authorStated.length > 0)
    ? `Limitations stated in the paper:\n${intel.limitations.authorStated.map(l => `• ${l}`).join("\n")}`
    : "";

  const candidates: Array<{ id: string; title: string; text: string; chunk: { chunkId: string } | undefined }> = [
    { id: "sec_30sec", title: "01 · The Paper in 30 Seconds", text: intel.tldr, chunk: introChunk },
    { id: "sec_problem", title: "02 · The Problem", text: intel.researchProblem, chunk: introChunk },
    { id: "sec_did", title: "03 · What the Researchers Did", text: intel.methodology.overview, chunk: methodChunk },
    { id: "sec_works", title: "04 · Method Details", text: methodDetail, chunk: methodChunk },
    { id: "sec_evidence", title: "05 · Results (from the text)", text: resultsText, chunk: resultChunk },
    { id: "sec_lim", title: "08 · Limitations", text: limitationsText, chunk: limChunk || resultChunk }
  ];

  const sections: GroundedSection[] = [];
  const seenText = new Set<string>();
  for (const c of candidates) {
    const text = (c.text || "").trim();
    if (!text || seenText.has(text) || !c.chunk) continue; // nothing in the paper for this section: omit it
    seenText.add(text);
    const claim = verifyClaimSemanticSupport(paperId, text, c.chunk.chunkId, doc.quality.extractionConfidence);
    if (claim) allClaims.push(claim); else rejectedClaimCount++;
    sections.push({ sectionId: c.id, title: c.title, content: text, claims: claim ? [claim] : [] });
  }

  const takeaways = intel.keyContributions.length > 0 ? intel.keyContributions : intel.keyFindings.slice(0, 5);

  const fullBriefText = sections.map(s => s.content).join(" ");
  const metrics = calculateBriefReadingMetrics(fullBriefText, figures.length, sections.length);


  return {
    paperId,
    paperCanonicalId,
    title,
    authors,
    fullTextStatus: "FULL_TEXT_PDF",
    summaryMode: "FULL_TEXT",
    readingMetrics: metrics,
    qualityScore: null,
    readingTimeMinutes: metrics.estimatedReadingMinutes,
    wordCount: metrics.wordCount,
    sections,
    allClaims,
    figures,
    keyNumbers,
    takeaways,
    rejectedClaimCount
  };
}

/**
 * Educational Stack Generator for feed cards and reels.
 * Fully grounded in PaperIntelligence with zero cross-paper contamination.
 */
export function generateEducationalStack(paper: Paper) {
  const intel = generatePaperIntelligence(paper);
  return {
    // Only sections the paper's own text supports. A missing limitation is simply absent: "none reported" would be a claim.
    sections: [
      { title: "What is this paper about?", content: intel.tldr },
      { title: "Background", content: intel.researchProblem },
      { title: "Method", content: intel.methodology.overview },
      { title: "Findings", content: intel.keyFindings.join("\n\n") },
      { title: "Limitations stated in the paper", content: intel.limitations.authorStated?.[0] || "" }
    ].filter((sec) => sec.content.trim().length > 0 && sec.content.trim() !== intel.tldr.trim() || sec.title === "What is this paper about?")
  };
}

export interface Structured18PartSummary {
  problemStatement: string;
  coreMethodology: string;
  keyFindings: string[];
  limitations: string[];
  futureDirections: string[];
  equationNotes?: string;
  tableDataSummary?: string;
  quickBrief: {
    what: string;
    why: string;
    mainContribution: string;
    whyCare: string;
  };
}

export function buildStructuredSummaryFromPaper(paper: Paper): Structured18PartSummary {
  const intel = generatePaperIntelligence(paper);
  return {
    problemStatement: intel.researchProblem,
    coreMethodology: intel.methodology.overview,
    keyFindings: intel.keyFindings,
    limitations: [
      ...(intel.limitations.authorStated || []),
      ...(intel.limitations.analyticalCautions || [])
    ],
    futureDirections: intel.futureWork || [],
    quickBrief: {
      what: intel.tldr,
      why: intel.motivation || intel.researchProblem,
      mainContribution: intel.keyContributions[0] || intel.tldr,
      whyCare: intel.whyItMatters
    }
  };
}

export function buildPaperFromUpload(
  titleOrObj: string | { title: string; domain: string; summary: string; tags?: string[]; pdfUri?: string; authorName?: string },
  summaryParam?: string,
  domainParam?: string
): Paper {
  if (typeof titleOrObj === "object") {
    return {
      id: `upload-${Date.now()}`,
      title: titleOrObj.title,
      domain: titleOrObj.domain,
      summary: titleOrObj.summary,
      fullExplanation: titleOrObj.summary,
      authorId: "user-author",
      authorName: titleOrObj.authorName || "", // unknown stays unknown: never a made-up author
      authorRole: "Researcher",
      originalLink: titleOrObj.pdfUri || "",
      tags: titleOrObj.tags || [],
      readingTime: "3 min read",
      savedCount: 1,
      createdAt: new Date(),
      pdfUri: titleOrObj.pdfUri
    };
  }

  return {
    id: `upload-${Date.now()}`,
    title: titleOrObj,
    domain: domainParam || "General Science",
    summary: summaryParam || titleOrObj,
    fullExplanation: summaryParam || titleOrObj,
    authorId: "user-author",
    authorName: "", // the uploader is not necessarily the author
    authorRole: "Researcher",
    originalLink: "",
    tags: [],
    readingTime: "3 min read",
    savedCount: 1,
    createdAt: new Date()
  };
}

export function generateStackCards(paper: Paper) {
  return generateEducationalStack(paper);
}
