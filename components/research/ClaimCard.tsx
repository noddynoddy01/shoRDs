import React from "react";
import { ResearchCopilotClaim } from "../../types/researchCopilot";

interface ClaimCardProps {
  claim: ResearchCopilotClaim;
  onInspectEvidence: (claimId: string) => void;
}

export const ClaimCard: React.FC<ClaimCardProps> = ({ claim, onInspectEvidence }) => {
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: "6px",
        padding: "12px 16px",
        marginBottom: "10px",
        backgroundColor: "#ffffff"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: claim.verificationStatus === "VERIFIED" ? "#15803d" : "#b45309"
          }}
        >
          {claim.verificationStatus}
        </span>
        <button
          onClick={() => onInspectEvidence(claim.claimId)}
          style={{
            background: "none",
            border: "none",
            color: "#2563eb",
            fontSize: "12px",
            cursor: "pointer",
            fontWeight: 500,
            padding: 0
          }}
        >
          Inspect Evidence ({claim.evidenceChunkIds.length})
        </button>
      </div>
      <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: "#1e293b" }}>{claim.text}</p>
    </div>
  );
};
