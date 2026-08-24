import React, { useState } from "react";
import {
  CopilotMode,
  ResearchContext,
  ResearchCopilotResponse,
  ResearchMap as IResearchMap
} from "../../types/researchCopilot";
import { ResearchContextBar } from "../../components/research/ResearchContextBar";
import { CopilotInput } from "../../components/research/CopilotInput";
import { CopilotResponse } from "../../components/research/CopilotResponse";
import { ResearchMap } from "../../components/research/ResearchMap";
import { ResearchCopilotService } from "../../services/researchCopilotService";
import { ResearchMapService } from "../../services/researchMapService";

export const ResearchCopilotWorkspace: React.FC = () => {
  const [context, setContext] = useState<ResearchContext>({
    projectId: "proj_medical_fl",
    activeResearchQuestion: "What are effective transformer architectures for medical image segmentation under differential privacy?",
    selectedPaperIds: ["openalex-W123", "arxiv-2305-14120"],
    selectedEvidenceIds: ["chunk_1842", "chunk_b_08"],
    selectedMethodIds: ["m_vit"],
    selectedDatasetIds: ["d_mimic_iv"],
    selectedGapIds: ["gap_dropout"]
  });

  const [isLoading, setIsLoading] = useState(false);
  const [activeResponse, setActiveResponse] = useState<ResearchCopilotResponse | null>(null);
  const [activeMap, setActiveMap] = useState<IResearchMap | null>(null);

  const handleSend = async (query: string, mode: CopilotMode) => {
    setIsLoading(true);
    try {
      if (mode === "BUILD_RESEARCH_MAP") {
        const map = ResearchMapService.buildResearchMap(context.projectId, query);
        setActiveMap(map);
      }
      const response = await ResearchCopilotService.processCopilotRequest(
        { query, mode, projectId: context.projectId },
        { userId: "usr_101", tenantId: "tenant_default", scope: "PROJECT_PRIVATE" }
      );
      setActiveResponse(response);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif" }}>
      <div style={{ marginBottom: "16px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 4px 0", color: "#0f172a" }}>
          shoRDs Research Copilot
        </h1>
        <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>
          Evidence-grounded research intelligence and interactive knowledge exploration.
        </p>
      </div>

      <ResearchContextBar context={context} onClearContext={() => setContext({ selectedPaperIds: [], selectedEvidenceIds: [], selectedMethodIds: [], selectedDatasetIds: [], selectedGapIds: [] })} />

      <CopilotInput onSend={handleSend} isLoading={isLoading} />

      {activeResponse && (
        <CopilotResponse
          response={activeResponse}
          onInspectEvidence={claimId => alert(`Inspecting claim: ${claimId}`)}
          onActionClick={action => alert(`Executing action: ${action.type}`)}
        />
      )}

      {activeMap && (
        <ResearchMap map={activeMap} onOpenEvidence={chunkId => alert(`Opening chunk: ${chunkId}`)} />
      )}
    </div>
  );
};

export default ResearchCopilotWorkspace;
