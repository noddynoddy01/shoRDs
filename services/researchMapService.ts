/**
 * Research Map Generator Service for shoRDs Research Intelligence OS (Phase 28)
 *
 * PHASE 6 HONESTY FIX: the map used to be a fixed tree of invented papers, findings ("Achieves 0.924 AUROC on
 * MIMIC-IV") and evidence chunks, shown for any question. A map must be built from retrieved, provenance-linked
 * evidence; none is available here yet, so only the user's own question is returned as the root. Nodes are added
 * only when real evidence exists.
 */

import { ResearchMap, ResearchMapNode } from "../types/researchCopilot";

export class ResearchMapService {
  static buildResearchMap(projectId: string | undefined, mainQuestion: string): ResearchMap {
    const now = Date.now();
    const rootNode: ResearchMapNode = {
      id: `map_root_${now}`,
      type: "QUESTION",
      label: mainQuestion,
      children: []
    };
    return {
      id: `rmap_${now}`,
      projectId,
      title: `Research Map: ${mainQuestion}`,
      rootNode,
      totalNodes: 1,
      createdAt: new Date(now).toISOString()
    };
  }
}
