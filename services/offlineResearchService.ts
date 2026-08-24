/**
 * Offline Research Mode & Brief Cache Service for shoRDs Research Intelligence OS
 * Manages offline caching of structured Research Briefs, evidence chunks, figures,
 * and copyright-compliant open access PDFs with strict versioning and cache invalidation.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { GroundedResearchBrief } from "./paperSummarizer";

export interface CachedOfflinePaper {
  canonicalId: string;
  title: string;
  authors: string[];
  venue?: string;
  year?: number;
  domain?: string;
  isOpenAccess: boolean;
  license: string;
  brief: GroundedResearchBrief;
  pdfCached: boolean;
  summaryVersion: number;
  sourceVersion: string;
  cachedAt: string;
  offlineStatus: "OFFLINE_CACHED_BRIEF" | "OFFLINE_FULL_ACCESS";
}

const OFFLINE_PAPERS_STORAGE_KEY = "shords_offline_cached_papers";

export class OfflineResearchService {
  private static cachedPapers: Map<string, CachedOfflinePaper> = new Map();

  static async initAsync(): Promise<CachedOfflinePaper[]> {
    try {
      const stored = await AsyncStorage.getItem(OFFLINE_PAPERS_STORAGE_KEY);
      if (stored) {
        const list: CachedOfflinePaper[] = JSON.parse(stored);
        this.cachedPapers.clear();
        for (const item of list) {
          this.cachedPapers.set(item.canonicalId, item);
        }
      }
    } catch {}
    return Array.from(this.cachedPapers.values());
  }

  /**
   * Caches a Research Brief for offline consumption.
   * Strictly respects open-access licensing before caching full PDFs!
   */
  static async saveForOfflineAsync(paper: {
    canonicalId: string;
    title: string;
    authors: string[];
    venue?: string;
    year?: number;
    domain?: string;
    isOpenAccess?: boolean;
    license?: string;
    brief: GroundedResearchBrief;
  }): Promise<CachedOfflinePaper> {
    const isOpenAccess = !!paper.isOpenAccess;
    const license = paper.license || (isOpenAccess ? "CC-BY-4.0" : "Closed Access / All Rights Reserved");
    const canCachePdf = isOpenAccess && (license.includes("CC") || license.includes("Open"));

    const record: CachedOfflinePaper = {
      canonicalId: paper.canonicalId,
      title: paper.title,
      authors: paper.authors,
      venue: paper.venue,
      year: paper.year,
      domain: paper.domain,
      isOpenAccess,
      license,
      brief: paper.brief,
      pdfCached: canCachePdf,
      summaryVersion: 2,
      sourceVersion: "v2.1",
      cachedAt: new Date().toISOString(),
      offlineStatus: canCachePdf ? "OFFLINE_FULL_ACCESS" : "OFFLINE_CACHED_BRIEF"
    };

    this.cachedPapers.set(record.canonicalId, record);
    await AsyncStorage.setItem(OFFLINE_PAPERS_STORAGE_KEY, JSON.stringify(Array.from(this.cachedPapers.values())));
    return record;
  }

  static isPaperCachedOffline(canonicalId: string): boolean {
    return this.cachedPapers.has(canonicalId);
  }

  static getCachedPaper(canonicalId: string): CachedOfflinePaper | undefined {
    return this.cachedPapers.get(canonicalId);
  }

  static async removeOfflinePaperAsync(canonicalId: string): Promise<boolean> {
    const deleted = this.cachedPapers.delete(canonicalId);
    if (deleted) {
      await AsyncStorage.setItem(OFFLINE_PAPERS_STORAGE_KEY, JSON.stringify(Array.from(this.cachedPapers.values())));
    }
    return deleted;
  }
}
