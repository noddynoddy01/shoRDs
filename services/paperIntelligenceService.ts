import { EvidenceChunk } from "./evidenceChunkingService";
import { ExtractedDocument } from "./documentExtractionService";
import {
  ContentCoverageType,
  IntelligenceConfidence,
  Paper,
  PaperIntelligence,
  PaperQuantitativeResult
} from "@/types/models";
import { parsePaperSections } from "./papersStore";

export interface StructuredPaperField {
  value: string;
  chunkIds: string[];
}

export interface StructuredPaper {
  paperId: string;
  title: string;
  authors: string[];
  researchQuestion?: StructuredPaperField;
  motivation?: StructuredPaperField;
  researchGap?: StructuredPaperField;

  methodology?: StructuredPaperField;
  dataset?: StructuredPaperField;
  experimentalSetup?: StructuredPaperField;

  keyFindings: StructuredPaperField[];
  quantitativeResults: StructuredPaperField[];

  limitations: StructuredPaperField[];
  applications: StructuredPaperField[];
  futureWork?: StructuredPaperField;

  conclusion?: StructuredPaperField;

  evidenceMap: Array<{ field: string; chunkIds: string[] }>;
}

/**
 * Builds structured paper intelligence mapping populated fields to explicit evidence chunks.
 * Unevidenced fields remain empty (undefined), never filled with AI guesses!
 */
export function buildStructuredPaperIntelligence(doc: ExtractedDocument, chunks: EvidenceChunk[]): StructuredPaper {
  const findChunksForSection = (secName: string): EvidenceChunk[] => {
    return chunks.filter(c => c.section === secName);
  };

  const introChunks = [...findChunksForSection("INTRODUCTION"), ...findChunksForSection("BACKGROUND")];
  const absChunks = findChunksForSection("ABSTRACT");
  const methodChunks = findChunksForSection("METHODOLOGY");
  const resultChunks = [...findChunksForSection("RESULTS"), ...findChunksForSection("TABLE"), ...findChunksForSection("FIGURE")];
  const limChunks = findChunksForSection("LIMITATIONS");
  const futureChunks = findChunksForSection("FUTURE_WORK");

  const evidenceMap: Array<{ field: string; chunkIds: string[] }> = [];

  // Populate Research Question / Motivation if Introduction or Abstract chunks exist
  let motivation: StructuredPaperField | undefined;
  if (introChunks.length > 0) {
    motivation = { value: introChunks[0].text, chunkIds: [introChunks[0].chunkId] };
    evidenceMap.push({ field: "motivation", chunkIds: [introChunks[0].chunkId] });
  } else if (absChunks.length > 0) {
    motivation = { value: absChunks[0].text, chunkIds: [absChunks[0].chunkId] };
    evidenceMap.push({ field: "motivation", chunkIds: [absChunks[0].chunkId] });
  }

  // Populate Methodology if Method chunks exist
  let methodology: StructuredPaperField | undefined;
  if (methodChunks.length > 0) {
    methodology = { value: methodChunks[0].text, chunkIds: [methodChunks[0].chunkId] };
    evidenceMap.push({ field: "methodology", chunkIds: [methodChunks[0].chunkId] });
  }

  // Populate Quantitative Results & Key Findings if Result/Table chunks exist
  const keyFindings: StructuredPaperField[] = [];
  const quantitativeResults: StructuredPaperField[] = [];

  for (const rc of resultChunks.slice(0, 4)) {
    keyFindings.push({ value: rc.text, chunkIds: [rc.chunkId] });
    if (rc.text.includes("%") || rc.text.includes("accuracy") || rc.text.includes("Table") || rc.text.includes("reduction") || rc.text.includes("AUROC")) {
      quantitativeResults.push({ value: rc.text, chunkIds: [rc.chunkId] });
    }
  }

  // Populate Explicit Limitations only if Limitations chunks exist
  const limitations: StructuredPaperField[] = [];
  if (limChunks.length > 0) {
    limChunks.forEach(lc => {
      limitations.push({ value: lc.text, chunkIds: [lc.chunkId] });
    });
  }

  // Populate Future Work only if Future Work chunks exist
  let futureWork: StructuredPaperField | undefined;
  if (futureChunks.length > 0) {
    futureWork = { value: futureChunks[0].text, chunkIds: [futureChunks[0].chunkId] };
  }

  return {
    paperId: doc.paperId,
    title: doc.title,
    authors: doc.authors,
    motivation,
    methodology,
    keyFindings,
    quantitativeResults,
    limitations,
    applications: [],
    futureWork,
    evidenceMap
  };
}

