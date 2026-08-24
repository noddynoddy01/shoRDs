import React from "react";
import { ResearchContext } from "../../types/researchCopilot";

interface ResearchContextBarProps {
  context: ResearchContext;
  onClearContext?: () => void;
}

export const ResearchContextBar: React.FC<ResearchContextBarProps> = ({ context, onClearContext }) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        backgroundColor: "#f1f5f9",
        borderRadius: "4px",
        fontSize: "12px",
        color: "#475569",
        marginBottom: "12px"
      }}
    >
      <div>
        <strong>Active Research Context:</strong>{" "}
        {context.projectId ? `Project [${context.projectId}]` : "Global Public"}
        {context.activeResearchQuestion && ` • Q: "${context.activeResearchQuestion}"`}
        {context.selectedPaperIds.length > 0 && ` • ${context.selectedPaperIds.length} papers selected`}
      </div>
      {onClearContext && (
        <button
          onClick={onClearContext}
          style={{
            background: "none",
            border: "none",
            color: "#64748b",
            cursor: "pointer",
            fontSize: "11px",
            textDecoration: "underline"
          }}
        >
          Reset Context
        </button>
      )}
    </div>
  );
};
