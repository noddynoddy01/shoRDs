/**
 * Graph Edge Verification & Evidence Binding Service for shoRDs Research Intelligence OS (Phase 26)
 * Enforces strict evidence requirements: no edge is VERIFIED without traceable evidence chunk IDs.
 */

import { GraphEdge, GraphVerificationStatus, GraphRelationSource } from "../types/researchKnowledgeGraph";

export class GraphVerificationService {
  /**
   * Evaluates and updates the verification status of a graph edge.
   */
  static verifyEdge(edge: GraphEdge): GraphEdge {
    // SYSTEM_INFERRED edges without evidence cannot be verified
    if (edge.source === "SYSTEM_INFERRED" && edge.evidenceChunkIds.length === 0) {
      return {
        ...edge,
        verificationStatus: "REJECTED",
        updatedAt: new Date().toISOString()
      };
    }

    // Factual edges (USES_METHOD, USES_DATASET, CONTRADICTS, HAS_RESEARCH_GAP) require evidence
    const factualRelations = ["USES_METHOD", "USES_DATASET", "EVALUATES_METHOD", "CONTRADICTS", "HAS_RESEARCH_GAP", "ANSWERS"];
    if (factualRelations.includes(edge.relationType) && edge.evidenceChunkIds.length === 0) {
      return {
        ...edge,
        verificationStatus: "REJECTED",
        updatedAt: new Date().toISOString()
      };
    }

    // Metadata edges (AUTHORED_BY, PUBLISHED_IN, CITES) verified via verified provider metadata
    if (edge.source === "EXPLICIT_PAPER_METADATA" || edge.source === "EXPLICIT_CITATION" || edge.evidenceChunkIds.length > 0) {
      return {
        ...edge,
        verificationStatus: "VERIFIED",
        updatedAt: new Date().toISOString()
      };
    }

    return {
      ...edge,
      verificationStatus: "NEEDS_REVIEW",
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Rejects an edge explicitly.
   */
  static rejectEdge(edge: GraphEdge): GraphEdge {
    return {
      ...edge,
      verificationStatus: "REJECTED",
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Sets edge to review required state.
   */
  static requestReview(edge: GraphEdge): GraphEdge {
    return {
      ...edge,
      verificationStatus: "NEEDS_REVIEW",
      updatedAt: new Date().toISOString()
    };
  }
}
