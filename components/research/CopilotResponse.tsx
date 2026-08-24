import React from "react";
import { ResearchCopilotResponse } from "../../types/researchCopilot";
import { ClaimCard } from "./ClaimCard";
import { SourcePanel } from "./SourcePanel";
import { SuggestedResearchActions } from "./SuggestedResearchActions";

interface CopilotResponseProps {
  response: ResearchCopilotResponse;
  onInspectEvidence: (claimId: string) => void;
  onActionClick: (action: any) => void;
}

export const CopilotResponse: React.FC<CopilotResponseProps> = ({
  response,
  onInspectEvidence,
  onActionClick
}) => {
  return (
    <div style={{ marginTop: "16px", marginBottom: "24px" }}>
      <SourcePanel
        sourcesCount={response.sources.length}
        evidenceChunksCount={response.evidence.length}
        verifiedClaimsCount={response.claims.filter(c => c.verificationStatus === "VERIFIED").length}
        rejectedClaimsCount={response.claims.filter(c => c.verificationStatus === "UNSUPPORTED").length}
      />

      <div
        style={{
          marginTop: "12px",
          padding: "16px",
          backgroundColor: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "6px"
        }}
      >
        <div style={{ fontSize: "15px", lineHeight: 1.6, color: "#0f172a", marginBottom: "16px" }}>
          {response.answer}
        </div>

        <div style={{ fontSize: "12px", fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: "8px" }}>
          Verified Underlying Claims ({response.claims.length})
        </div>

        {response.claims.map(claim => (
          <ClaimCard key={claim.claimId} claim={claim} onInspectEvidence={onInspectEvidence} />
        ))}

        <SuggestedResearchActions actions={response.suggestedActions} onActionClick={onActionClick} />
      </div>
    </div>
  );
};
