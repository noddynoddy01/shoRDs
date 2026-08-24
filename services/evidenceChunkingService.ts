import { StandardScholarlySection, normalizeScholarlySectionName } from "./sectionExtractionService";
import { ExtractedDocument } from "./documentExtractionService";

export type EvidenceSourceType = "PDF" | "HTML" | "ABSTRACT" | "TABLE" | "FIGURE";

export interface EvidenceChunk {
  chunkId: string;
  paperId: string;
  text: string;
  section: StandardScholarlySection;
  page?: number;
  paragraphIndex?: number;
  sourceType: EvidenceSourceType;
  provenanceLabel: string;
}

/**
 * Chunks extracted document into structured EvidenceChunks preserving sentence,
 * paragraph, table, and figure context along with section and page provenance.
 */
export function chunkExtractedDocument(doc: ExtractedDocument): EvidenceChunk[] {
  const chunks: EvidenceChunk[] = [];
  let counter = 1;

  // 1. Chunk Abstract
  if (doc.abstract) {
    const chunkId = `${doc.paperId}_chunk_${counter++}`;
    chunks.push({
      chunkId,
      paperId: doc.paperId,
      text: doc.abstract,
      section: "ABSTRACT",
      page: 1,
      paragraphIndex: 1,
      sourceType: "ABSTRACT",
      provenanceLabel: "Evidence: Abstract, Page 1"
    });
  }

  // 2. Chunk Sections & Paragraphs
  for (const sec of doc.sections) {
    const normSec = normalizeScholarlySectionName(sec.heading);
    sec.paragraphs.forEach((para, pIdx) => {
      if (para.trim().length > 20) {
        const chunkId = `${doc.paperId}_chunk_${counter++}`;
        const pageNum = sec.page || 1;
        chunks.push({
          chunkId,
          paperId: doc.paperId,
          text: para.trim(),
          section: normSec,
          page: pageNum,
          paragraphIndex: pIdx + 1,
          sourceType: doc.fullTextStatus === "FULL_TEXT_PDF" ? "PDF" : "HTML",
          provenanceLabel: `Evidence: ${sec.heading}, Page ${pageNum}`
        });
      }
    });
  }

  // 3. Chunk Tables (Critical for numeric results!)
  for (const tab of doc.tables) {
    const chunkId = `${doc.paperId}_chunk_${counter++}`;
    const pageNum = tab.page || 1;
    const tableText = `Table Context: ${tab.caption}. Headers: ${tab.headers.join(" | ")}. Rows: ${tab.rows.map(r => r.join(" | ")).join(" ; ")}`;
    chunks.push({
      chunkId,
      paperId: doc.paperId,
      text: tableText,
      section: "TABLE",
      page: pageNum,
      sourceType: "TABLE",
      provenanceLabel: `Evidence: ${tab.caption}, Page ${pageNum}`
    });
  }

  // 4. Chunk Figures
  for (const fig of doc.figures) {
    const chunkId = `${doc.paperId}_chunk_${counter++}`;
    const pageNum = fig.page || 1;
    chunks.push({
      chunkId,
      paperId: doc.paperId,
      text: `Figure Context: ${fig.caption}`,
      section: "FIGURE",
      page: pageNum,
      sourceType: "FIGURE",
      provenanceLabel: `Evidence: ${fig.caption}, Page ${pageNum}`
    });
  }

  return chunks;
}
