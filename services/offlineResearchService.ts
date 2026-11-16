/**
 * Offline reading for shoRDs: save a research brief, its citations and the paper's metadata on the device so they can be read without a connection.
 *
 * What is saved, and what is not:
 *  - SAVED: the brief exactly as it was shown, the passages it cites, and the metadata the source supplied (title, authors, venue, year, DOI, link).
 *  - NOT SAVED: the paper's PDF. No file-system or hashing dependency is installed in the app, so nothing here can download a PDF. The record says
 *    `NOT_DOWNLOADED` and carries the link instead. `recordVerifiedPdf` is the only way a record can ever say a PDF is on the device, and it refuses
 *    unless the bytes pass `verifyPdfBytes` (PDF header, plausible size, SHA-256 supplied and re-computed). A future downloader must go through it.
 *  - NEVER INVENTED: a licence is stored only if the source supplied one. Unknown stays `null`; it is never defaulted to "CC-BY" or to "Closed Access".
 *    Whether a PDF may be stored is a separate decision for the licence policy (backend/papers/licensePolicy.js), not something this file guesses.
 *
 * The brief is labelled with where it came from. The only brief generated on the device is the rule-based one (`ON_DEVICE_RULES`); it is not the
 * backend's cited analysis and has not been checked claim by claim.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { GroundedResearchBrief } from "./paperSummarizer";

export type BriefOrigin = "ON_DEVICE_RULES";

export interface OfflineCitation {
  claimId: string;
  claimText: string;
  chunkId: string;
  section?: string;
  /** The passage the brief pointed to, as saved with the brief. */
  passage: string;
}

export type OfflinePdfState =
  | { status: "NOT_DOWNLOADED"; openUrl?: string }
  | { status: "VERIFIED"; localUri: string; bytes: number; sha256: string; verifiedAt: string; openUrl?: string };

export interface CachedOfflinePaper {
  schemaVersion: 2;
  /** The app's id for the paper (the route parameter). */
  paperId: string;
  title: string;
  authors: string[];
  venue?: string;
  year?: number;
  doi?: string;
  sourceUrl?: string;
  domain?: string;
  /** As reported by the source. `null` means the source did not say. */
  isOpenAccess: boolean | null;
  /** As reported by the source, verbatim. `null` means unknown; never filled with a guess. */
  license: string | null;
  brief: GroundedResearchBrief;
  briefOrigin: BriefOrigin;
  /** What text the brief was built from: FULL_TEXT, ABSTRACT_ONLY or METADATA_ONLY. */
  textBasis: GroundedResearchBrief["summaryMode"];
  citations: OfflineCitation[];
  pdf: OfflinePdfState;
  savedAt: string;
}

export interface SaveInput {
  paperId: string;
  title: string;
  authors: string[];
  venue?: string;
  year?: number;
  doi?: string;
  sourceUrl?: string;
  domain?: string;
  isOpenAccess?: boolean | null;
  license?: string | null;
  brief: GroundedResearchBrief;
}

