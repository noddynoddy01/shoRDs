/**
 * Strongly-Typed Research Query Engine Domain Entities for shoRDs Research Intelligence OS (Phase 27)
 * Defines query types, intent schemas, DSL query plans, claim-level answers, and async jobs.
 */

export type ResearchQueryType =
  | "PAPER_DISCOVERY"
  | "METHOD_COMPARISON"
  | "DATASET_COMPARISON"
  | "RESEARCH_QUESTION"
  | "RESEARCH_GAP"
  | "CONTRADICTION"
  | "CITATION_ANALYSIS"
  | "TOPIC_EVOLUTION"
  | "AUTHOR_ANALYSIS"
  | "METHOD_USAGE"
  | "DATASET_USAGE"
  | "EVIDENCE_LOOKUP"
  | "CROSS_PAPER_SYNTHESIS"
  | "LITERATURE_REVIEW"
  | "RELATED_RESEARCH";

export type QueryAnswerStatus =
  | "ANSWERED"
  | "PARTIALLY_ANSWERED"
  | "INSUFFICIENT_EVIDENCE"
  | "CONTRADICTORY_EVIDENCE"
  | "NEEDS_CLARIFICATION";

export type QueryScope = "GLOBAL_PUBLIC" | "USER_PRIVATE" | "PROJECT_PRIVATE";

export interface ResolvedEntity {
  entityId: string;
  entityType: "PAPER" | "METHOD" | "DATASET" | "AUTHOR" | "TOPIC" | "QUESTION" | "GAP";
  canonicalName: string;
  matchedAlias: string;
  confidence: number;
  resolutionSource: "CANONICAL_INDEX" | "ALIAS_MAP" | "FULL_TEXT_MATCH";
}

export interface ResearchQueryFilters {
  domain?: string;
  minYear?: number;
  maxYear?: number;
  venues?: string[];
  openAccessOnly?: boolean;
  projectId?: string;
  status?: string;
}

export interface GraphQueryDSL {
  startNodeType: string;
  startNodeId: string;
  traversals: { relationType: string; targetNodeType: string }[];
  filters: Record<string, string | number | boolean>;
  maxDepth: number; // default <= 3
  limit: number; // <= 100
  rankingStrategy: string;
}

export interface EvidenceBundle {
  claimId: string;
  evidenceChunkIds: string[];
  snippets: string[];
  sections: string[];
  pages: number[];
  papers: string[];
}

export interface ResearchAnswerClaim {
  claimId: string;
  text: string;
  evidenceChunkIds: string[];
  graphEdgeIds: string[];
  verificationStatus: "VERIFIED" | "PARTIALLY_VERIFIED" | "UNSUPPORTED" | "NEEDS_REVIEW";
  confidence: number;
  sourcePapers: string[];
}

export interface ResearchAnswer {
  answerId: string;
  queryId: string;
  queryType: ResearchQueryType;
  answerStatus: QueryAnswerStatus;
  summaryText: string;
  claims: ResearchAnswerClaim[];
  limitations: string[];
  confidence: number;
  reasoningChain: string[];
  generatedAt: string;
}

export interface ContradictionAnalysis {
  contradictionId: string;
  paperA: { id: string; title: string; method: string; dataset: string; result: string; evidenceChunkId: string };
  paperB: { id: string; title: string; method: string; dataset: string; result: string; evidenceChunkId: string };
  sharedQuestion: string;
  contextualDifferences: string[];
  neutralNotice: string;
  status: "VERIFIED_CONTRADICTION" | "CONTEXTUAL_DIFFERENCE" | "NEEDS_REVIEW";
}

export interface MethodComparisonEntry {
  methodName: string;
  paperId: string;
  dataset: string;
  evaluationMetric: string;
  reportedResult: string;
  sampleSize: string; // or "NOT_REPORTED"
  limitations: string;
  evidenceChunkIds: string[];
}

export interface TopicEvolutionTimelinePoint {
  year: number;
  paperCount: number;
  dominantMethods: string[];
  keyDatasets: string[];
  majorFindings: string[];
  openGaps: string[];
  representativePaperIds: string[];
}

export interface ResearchQueryJob {
  id: string;
  userId: string;
  projectId?: string;
  queryText: string;
  queryType: ResearchQueryType;
  status: "QUEUED" | "PLANNING" | "RETRIEVING" | "ANALYZING" | "VERIFYING" | "COMPLETED" | "FAILED" | "CANCELLED";
  progress: number;
  result?: ResearchAnswer;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ResearchQueryHistoryEntry {
  id: string;
  userId: string;
  projectId?: string;
  query: string;
  normalizedQuery: string;
  queryType: ResearchQueryType;
  answerStatus: QueryAnswerStatus;
  createdAt: string;
}
