/**
 * Strongly-Typed Research Copilot Domain Entities for shoRDs Research Intelligence OS (Phase 28)
 * Defines Copilot modes, request/response models, claim-first candidate structures,
 * research context, and suggested research actions.
 */

export type CopilotMode =
  | "ASK"
  | "COMPARE"
  | "EXPLAIN"
  | "TRACE_EVIDENCE"
  | "EXPLORE_GRAPH"
  | "ANALYZE_PROJECT"
  | "FIND_GAP"
  | "FIND_CONTRADICTION"
  | "BUILD_RESEARCH_MAP"
  | "CONTINUE_RESEARCH";

export type CopilotResponseStatus =
  | "VERIFIED"
  | "PARTIALLY_VERIFIED"
  | "INSUFFICIENT_EVIDENCE"
  | "CONTRADICTORY"
  | "NEEDS_CLARIFICATION"
  | "FAILED";

export type SuggestedActionType =
  | "VIEW_EVIDENCE"
  | "OPEN_PAPER"
  | "COMPARE_PAPERS"
  | "SAVE_EVIDENCE"
  | "ADD_TO_PROJECT"
  | "CREATE_COLLECTION"
  | "EXPLORE_METHOD"
  | "EXPLORE_DATASET"
  | "EXPLORE_GAP"
  | "OPEN_CITATION_GRAPH"
  | "BUILD_RESEARCH_MAP"
  | "ADD_TO_LITERATURE_REVIEW";

export interface ResearchCopilotRequest {
  query: string;
  mode?: CopilotMode;
  projectId?: string;
  selectedPaperIds?: string[];
  selectedEvidenceIds?: string[];
  selectedEntityIds?: string[];
  conversationId?: string;
}

export interface ResearchCopilotClaim {
  claimId: string;
  text: string;
  verificationStatus: "VERIFIED" | "PARTIALLY_VERIFIED" | "UNSUPPORTED" | "NEEDS_REVIEW";
  evidenceChunkIds: string[];
  graphEdgeIds: string[];
  paperIds: string[];
  confidence: number;
}

export interface ResearchCopilotResponse {
  responseId: string;
  queryId: string;
  conversationId?: string;
  status: CopilotResponseStatus;
  mode: CopilotMode;
  answer: string;
  claims: ResearchCopilotClaim[];
  sources: { paperId: string; title: string; authors: string[]; year: number; doi?: string }[];
  evidence: { chunkId: string; paperId: string; section: string; page: number; text: string }[];
  graphContext: { edgeId: string; relationType: string; source: string; target: string }[];
  suggestedActions: { type: SuggestedActionType; label: string; payload: Record<string, string> }[];
  uncertainty?: string;
  limitations: string[];
  createdAt: string;
}

export interface ResearchContext {
  projectId?: string;
  activeResearchQuestion?: string;
  selectedPaperIds: string[];
  selectedEvidenceIds: string[];
  selectedMethodIds: string[];
  selectedDatasetIds: string[];
  selectedGapIds: string[];
}

export interface ResearchConversationMessage {
  id: string;
  conversationId: string;
  sender: "USER" | "COPILOT";
  content: string;
  mode: CopilotMode;
  responseStatus?: CopilotResponseStatus;
  createdAt: string;
}

export interface ResearchMapNode {
  id: string;
  type: "QUESTION" | "SUBQUESTION" | "PAPER" | "METHOD" | "DATASET" | "FINDING" | "CONTRADICTION" | "GAP" | "EVIDENCE";
  label: string;
  provenanceChunkId?: string;
  paperId?: string;
  children: ResearchMapNode[];
}

export interface ResearchMap {
  id: string;
  projectId?: string;
  title: string;
  rootNode: ResearchMapNode;
  totalNodes: number;
  createdAt: string;
}
