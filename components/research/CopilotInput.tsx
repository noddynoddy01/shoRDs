import React, { useState } from "react";
import { CopilotMode } from "../../types/researchCopilot";

interface CopilotInputProps {
  onSend: (query: string, mode: CopilotMode) => void;
  isLoading: boolean;
}

export const CopilotInput: React.FC<CopilotInputProps> = ({ onSend, isLoading }) => {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<CopilotMode>("ASK");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isLoading) return;
    onSend(query.trim(), mode);
    setQuery("");
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: "16px" }}>
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
        {(["ASK", "COMPARE", "EXPLAIN", "FIND_GAP", "BUILD_RESEARCH_MAP"] as CopilotMode[]).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={{
              padding: "4px 8px",
              fontSize: "11px",
              fontWeight: 600,
              backgroundColor: mode === m ? "#1e293b" : "#f1f5f9",
              color: mode === m ? "#ffffff" : "#475569",
              border: "1px solid #cbd5e1",
              borderRadius: "4px",
              cursor: "pointer"
            }}
          >
            {m}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Ask an evidence-grounded research question..."
          disabled={isLoading}
          style={{
            flex: 1,
            padding: "10px 14px",
            fontSize: "14px",
            border: "1px solid #cbd5e1",
            borderRadius: "6px",
            outline: "none"
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !query.trim()}
          style={{
            padding: "10px 18px",
            backgroundColor: isLoading ? "#94a3b8" : "#2563eb",
            color: "#ffffff",
            border: "none",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: 600,
            cursor: isLoading ? "not-allowed" : "pointer"
          }}
        >
          {isLoading ? "Analyzing..." : "Query"}
        </button>
      </div>
    </form>
  );
};
