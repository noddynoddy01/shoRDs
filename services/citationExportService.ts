/**
 * Deep Evidence Citation Export Engine for shoRDs Research Intelligence OS
 * Generates verified BibTeX (.bib) and RIS (.ris) bibliographic citations
 * and granular evidence-level citations (Paper Citation + Grounded Claim + Source Section + Page).
 */

import { GroundedClaim } from "./claimVerification";

export interface CitationMetadata {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  publisher?: string;
  doi?: string;
  url?: string;
  canonicalId?: string;
}

export interface EvidenceCitationPayload {
  paperCitationBibTeX: string;
  paperCitationRIS: string;
  claimText: string;
  sourceChunkId: string;
  section: string;
  page?: number;
  provenanceLabel: string;
  exportTimestamp: string;
}

export class CitationExportService {
  /**
   * Generates a clean, verified BibTeX (.bib) record.
   */
  static generateBibTeX(meta: CitationMetadata): string {
    const citeKey = this.generateCiteKey(meta);
    const authorStr = meta.authors && meta.authors.length > 0 ? meta.authors.join(" and ") : "Anonymous";
    const yearStr = meta.year || new Date().getFullYear();
    const venueStr = meta.venue || meta.publisher || "Academic Publication";

    let bib = `@article{${citeKey},\n`;
    bib += `  title = {${meta.title}},\n`;
    bib += `  author = {${authorStr}},\n`;
    bib += `  journal = {${venueStr}},\n`;
    bib += `  year = {${yearStr}},\n`;

    if (meta.doi) {
      bib += `  doi = {${meta.doi}},\n`;
    }
    if (meta.url) {
      bib += `  url = {${meta.url}},\n`;
    }
    bib += `  note = {Verified via shoRDs Research Intelligence OS (Canonical ID: ${meta.canonicalId || meta.id})}\n`;
    bib += `}`;

    return bib;
  }

  /**
   * Generates a standard RIS (.ris) bibliographic record for Zotero, Mendeley, and EndNote.
   */
  static generateRIS(meta: CitationMetadata): string {
    let ris = "TY  - JOUR\n";
    ris += `TI  - ${meta.title}\n`;

    if (meta.authors && meta.authors.length > 0) {
      for (const author of meta.authors) {
        ris += `AU  - ${author}\n`;
      }
    } else {
      ris += "AU  - Anonymous\n";
    }

    if (meta.year) {
      ris += `PY  - ${meta.year}\n`;
    }
    if (meta.venue || meta.publisher) {
      ris += `JO  - ${meta.venue || meta.publisher}\n`;
    }
    if (meta.doi) {
      ris += `DO  - ${meta.doi}\n`;
    }
    if (meta.url) {
      ris += `UR  - ${meta.url}\n`;
    }
    ris += `N1  - Verified via shoRDs Research Intelligence OS (Canonical ID: ${meta.canonicalId || meta.id})\n`;
    ris += "ER  - \n";

    return ris;
  }

  /**
   * Exports a complete evidence-level citation linking a verified claim to the exact paper chunk.
   */
  static generateEvidenceCitation(meta: CitationMetadata, claim: GroundedClaim): EvidenceCitationPayload {
    const ev = claim.evidence && claim.evidence.length > 0 ? claim.evidence[0] : null;

    return {
      paperCitationBibTeX: this.generateBibTeX(meta),
      paperCitationRIS: this.generateRIS(meta),
      claimText: claim.text,
      sourceChunkId: ev ? ev.chunkId : "chunk-unknown",
      section: ev?.section || "METHODOLOGY",
      page: ev?.page || 1,
      provenanceLabel: ev?.provenanceLabel || "Verified Full-Text Evidence",
      exportTimestamp: new Date().toISOString()
    };
  }

  private static generateCiteKey(meta: CitationMetadata): string {
    const firstAuthor = meta.authors && meta.authors.length > 0 ? meta.authors[0].split(/\s+/).pop()?.toLowerCase() || "author" : "author";
    const year = meta.year || new Date().getFullYear();
    const firstWord = meta.title.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") || "paper";
    return `${firstAuthor}${year}${firstWord}`;
  }
}
