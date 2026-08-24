import React from "react";
import { SuggestedActionType } from "../../types/researchCopilot";

interface SuggestedActionItem {
  type: SuggestedActionType;
  label: string;
  payload: Record<string, string>;
}

interface SuggestedResearchActionsProps {
  actions: SuggestedActionItem[];
  onActionClick: (action: SuggestedActionItem) => void;
}

export const SuggestedResearchActions: React.FC<SuggestedResearchActionsProps> = ({
  actions,
  onActionClick
}) => {
  if (!actions.length) return null;

  return (
    <div style={{ marginTop: "14px" }}>
      <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", marginBottom: "6px" }}>
        Suggested Next Research Actions
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {actions.map((action, idx) => (
          <button
            key={idx}
            onClick={() => onActionClick(action)}
            style={{
              padding: "6px 12px",
              fontSize: "12px",
              fontWeight: 500,
              backgroundColor: "#f1f5f9",
              color: "#334155",
              border: "1px solid #cbd5e1",
              borderRadius: "4px",
              cursor: "pointer"
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
};
