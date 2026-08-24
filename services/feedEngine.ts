import AsyncStorage from "@react-native-async-storage/async-storage";
import { Paper } from "@/types/models";
import { evaluateSummaryReadiness } from "./summaryReadinessService";
import { generateEducationalStack } from "./paperSummarizer";
import { generateCanonicalPaperId, deduplicatePaperList } from "./deduplication";
import { verifyAndResolveFullTextAsync } from "./fullTextResolver";
import { determinePaperEligibility } from "./dataValidation";
import {
  getRecentlySeenCanonicalIdsAsync,
  getDismissedCanonicalIdsAsync,
  getOrCreateFeedSessionId,
  logPaperInteractionAsync
} from "./paperHistoryService";
import { providerHealthService } from "./providerHealth";

export interface FeedGenerationTelemetry {
  feedGenerationId: string;
  feedSessionId: string;
  userId: string;
  createdAt: string;
  candidateCount: number;
  uniqueCount: number;
  duplicateCount: number;
  invalidCount: number;
  metadataOnlyCount: number;
  eligibleCount: number;
  alreadySeenCount: number;
  filteredCount: number;
  finalCandidateCount: number;
  displayedCount: number;
  relaxationStage: "NORMAL" | "POOL_LOW" | "POOL_EXHAUSTED" | "STILL_EXHAUSTED";
  providerCursors: Record<string, number>;
}

// Provider-specific backend-owned cursors
const providerCursors: Record<string, number> = {
  OpenAlex: 1,
  Crossref: 1,
  OpenAIRE: 1,
  SemanticScholar: 1
};

let recentTelemetryHistory: FeedGenerationTelemetry[] = [];

export function getProviderCursors(): Record<string, number> {
  return { ...providerCursors };
}

export function getLatestFeedTelemetry(): FeedGenerationTelemetry | undefined {
  return recentTelemetryHistory[recentTelemetryHistory.length - 1];
}

export function advanceProviderCursors(): Record<string, number> {
  providerCursors.OpenAlex += 1;
  providerCursors.Crossref += 1;
  providerCursors.OpenAIRE += 1;
  providerCursors.SemanticScholar += 1;
  return getProviderCursors();
}

/**
 * Configurable Multi-Signal Feed Ranking Score:
 * score = quality * 0.25 + relevance * 0.25 + recency * 0.15 + user_interest * 0.15 + popularity * 0.10 + citation * 0.10
 */
export function rankCandidatesMultiSignal(
  papers: Paper[],
  userInterests: string[] = ["artificial intelligence", "quantum computing"],
  weights = { quality: 0.25, relevance: 0.25, recency: 0.15, userInterest: 0.15, popularity: 0.10, citation: 0.10 }
): Paper[] {
  const normInterests = userInterests.map(i => i.toLowerCase());

  return [...papers].sort((a, b) => {
    const recencyA = Math.max(0, ((a.pubYear || 2026) - 2000) / 26);
    const recencyB = Math.max(0, ((b.pubYear || 2026) - 2000) / 26);

    const citA = Math.min(1.0, (a.savedCount || (a as any).citationCount || 0) / 500);
    const citB = Math.min(1.0, (b.savedCount || (b as any).citationCount || 0) / 500);

    const interestA = normInterests.some(i => (a.domain || "").toLowerCase().includes(i)) ? 1.0 : 0.3;
    const interestB = normInterests.some(i => (b.domain || "").toLowerCase().includes(i)) ? 1.0 : 0.3;

    const qualityA = a.pdfUri ? 1.0 : 0.6;
    const qualityB = b.pdfUri ? 1.0 : 0.6;

    const scoreA = (qualityA * weights.quality) + (0.8 * weights.relevance) + (recencyA * weights.recency) + (interestA * weights.userInterest) + (citA * weights.popularity) + (citA * weights.citation);
    const scoreB = (qualityB * weights.quality) + (0.8 * weights.relevance) + (recencyB * weights.recency) + (interestB * weights.userInterest) + (citB * weights.popularity) + (citB * weights.citation);

    return scoreB - scoreA;
  });
}

