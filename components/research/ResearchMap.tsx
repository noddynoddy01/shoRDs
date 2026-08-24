import React from "react";
import { ResearchMap as IResearchMap, ResearchMapNode } from "../../types/researchCopilot";

interface ResearchMapProps {
  map: IResearchMap;
  onOpenEvidence: (chunkId: string) => void;
}

const renderNode = (node: ResearchMapNode, onOpenEvidence: (chunkId: string) => void, depth: number = 0): React.ReactNode => {
  return (
    <div key={node.id} style={{ marginLeft: `${depth * 16}px`, marginTop: "6px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 8px",
          backgroundColor: depth === 0 ? "#e2e8f0" : "#f8fafc",
          border: "1px solid #cbd5e1",
          borderRadius: "4px",
          fontSize: "12px"
        }}
      >
        <span style={{ fontWeight: 600, color: "#334155" }}>[{node.type}]</span>
        <span style={{ color: "#1e293b" }}>{node.label}</span>
        {node.provenanceChunkId && (
          <button
            onClick={() => onOpenEvidence(node.provenanceChunkId!)}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              color: "#2563eb",
              fontSize: "11px",
              cursor: "pointer",
              padding: 0
            }}
          >
            Evidence
          </button>
        )}
      </div>
      {node.children.map(child => renderNode(child, onOpenEvidence, depth + 1))}
    </div>
  );
};

export const ResearchMap: React.FC<ResearchMapProps> = ({ map, onOpenEvidence }) => {
  return (
    <div
      style={{
        padding: "16px",
        backgroundColor: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: "6px",
        marginTop: "16px"
      }}
    >
      <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a", marginBottom: "10px" }}>
        {map.title} ({map.totalNodes} Nodes)
      </div>
      {renderNode(map.rootNode, onOpenEvidence)}
    </div>
  );
};
