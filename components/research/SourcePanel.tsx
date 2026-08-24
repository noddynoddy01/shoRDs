import React from "react";

interface SourcePanelProps {
  sourcesCount: number;
  evidenceChunksCount: number;
  verifiedClaimsCount: number;
  rejectedClaimsCount: number;
}

export const SourcePanel: React.FC<SourcePanelProps> = ({
  sourcesCount,
  evidenceChunksCount,
  verifiedClaimsCount,
  rejectedClaimsCount
}) => {
  return (
    <div
      style={{
        display: "flex",
        gap: "16px",
        padding: "10px 14px",
        backgroundColor: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: "6px",
        fontSize: "12px",
        color: "#475569"
      }}
    >
      <div>
        <strong style={{ color: "#0f172a" }}>Sources:</strong> {sourcesCount} papers
      </div>
      <div>
        <strong style={{ color: "#0f172a" }}>Evidence:</strong> {evidenceChunksCount} chunks
      </div>
      <div>
        <strong style={{ color: "#15803d" }}>Verified:</strong> {verifiedClaimsCount} claims
      </div>
      {rejectedClaimsCount > 0 && (
        <div>
          <strong style={{ color: "#b91c1c" }}>Rejected:</strong> {rejectedClaimsCount} claims
        </div>
      )}
    </div>
  );
};