/**
 * Extracts quantitative metrics, improvements, and baseline comparisons from paper text and insights.
 */
function extractQuantitativeResultsFromText(text: string, insights: string[] = []): PaperQuantitativeResult[] {
  const results: PaperQuantitativeResult[] = [];
  const sources = [...insights, ...text.split(/[.\n;]+/)].map(s => s.trim()).filter(Boolean);

  for (const s of sources) {
    // 1. Percentage reduction / improvement with explicit baseline comparison
    // e.g. "AlphaQubit achieves a 30% reduction in logical error rates compared to MWPM decoders."
    const compMatch = s.match(/(\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?[xX]\b)\s*([a-zA-Z\s]+?)\s*(?:compared to|versus|vs\.?|over)\s*([a-zA-Z0-9\s\-–—]+)/i);
    if (compMatch) {
      results.push({
        metric: compMatch[2].trim(),
        value: compMatch[1].trim(),
        baselineValue: compMatch[3].trim(),
        improvement: `${compMatch[1].trim()} ${compMatch[2].trim()}`,
        context: s,
        evidenceReference: s
      });
      continue;
    }

    // 2. Specific rates/fractions e.g. "sensitivity rates above 95%" or "reducing peak local pressures by over 80%"
    const rateMatch = s.match(/(?:(?:achieves?|shows?|demonstrates?|reducing|with)\s+)?([a-zA-Z\s]{3,35}?)\s*(?:of|above|by|at|rates?)\s*(?:over\s+|above\s+)?(\d+(?:\.\d+)?%|\d+(?:\.\d+)?[xX])/i);
    if (rateMatch && rateMatch[1].length < 40 && !rateMatch[1].toLowerCase().includes("study")) {
      results.push({
        metric: rateMatch[1].trim(),
        value: rateMatch[2].trim(),
        improvement: `${rateMatch[1].trim()}: ${rateMatch[2].trim()}`,
        context: s,
        evidenceReference: s
      });
      continue;
    }

    // 3. Time or efficiency gains e.g. "reducing diagnostic review times by 40%"
    const timeMatch = s.match(/reducing\s+([a-zA-Z\s]{3,30}?)\s+by\s+(\d+(?:\.\d+)?%)/i);
    if (timeMatch) {
      results.push({
        metric: timeMatch[1].trim(),
        value: timeMatch[2].trim(),
        improvement: `-${timeMatch[2].trim()} ${timeMatch[1].trim()}`,
        context: s,
        evidenceReference: s
      });
      continue;
    }

    // 4. Metric with known unit (AUROC, accuracy, error rate)
    const unitMatch = s.match(/(\b\d+(?:\.\d+)?\s*(?:%|AUROC|F1|dB|ms|μs|ns)\b)/i);
    if (unitMatch && (s.toLowerCase().includes("accuracy") || s.toLowerCase().includes("error") || s.toLowerCase().includes("reduc") || s.toLowerCase().includes("gain") || s.toLowerCase().includes("outperform"))) {
      results.push({
        metric: "Empirical Performance",
        value: unitMatch[1].trim(),
        context: s,
        evidenceReference: s
      });
    }
  }

  // Deduplicate results
  const unique: PaperQuantitativeResult[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    const key = `${r.value}:${r.metric.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }

  return unique.slice(0, 4);
}

/**
 * Paper Intelligence Generator (on-device, heuristic).
 * Everything returned is either the paper's own text or empty. It never writes statements about the paper that its text does not
 * contain: no "why it matters", no domain-based cautions, no "validated performance", no filler sentences. Fields the text
 * does not support are empty strings / empty arrays, and the screens omit them.
 */
export function generatePaperIntelligence(
  paper: Paper | any,
  doc?: ExtractedDocument,
  chunks?: EvidenceChunk[]
): PaperIntelligence {
  const paperId = paper.id;
  const title = (paper.title || "Untitled Paper").replace(/\.pdf$/i, "").replace(/[:.,;\-–—]$/, "").trim();
  const domain = paper.domain || "General Science";
  const rawText = (paper.fullTextRaw || paper.fullExplanation || paper.summary || title).trim();
  const insights: string[] = paper.insights || [];

  // Determine coverage
  let contentCoverage: ContentCoverageType = "METADATA_ONLY";
  if (paper.fullTextRaw || paper.fullTextStatus === "FULL_TEXT_PDF") {
    contentCoverage = "FULL_TEXT";
  } else if (paper.summary && paper.summary.length > 30) {
    contentCoverage = "ABSTRACT_ONLY";
  }

  // Determine confidence
  let confidence: IntelligenceConfidence = "LIMITED";
  let confidenceReason = "Limited to publication indexing metadata and bibliographic record.";
  if (contentCoverage === "FULL_TEXT") {
    confidence = "HIGH";
    confidenceReason = "Based on the full text supplied with the record. The sections are extracted by rules on this device and have not been independently checked.";
  } else if (contentCoverage === "ABSTRACT_ONLY") {
    confidence = "MEDIUM";
    confidenceReason = "Based on the abstract only; methods and results beyond the abstract are not covered.";
  }

  // Parse 4 core sections
  const parsed = parsePaperSections(paper, title, paper.summary, domain);

  // TL;DR: the first sentences of the paper's own abstract/summary, verbatim. No template wording is added.
  const leadText = (paper.summary || parsed.context || "").trim();
  const tldr = (leadText.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [leadText]).slice(0, 3).join(" ").trim();

  // Research problem: only text the paper itself provides for its background/abstract.
  const researchProblem = parsed.context || "";
  const motivation = "";

  // Key contributions: only contributions the record itself lists.
  const keyContributions: string[] = [...insights];

  // Quantitative Results
  const quantitativeResults = extractQuantitativeResultsFromText(rawText, insights);

  // Key Findings
  const keyFindings: string[] = [];
  if (insights.length > 1) {
    keyFindings.push(...insights.slice(1));
  }
  if (parsed.results) {
    const rSentences = parsed.results.split(/\.\s+/).map(s => s.trim()).filter(s => s.length > 15);
    for (const rs of rSentences) {
      if (!keyFindings.some(kf => kf.includes(rs.slice(0, 20)))) {
        keyFindings.push(rs.endsWith(".") ? rs : `${rs}.`);
      }
    }
  }

  // Limitations
  const authorStated: string[] = [];
  const limitSentences = rawText.match(/[^.!?]+(?:limitation|limited to|drawback|requires additional|fails when|degrades when)[^.!?]+[.!?]/gi);
  if (limitSentences && limitSentences.length > 0) {
    limitSentences.slice(0, 2).forEach((s: string) => authorStated.push(s.trim()));
  }

  // Limitations: only sentences in the paper's text that state one. No generic or domain-based cautions are added.
  const whyItMatters = "";
  const practicalImplications: string[] = [];

  // Methodology breakdown: the paper's own method text; nothing assumed about setup or benchmarks.
  const methodology = {
    overview: parsed.methodology || "",
    approach: undefined as string | undefined,
    techniques: paper.tags && paper.tags.length > 0 ? paper.tags : [],
    experimentalSetup: undefined as string | undefined
  };

  // Evidence references
  const evidenceList: Array<{ claimText: string; section: string; page?: number; chunkId: string; verified: boolean }> = [];
  if (chunks && chunks.length > 0) {
    chunks.slice(0, 5).forEach((c, idx) => {
      evidenceList.push({
        claimText: c.text.slice(0, 120) + (c.text.length > 120 ? "..." : ""),
        section: c.section,
        page: c.page || 1,
        chunkId: c.chunkId,
        verified: false // on-device chunks are listed as source passages; nothing here has been independently verified
      });
    });
  }

  // Reading Metrics
  const words = rawText.split(/\s+/).filter(Boolean).length;
  const readingMetrics = {
    wordCount: words,
    estimatedReadingMinutes: Math.max(2, Math.ceil(words / 220)),
    technicalTermDensity: Math.min(100, Math.round((rawText.match(/neural|transformer|quantum|algorithm|optimization|accuracy|latency|error/gi) || []).length * 10))
  };

  return {
    paperId,
    intelligenceVersion: "2026.2",
    contentCoverage,
    confidence,
    confidenceReason,
    tldr,
    researchProblem,
    motivation,
    keyContributions,
    methodology,
    keyFindings,
    quantitativeResults,
    strengths: [],
    limitations: {
      authorStated: authorStated.length > 0 ? authorStated : undefined,
      analyticalCautions: []
    },
    whyItMatters,
    practicalImplications,
    futureWork: parsed.futureScope ? [parsed.futureScope] : [],
    keywords: paper.tags || [],
    evidence: evidenceList,
    readingMetrics
  };
}

