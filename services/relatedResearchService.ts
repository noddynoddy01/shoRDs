/**
 * Related Research Discovery & Knowledge Graph Traversal Service for shoRDs Research Intelligence OS (Phase 26)
 * Computes deterministic multi-signal rankings and generates 1-hop, 2-hop, 3-hop traversals.
 */

import {
  GraphEdge,
  GraphTraversalResult,
  RelatedResearchRankingExplanation
} from "../types/researchKnowledgeGraph";

export class RelatedResearchService {
  /**
   * Calculates deterministic related research ranking with full signal explainability.
   */
  static rankRelatedPaper(
    paperId: string,
    candidateId: string,
    signals: {
      hasCitation: boolean;
      hasSharedMethod: boolean;
      hasSharedDataset: boolean;
      hasSharedTopic: boolean;
      hasSharedQuestion: boolean;
      semanticScore: number;
      isSummaryReady: boolean;
    }
  ): RelatedResearchRankingExplanation {
    const citationScore = signals.hasCitation ? 0.30 : 0.0;
    const methodScore = signals.hasSharedMethod ? 0.25 : 0.0;
    const datasetScore = signals.hasSharedDataset ? 0.20 : 0.0;
    const topicScore = signals.hasSharedTopic ? 0.10 : 0.0;
    const questionScore = signals.hasSharedQuestion ? 0.15 : 0.0;
    const recencyScore = 0.05;
    const qualityScore = signals.isSummaryReady ? 0.10 : 0.0;

    const finalScore = Number(
      (
        citationScore +
        methodScore +
        datasetScore +
        topicScore +
        questionScore +
        recencyScore +
        qualityScore +
        signals.semanticScore * 0.15
      ).toFixed(3)
    );

    return {
      paperId,
      relatedPaperId: candidateId,
      citationScore,
      methodScore,
      datasetScore,
      topicScore,
      questionScore,
      recencyScore,
      qualityScore,
      finalScore,
      signals: {
        citation: signals.hasCitation,
        method: signals.hasSharedMethod,
        dataset: signals.hasSharedDataset,
        topic: signals.hasSharedTopic,
        semantic: signals.semanticScore
      }
    };
  }

  /**
   * Traverses knowledge graph up to N hops.
   */
  static traverseGraph(rootNodeId: string, maxDepth: number, allEdges: GraphEdge[]): GraphTraversalResult {
    const visitedNodes = new Set<string>([rootNodeId]);
    const matchedEdges: GraphEdge[] = [];

    let currentLayer = [rootNodeId];
    for (let depth = 1; depth <= Math.min(maxDepth, 3); depth++) {
      const nextLayer: string[] = [];
      for (const nodeId of currentLayer) {
        const edges = allEdges.filter(e => e.sourceNodeId === nodeId || e.targetNodeId === nodeId);
        for (const edge of edges) {
          if (!matchedEdges.some(m => m.id === edge.id)) {
            matchedEdges.push(edge);
          }
          const otherId = edge.sourceNodeId === nodeId ? edge.targetNodeId : edge.sourceNodeId;
          if (!visitedNodes.has(otherId)) {
            visitedNodes.add(otherId);
            nextLayer.push(otherId);
          }
        }
      }
      currentLayer = nextLayer;
    }

    const nodes = Array.from(visitedNodes).map(id => ({
      id,
      type: id.startsWith("p_") || id.startsWith("arxiv") ? "PAPER" : id.startsWith("m_") ? "METHOD" : "DATASET",
      label: id
    }));

    return {
      rootNodeId,
      depth: maxDepth,
      nodes,
      edges: matchedEdges
    };
  }
}