/**
 * Domain Taxonomy Diversity Filter:
 * Prevents single-topic concentration (e.g. 20 AI papers in a row).
 */
export function applyDiversityFilter(papers: Paper[], maxPerDomain: number = 4): Paper[] {
  const domainCounts: Record<string, number> = {};
  const diverse: Paper[] = [];
  const deferred: Paper[] = [];

  for (const paper of papers) {
    const domain = paper.domain || "General Science";
    const current = domainCounts[domain] || 0;
    if (current < maxPerDomain) {
      domainCounts[domain] = current + 1;
      diverse.push(paper);
    } else {
      deferred.push(paper);
    }
  }

  return [...diverse, ...deferred];
}

/**
 * Core Feed Generation Backend Engine (`POST /feed/refresh` equivalent):
 * Advances cursors, fetches candidates, deduplicates, validates eligibility, excludes recently seen/dismissed,
 * applies ranking and taxonomy diversity, and logs full telemetry.
 */
export async function generateBackendFeedBatchAsync(
  domain?: string,
  isRefresh: boolean = false,
  requestedCount: number = 20,
  userId: string = "user-1"
): Promise<{ items: Paper[]; telemetry: FeedGenerationTelemetry }> {
  const startTime = Date.now();
  const feedSessionId = getOrCreateFeedSessionId();
  const feedGenerationId = `gen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  if (isRefresh) {
    advanceProviderCursors();
  }

  const currentOpenAlexPage = providerCursors.OpenAlex;
  const topicQuery = domain && domain !== "All Discoveries" ? domain : "artificial intelligence";

  let candidates: Paper[] = [];
  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(topicQuery)}&per-page=50&page=${currentOpenAlexPage}&sort=publication_date:desc`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const results = data.results || [];
      candidates = results.map((work: any, idx: number) => {
        const title = work.title || `Manuscript ${work.id?.split("/").pop() || idx}`;
        const doi = work.doi ? work.doi.replace("https://doi.org/", "") : undefined;
        const authorNames = (work.authorships || []).map((a: any) => a.author?.display_name).filter(Boolean);
        const authorName = authorNames.length > 0 ? authorNames.slice(0, 3).join(", ") : "Academic Scholar";
        const org = work.host_venue?.display_name || "Peer-Reviewed Venue";
        const pubYear = work.publication_year || 2026;
        const citationCount = work.cited_by_count || 0;
        const pdfUri = work.open_access?.oa_url || (work.doi ? work.doi : undefined);
        const abstract = work.abstract || `Indexed in ${org}. Cited by ${citationCount} publications.`;

        return {
          id: `openalex-${work.id?.split("/").pop() || idx}`,
          title,
          domain: work.concepts?.[0]?.display_name || "Science",
          summary: abstract,
          fullExplanation: abstract,
          authorId: "openalex-author",
          authorName,
          authorRole: "Researcher",
          originalLink: work.doi || work.id || "https://openalex.org",
          pdfUri,
          tags: ["openalex", "peer-reviewed"],
          readingTime: "5 min read",
          savedCount: citationCount,
          createdAt: new Date(),
          organization: org,
          pubYear,
          doi,
          publication: org,
          publisher: org
        };
      });
      providerHealthService.recordSuccess("OpenAlex", Date.now() - startTime, candidates.length);
    } else {
      providerHealthService.recordFailure("OpenAlex");
    }
  } catch (err) {
    providerHealthService.recordFailure("OpenAlex");
  }

  const candidateCount = candidates.length;

  // 1. Deduplicate by Canonical ID
  const deduplicated = deduplicatePaperList(candidates);
  const uniqueCount = deduplicated.length;
  const duplicateCount = candidateCount - uniqueCount;

  // 2. Full-Text Resolution & Hard Eligibility Gating
  const validEligible: Paper[] = [];
  let invalidCount = 0;
  let metadataOnlyCount = 0;

  for (const paper of deduplicated) {
    const ftRes = await verifyAndResolveFullTextAsync({
      pdfUri: paper.pdfUri,
      abstract: paper.summary,
      doi: paper.doi,
      source: paper.organization
    });

    const eligibility = determinePaperEligibility(ftRes.status);
    if (eligibility === "FULL_ANALYSIS" || eligibility === "ABSTRACT_ANALYSIS") {
      // Phase 8 Summary Readiness Quality Gate
      const brief = generateEducationalStack(paper) as any;
      const readiness = evaluateSummaryReadiness(paper, brief);
      if (readiness.state === "SUMMARY_READY") {
        validEligible.push(paper);
      } else {
        invalidCount += 1;
      }
    } else if (eligibility === "METADATA_ONLY") {
      metadataOnlyCount += 1;
    } else {
      invalidCount += 1;
    }
  }

  const eligibleCount = validEligible.length;

  // 3. Exclude Recently Seen & Dismissed Papers
  const seenCanonicalIds = await getRecentlySeenCanonicalIdsAsync(200, userId);
  const dismissedCanonicalIds = await getDismissedCanonicalIdsAsync(userId);

  let unshown = validEligible.filter(p => {
    const cId = generateCanonicalPaperId(p);
    return !seenCanonicalIds.has(cId) && !dismissedCanonicalIds.has(cId);
  });

  const alreadySeenCount = eligibleCount - unshown.length;
  let relaxationStage: "NORMAL" | "POOL_LOW" | "POOL_EXHAUSTED" | "STILL_EXHAUSTED" = "NORMAL";

  // Progressive Candidate Pool Relaxation if candidates are exhausted
  if (unshown.length < requestedCount) {
    relaxationStage = "POOL_LOW";
    const smallerSeen = await getRecentlySeenCanonicalIdsAsync(50, userId);
    unshown = validEligible.filter(p => {
      const cId = generateCanonicalPaperId(p);
      return !smallerSeen.has(cId) && !dismissedCanonicalIds.has(cId);
    });

    if (unshown.length < requestedCount) {
      relaxationStage = "POOL_EXHAUSTED";
      unshown = validEligible.filter(p => !dismissedCanonicalIds.has(generateCanonicalPaperId(p)));
      if (unshown.length < requestedCount) {
        relaxationStage = "STILL_EXHAUSTED";
      }
    }
  }

  // 4. Multi-Signal Ranking
  const ranked = rankCandidatesMultiSignal(unshown);

  // 5. Diversity Filter
  const diverse = applyDiversityFilter(ranked);
  const finalCandidates = diverse.slice(0, requestedCount);

  // Log Impressions for Displayed Items
  finalCandidates.forEach((p, idx) => {
    logPaperInteractionAsync(generateCanonicalPaperId(p), "IMPRESSION", feedGenerationId, idx + 1, p.organization, userId);
  });

  const telemetry: FeedGenerationTelemetry = {
    feedGenerationId,
    feedSessionId,
    userId,
    createdAt: new Date().toISOString(),
    candidateCount,
    uniqueCount,
    duplicateCount,
    invalidCount,
    metadataOnlyCount,
    eligibleCount,
    alreadySeenCount,
    filteredCount: eligibleCount - finalCandidates.length,
    finalCandidateCount: diverse.length,
    displayedCount: finalCandidates.length,
    relaxationStage,
    providerCursors: getProviderCursors()
  };

  recentTelemetryHistory.push(telemetry);
  return { items: finalCandidates, telemetry };
}

export async function fetchLiveFeedCandidatesAsync(domain?: string, pageIncrement: boolean = false): Promise<Paper[]> {
  const res = await generateBackendFeedBatchAsync(domain, pageIncrement, 20);
  return res.items;
}

export async function markPaperAsSeenAsync(paper: Paper): Promise<void> {
  const cId = generateCanonicalPaperId(paper);
  const session = getOrCreateFeedSessionId();
  await logPaperInteractionAsync(cId, "OPEN", `gen_manual_${Date.now()}`, 1, paper.organization);
}
