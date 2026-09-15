export type StandardScholarlySection =
  | "TITLE"
  | "ABSTRACT"
  | "INTRODUCTION"
  | "BACKGROUND"
  | "RELATED_WORK"
  | "METHODOLOGY"
  | "DATASET"
  | "EXPERIMENTAL_SETUP"
  | "RESULTS"
  | "DISCUSSION"
  | "LIMITATIONS"
  | "CONCLUSION"
  | "FUTURE_WORK"
  | "REFERENCES"
  | "TABLE"
  | "FIGURE"
  | "OTHER";

/**
 * Normalizes variations in section headings into standardized scholarly taxonomy.
 * E.g. "Proposed Method", "Approach", "Architecture" -> "METHODOLOGY"
 */
export function normalizeScholarlySectionName(heading: string): StandardScholarlySection {
  if (!heading) return "OTHER";
  const clean = heading.trim().toLowerCase();

  if (clean.includes("abstract")) return "ABSTRACT";
  if (clean.includes("introduction")) return "INTRODUCTION";
  if (clean.includes("background") || clean.includes("context")) return "BACKGROUND";
  if (clean.includes("related work") || clean.includes("prior work")) return "RELATED_WORK";
  if (clean.includes("method") || clean.includes("approach") || clean.includes("architecture") || clean.includes("formulation") || clean.includes("algorithm")) return "METHODOLOGY";
  if (clean.includes("dataset") || clean.includes("corpus") || clean.includes("material")) return "DATASET";
  if (clean.includes("setup") || clean.includes("implementation") || clean.includes("experimental setup")) return "EXPERIMENTAL_SETUP";
  if (clean.includes("result") || clean.includes("finding") || clean.includes("evaluation") || clean.includes("experiment") || clean.includes("benchmark")) return "RESULTS";
  if (clean.includes("discussion")) return "DISCUSSION";
  if (clean.includes("limitation") || clean.includes("threats to validity")) return "LIMITATIONS";
  if (clean.includes("conclusion")) return "CONCLUSION";
  if (clean.includes("future") || clean.includes("outlook") || clean.includes("horizon")) return "FUTURE_WORK";
  if (clean.includes("reference") || clean.includes("bibliography")) return "REFERENCES";
  if (clean.includes("table")) return "TABLE";
  if (clean.includes("figure") || clean.includes("fig.")) return "FIGURE";

  return "OTHER";
}
