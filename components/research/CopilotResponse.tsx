import React from "react";
import { ResearchCopilotResponse } from "../../types/researchCopilot";
import { ClaimCard } from "./ClaimCard";
import { SourcePanel } from "./SourcePanel";
import { SuggestedResearchActions } from "./SuggestedResearchActions";
import { EvidenceCitation } from "./EvidenceCitation";

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  UNVERIFIED: { text: "Unverified: cited excerpts checked mechanically, not for logical support", color: "#92400e" },
  FALLBACK: { text: "No AI model was used: extractive summary only", color: "#92400e" },
  CONTENT_UNAVAILABLE: { text: "No paper content could be retrieved: nothing was analysed", color: "#b91c1c" },
  METADATA_ONLY: { text: "Only the paper's metadata is available: nothing was analysed", color: "#b91c1c" },
  NEEDS_CLARIFICATION: { text: "More information needed", color: "#475569" },
  FAILED: { text: "The request did not complete", color: "#b91c1c" }
};

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

      {STATUS_LABEL[response.status] && (
        <div role="status" style={{ marginTop: "8px", fontSize: "12px", fontWeight: 700, color: STATUS_LABEL[response.status].color }}>
          {STATUS_LABEL[response.status].text}
          {response.coverage ? ` · Coverage: ${response.coverage}` : ""}
          {response.cacheStatus === "HIT" || response.cacheStatus === "DEDUPLICATED" ? " · served from cache" : ""}
        </div>
      )}

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

        {response.claims.length > 0 && (
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: "8px" }}>
            Claims ({response.claims.length})
          </div>
        )}

        {response.claims.map(claim => (
          <ClaimCard key={claim.claimId} claim={claim} onInspectEvidence={onInspectEvidence} />
        ))}

        {response.limitations.length > 0 && (
          <ul style={{ margin: "12px 0 0 0", paddingLeft: "18px", fontSize: "12px", color: "#64748b" }}>
            {response.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}

        {response.evidence.length > 0 && (
          <div style={{ marginTop: "16px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: "4px" }}>
              Evidence the server retrieved ({response.evidence.length})
            </div>
            {response.evidence.map((e) => (
              <EvidenceCitation
                key={e.chunkId}
                chunkId={e.chunkId}
                paperTitle={response.sources[0]?.title || e.paperId}
                section={e.section}
                page={e.page}
                snippet={e.text}
              />
            ))}
          </div>
        )}

        <SuggestedResearchActions actions={response.suggestedActions} onActionClick={onActionClick} />
      </div>
    </div>
  );
};
