import { EvidenceChunk } from "./evidenceChunkingService";
import { StandardScholarlySection } from "./sectionExtractionService";

class EvidenceIndexService {
  private index: Map<string, EvidenceChunk[]> = new Map();

  public registerChunks(paperId: string, chunks: EvidenceChunk[]) {
    this.index.set(paperId, chunks);
  }

  public getChunksForPaper(paperId: string): EvidenceChunk[] {
    return this.index.get(paperId) || [];
  }

  public getChunkById(paperId: string, chunkId: string): EvidenceChunk | undefined {
    const chunks = this.getChunksForPaper(paperId);
    return chunks.find(c => c.chunkId === chunkId);
  }

  public queryEvidence(paperId: string, section?: StandardScholarlySection, query?: string): EvidenceChunk[] {
    const chunks = this.getChunksForPaper(paperId);
    let matched = chunks;

    if (section) {
      const sectionMatches = chunks.filter(c => c.section === section);
      if (sectionMatches.length > 0) {
        matched = sectionMatches;
      }
    }

    if (query && query.trim()) {
      const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      matched = matched.filter(c => {
        const text = c.text.toLowerCase();
        return keywords.some(k => text.includes(k));
      });
    }

    return matched.length > 0 ? matched : chunks;
  }
}

export const evidenceIndexService = new EvidenceIndexService();
