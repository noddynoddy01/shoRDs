import React, { useState } from "react";
import { router } from "expo-router";
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
import { useProject } from "../../context/ProjectContext";

const EMPTY_CONTEXT: ResearchContext = {
  selectedPaperIds: [],
  selectedEvidenceIds: [],
  selectedMethodIds: [],
  selectedDatasetIds: [],
  selectedGapIds: []
};

export const ResearchCopilotWorkspace: React.FC = () => {
  const { phase, selection, active, error } = useProject();
  // Starts empty: nothing is pre-selected. The paper is whatever the user types; the server resolves it and retrieves its text.
  const [paperRef, setPaperRef] = useState("");
  const [context, setContext] = useState<ResearchContext>(EMPTY_CONTEXT);

  const [isLoading, setIsLoading] = useState(false);
  const [activeResponse, setActiveResponse] = useState<ResearchCopilotResponse | null>(null);
  const [activeMap, setActiveMap] = useState<IResearchMap | null>(null);

  const projectId = active ? active.projectId : undefined;
  const ctx: ResearchContext = { ...context, projectId, selectedPaperIds: paperRef.trim() ? [paperRef.trim()] : [] };

  const handleSend = async (query: string, mode: CopilotMode) => {
    setIsLoading(true);
    try {
      if (mode === "BUILD_RESEARCH_MAP") {
        const map = ResearchMapService.buildResearchMap(projectId, query);
        setActiveMap(map);
      }
      // Identity (user, tenant, project access) is decided by the backend from the verified ID token, not sent from here.
      // Only the project id, the paper reference and the question are sent; evidence is retrieved by the server.
      const response = await ResearchCopilotService.processCopilotRequest({ query, mode, projectId, selectedPaperIds: ctx.selectedPaperIds });
      setActiveResponse(response);
    } finally {
      setIsLoading(false);
    }
  };

  const box: React.CSSProperties = { padding: "10px 14px", borderRadius: "6px", fontSize: "13px", marginBottom: "12px" };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif" }}>
      <div style={{ marginBottom: "16px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 4px 0", color: "#0f172a" }}>
          shoRDs Research Copilot
        </h1>
        <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>
          Ask about one paper at a time. Answers cite text the server retrieved from that paper, and say how much of the paper was available.
        </p>
      </div>

      {phase === "ERROR" && (
        <div role="alert" style={{ ...box, backgroundColor: "#fef2f2", color: "#b91c1c" }}>
          {error || "Could not load your projects."}
        </div>
      )}
      {phase === "READY" && selection.kind === "NONE" && (
        <div style={{ ...box, backgroundColor: "#f1f5f9", color: "#334155" }}>
          You have no project yet. Questions are kept in your personal space until you{" "}
          <button type="button" onClick={() => router.push("/projects")} style={{ background: "none", border: "none", color: "#1d4ed8", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
            create a project
          </button>
          .
        </div>
      )}
      {phase === "READY" && selection.kind === "PICK" && (
        <div style={{ ...box, backgroundColor: "#fffbeb", color: "#92400e" }}>
          You belong to several projects.{" "}
          <button type="button" onClick={() => router.push("/projects")} style={{ background: "none", border: "none", color: "#1d4ed8", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
            Choose one
          </button>{" "}
          before asking, so the answer is saved to the right place. Until then questions use your personal space.
        </div>
      )}

      <ResearchContextBar context={{ ...ctx, projectId: active ? active.name : undefined }} onClearContext={() => { setContext(EMPTY_CONTEXT); setPaperRef(""); }} />

      <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#475569", marginBottom: "4px" }} htmlFor="paper-ref">
        Paper (DOI, PMID or arXiv id)
      </label>
      <input
        id="paper-ref"
        value={paperRef}
        onChange={(e) => setPaperRef(e.target.value)}
        placeholder="e.g. 10.1038/s41586-020-2649-2, 31452104 or arXiv:1706.03762"
        maxLength={300}
        autoComplete="off"
        style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px" }}
      />

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
