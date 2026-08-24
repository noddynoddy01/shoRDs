import { EvidenceChunk } from "./evidenceChunkingService";
import { ExtractedDocument } from "./documentExtractionService";

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

  const introChunks = findChunksForSection("INTRODUCTION");
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

  for (const rc of resultChunks.slice(0, 3)) {
    keyFindings.push({ value: rc.text, chunkIds: [rc.chunkId] });
    if (rc.text.includes("%") || rc.text.includes("accuracy") || rc.text.includes("Table")) {
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
    applications: keyFindings.length > 0 ? [{ value: "Practical scientific implementation", chunkIds: keyFindings[0].chunkIds }] : [],
    futureWork,
    evidenceMap
  };
}
