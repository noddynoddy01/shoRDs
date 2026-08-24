import React from "react";

interface EvidenceCitationProps {
  chunkId: string;
  paperTitle: string;
  section: string;
  page: number;
  snippet: string;
}

export const EvidenceCitation: React.FC<EvidenceCitationProps> = ({
  chunkId,
  paperTitle,
  section,
  page,
  snippet
}) => {
  return (
    <div
      style={{
        borderLeft: "3px solid #3b82f6",
        paddingLeft: "12px",
        marginTop: "8px",
        marginBottom: "8px"
      }}
    >
      <div style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>
        {paperTitle} — Section: {section}, Page {page}
      </div>
      <div style={{ fontSize: "13px", color: "#475569", marginTop: "2px", fontStyle: "italic" }}>
        "{snippet}"
      </div>
      <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>
        Chunk ID: {chunkId}
      </div>
    </div>
  );
};