export const OFFLINE_STORAGE_KEY = "shords_offline_papers_v2";
/** The previous version of this key held records with an invented licence and an unverified "PDF cached" flag. It is discarded, not migrated. */
const LEGACY_STORAGE_KEY = "shords_offline_cached_papers";
export const MAX_OFFLINE_PAPERS = 100;
export const MIN_PDF_BYTES = 1024;
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/** Collect the passages a brief cites. A claim without a passage is not a citation and is left out. */
export function citationsFromBrief(brief: GroundedResearchBrief): OfflineCitation[] {
  const out: OfflineCitation[] = [];
  const seen = new Set<string>();
  for (const claim of brief.allClaims || []) {
    for (const ev of claim.evidence || []) {
      const passage = (ev.supportingTextSnippet || "").trim();
      if (!passage) continue;
      const key = `${claim.claimId}|${ev.chunkId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ claimId: claim.claimId, claimText: claim.text, chunkId: ev.chunkId, section: ev.section, passage });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ PDF verification

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

/** SHA-256 of a byte array, in pure TypeScript (no native module is available to the app for this). Returns lowercase hex. */
export function sha256Hex(data: Uint8Array): string {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const bitLen = data.length * 8;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return Array.from(H, x => x.toString(16).padStart(8, "0")).join("");
}

export type PdfVerification = { ok: true; bytes: number; sha256: string } | { ok: false; reason: "EMPTY" | "TOO_SMALL" | "TOO_LARGE" | "NOT_A_PDF" | "TRUNCATED" | "HASH_MISMATCH" | "NO_SAVED_RECORD" | "NO_LOCAL_FILE" };

/**
 * Check downloaded bytes. A page of HTML saved as "paper.pdf", an empty file, a cut-off download and a file whose hash differs from the one the
 * downloader reported all fail. Passing is necessary, not sufficient, evidence that the file is the paper: this does not read the PDF's contents.
 */
export function verifyPdfBytes(data: Uint8Array, expectedSha256?: string): PdfVerification {
  if (!data || data.length === 0) return { ok: false, reason: "EMPTY" };
  if (data.length < MIN_PDF_BYTES) return { ok: false, reason: "TOO_SMALL" };
  if (data.length > MAX_PDF_BYTES) return { ok: false, reason: "TOO_LARGE" };
  const head = String.fromCharCode(...data.subarray(0, 5));
  if (head !== "%PDF-") return { ok: false, reason: "NOT_A_PDF" };
  // A complete PDF ends with an end-of-file marker within its last kilobyte.
  const tail = String.fromCharCode(...data.subarray(Math.max(0, data.length - 1024)));
  if (!tail.includes("%%EOF")) return { ok: false, reason: "TRUNCATED" };
  const sha256 = sha256Hex(data);
  if (expectedSha256 && expectedSha256.toLowerCase() !== sha256) return { ok: false, reason: "HASH_MISMATCH" };
  return { ok: true, bytes: data.length, sha256 };
}

// ------------------------------------------------------------------------------------------------ store

export class OfflineResearchService {
  private static papers: Map<string, CachedOfflinePaper> = new Map();
  private static loaded = false;

  /** Load saved records. Records from the earlier format are dropped because they carried an invented licence and unverified PDF flags. */
  static async initAsync(): Promise<CachedOfflinePaper[]> {
    try {
      const stored = await AsyncStorage.getItem(OFFLINE_STORAGE_KEY);
      this.papers.clear();
      if (stored) {
        const list = JSON.parse(stored);
        if (Array.isArray(list)) {
          for (const item of list) if (isValidRecord(item)) this.papers.set(item.paperId, item);
        }
      }
      await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      this.papers.clear();
    }
    this.loaded = true;
    return Array.from(this.papers.values());
  }

  /** Save a brief, its citations and the paper's metadata. Never touches a PDF and never invents a licence. */
  static async saveBriefAsync(input: SaveInput): Promise<CachedOfflinePaper> {
    if (!this.loaded) await this.initAsync();
    const record: CachedOfflinePaper = {
      schemaVersion: 2,
      paperId: input.paperId,
      title: input.title,
      authors: input.authors,
      venue: input.venue,
      year: input.year,
      doi: input.doi,
      sourceUrl: input.sourceUrl,
      domain: input.domain,
      isOpenAccess: typeof input.isOpenAccess === "boolean" ? input.isOpenAccess : null,
      license: typeof input.license === "string" && input.license.trim() ? input.license.trim() : null,
      brief: input.brief,
      briefOrigin: "ON_DEVICE_RULES",
      textBasis: input.brief.summaryMode,
      citations: citationsFromBrief(input.brief),
      // Keep an already-verified PDF if this paper was saved before; a re-save of the brief must not downgrade it.
      pdf: this.papers.get(input.paperId)?.pdf ?? { status: "NOT_DOWNLOADED", openUrl: input.sourceUrl },
      savedAt: new Date().toISOString()
    };
    this.papers.set(record.paperId, record);
    while (this.papers.size > MAX_OFFLINE_PAPERS) {
      const oldest = this.papers.keys().next().value;
      if (oldest === undefined) break;
      this.papers.delete(oldest);
    }
    await this.persist();
    return record;
  }

  /**
   * The only way a record can say a PDF is on the device. The caller passes the downloaded bytes; they are checked here, so a downloader that
   * writes a bad file cannot mark it cached by mistake. Returns the verification result; the record changes only when it passed.
   */
  static async recordVerifiedPdf(paperId: string, localUri: string, bytes: Uint8Array, expectedSha256?: string): Promise<PdfVerification> {
    const result = verifyPdfBytes(bytes, expectedSha256);
    const rec = this.papers.get(paperId);
    if (!result.ok) return result;
    if (!rec) return { ok: false, reason: "NO_SAVED_RECORD" };
    if (!localUri) return { ok: false, reason: "NO_LOCAL_FILE" };
    rec.pdf = { status: "VERIFIED", localUri, bytes: result.bytes, sha256: result.sha256, verifiedAt: new Date().toISOString(), openUrl: rec.sourceUrl };
    await this.persist();
    return result;
  }

  static isSavedOffline(paperId: string): boolean {
    return this.papers.has(paperId);
  }

  static get(paperId: string): CachedOfflinePaper | undefined {
    return this.papers.get(paperId);
  }

  static list(): CachedOfflinePaper[] {
    return Array.from(this.papers.values()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  static async removeAsync(paperId: string): Promise<boolean> {
    const deleted = this.papers.delete(paperId);
    if (deleted) await this.persist();
    return deleted;
  }

  private static async persist() {
    await AsyncStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(Array.from(this.papers.values())));
  }
}

function isValidRecord(x: any): x is CachedOfflinePaper {
  if (!x || x.schemaVersion !== 2 || typeof x.paperId !== "string" || typeof x.title !== "string" || !x.brief || !Array.isArray(x.citations)) return false;
  if (!x.pdf || (x.pdf.status !== "NOT_DOWNLOADED" && x.pdf.status !== "VERIFIED")) return false;
  // A record may only claim a verified PDF if it carries the evidence of the check.
  if (x.pdf.status === "VERIFIED" && !(typeof x.pdf.sha256 === "string" && /^[0-9a-f]{64}$/.test(x.pdf.sha256) && x.pdf.bytes >= MIN_PDF_BYTES && typeof x.pdf.localUri === "string" && x.pdf.localUri)) return false;
  return true;
}
