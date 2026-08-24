import React from "react";
import { ContradictionAnalysis } from "../../types/researchQuery";

interface ContradictionPanelProps {
  contradiction: ContradictionAnalysis;
}

export const ContradictionPanel: React.FC<ContradictionPanelProps> = ({ contradiction }) => {
  return (
    <div
      style={{
        border: "1px solid #fed7aa",
        backgroundColor: "#fffbeb",
        borderRadius: "6px",
        padding: "14px",
        marginTop: "12px",
        marginBottom: "12px"
      }}
    >
      <div style={{ fontSize: "12px", fontWeight: 700, color: "#9a3412", textTransform: "uppercase" }}>
        Contextual Contradiction Analysis
      </div>
      <div style={{ fontSize: "13px", fontWeight: 600, color: "#78350f", marginTop: "4px" }}>
        Question: {contradiction.sharedQuestion}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "10px" }}>
        <div style={{ padding: "8px", backgroundColor: "#ffffff", border: "1px solid #fde68a", borderRadius: "4px" }}>
          <div style={{ fontWeight: 600, fontSize: "12px", color: "#1e293b" }}>{contradiction.paperA.title}</div>
          <div style={{ fontSize: "12px", color: "#475569", marginTop: "2px" }}>Method: {contradiction.paperA.method}</div>
          <div style={{ fontSize: "12px", color: "#475569" }}>Result: {contradiction.paperA.result}</div>
        </div>

        <div style={{ padding: "8px", backgroundColor: "#ffffff", border: "1px solid #fde68a", borderRadius: "4px" }}>
          <div style={{ fontWeight: 600, fontSize: "12px", color: "#1e293b" }}>{contradiction.paperB.title}</div>
          <div style={{ fontSize: "12px", color: "#475569", marginTop: "2px" }}>Method: {contradiction.paperB.method}</div>
          <div style={{ fontSize: "12px", color: "#475569" }}>Result: {contradiction.paperB.result}</div>
        </div>
      </div>

      <div style={{ marginTop: "10px", fontSize: "12px", color: "#92400e" }}>
        <strong>Neutral Assessment:</strong> {contradiction.neutralNotice}
      </div>
    </div>
  );
};
