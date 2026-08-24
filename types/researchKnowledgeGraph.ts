/**
 * Strongly-Typed Research Knowledge Graph Domain Entities for shoRDs Research Intelligence OS (Phase 26)
 * Defines graph nodes, edges, relation taxonomy, provenance sources, verification states, and graph scopes.
 */

export type GraphRelationType =
  | "AUTHORED_BY"
  | "AFFILIATED_WITH"
  | "PUBLISHED_IN"
  | "ABOUT_TOPIC"
  | "USES_METHOD"
  | "USES_DATASET"
  | "EVALUATES_METHOD"
  | "BUILDS_ON"
  | "CITES"
  | "CITED_BY"
  | "RELATED_TO"
  | "EXTENDS"
  | "CONTRADICTS"
  | "SUPPORTS"
  | "ADDRESSES"
  | "MENTIONS"
  | "HAS_RESEARCH_GAP"
  | "ANSWERS"
  | "PARTIALLY_ANSWERS"
  | "USES_EVIDENCE"
  | "SAME_DATASET"
  | "SAME_METHOD"
  | "SAME_RESEARCH_QUESTION";

export type GraphRelationSource =
  | "EXPLICIT_PAPER_METADATA"
  | "EXPLICIT_FULL_TEXT"
  | "EXPLICIT_CITATION"
  | "EXPLICIT_AUTHOR_STATEMENT"
  | "EVIDENCE_EXTRACTION"
  | "USER_CONFIRMED"
  | "SYSTEM_INFERRED";

export type GraphVerificationStatus = "PENDING" | "VERIFIED" | "REJECTED" | "NEEDS_REVIEW";

export type GraphScope = "GLOBAL_PUBLIC" | "USER_PRIVATE" | "PROJECT_PRIVATE";

export interface PaperNode {
  id: string; // canonical paperId
  title: string;
  year?: number;
  venue?: string;
  citationCount?: number;
}

export interface AuthorNode {
  id: string;
  name: string;
  institutionIds: string[];
  orcid?: string;
}

export interface InstitutionNode {
  id: string;
  name: string;
  country?: string;
  rorId?: string;
}

export interface VenueNode {
  id: string;
  name: string;
  type: "JOURNAL" | "CONFERENCE" | "PREPRINT";
  issnOrDoi?: string;
}

export interface TopicNode {
  id: string;
  name: string;
  parentTopicId?: string;
  level: number;
}

export interface MethodNode {
  id: string;
  canonicalName: string;
  aliases: string[];
  description?: string;
  parentMethodId?: string;
  createdAt: string;
}

export interface DatasetNode {
  id: string;
  canonicalName: string;
  aliases: string[];
  sourceUrl?: string;
  license?: string;
  description?: string;
}

export interface ResearchQuestionNode {
  id: string;
  projectId: string;
  text: string;
  status: "ANSWERED" | "PARTIALLY_ANSWERED" | "CONTRADICTED" | "INSUFFICIENT_EVIDENCE";
}

export interface ResearchGapNode {
  id: string;
  title: string;
  description: string;
  classification: "EXPLICIT_AUTHOR_GAP" | "CROSS_PAPER_OBSERVATION" | "UNRESOLVED_CONTRADICTION" | "INSUFFICIENT_EVIDENCE";
  status: "CANDIDATE" | "EVIDENCE_REQUIRED" | "VERIFIED" | "REJECTED";
}

export interface EvidenceNode {
  id: string; // chunkId
  paperId: string;
  text: string;
  section: string;
  page: number;
}

export interface GraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: GraphRelationType;
  evidenceChunkIds: string[];
  confidence: number;
  verificationStatus: GraphVerificationStatus;
  source: GraphRelationSource;
  scope: GraphScope;
  projectId?: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RelatedResearchRankingExplanation {
  paperId: string;
  relatedPaperId: string;
  citationScore: number;
  methodScore: number;
  datasetScore: number;
  topicScore: number;
  questionScore: number;
  recencyScore: number;
  qualityScore: number;
  finalScore: number;
  signals: {
    citation: boolean;
    method: boolean;
    dataset: boolean;
    topic: boolean;
    semantic: number;
  };
}

export interface GraphTraversalResult {
  rootNodeId: string;
  depth: number;
  nodes: { id: string; type: string; label: string }[];
  edges: GraphEdge[];
}
