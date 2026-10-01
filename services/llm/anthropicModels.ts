/**
 * Anthropic model configuration shared by the TypeScript AI gateway.
 *
 * Source of truth for model status: https://platform.claude.com/docs/en/about-claude/model-deprecations
 * (checked 2026-10-01). The production entrypoint (backend/start_local_server.js) has an equivalent plain-JS
 * module, backend/llm/anthropicClient.js; keep the two lists in step.
 */

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";

export type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Models the API no longer serves. A configuration that names one is overridden rather than used. */
export const RETIRED_ANTHROPIC_MODELS: ReadonlySet<string> = new Set([
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-20240620",
  "claude-3-5-sonnet",
  "claude-3-5-sonnet-latest",
  "claude-3-7-sonnet-20250219",
  "claude-3-5-haiku-20241022",
  "claude-3-haiku-20240307",
  "claude-3-opus-20240229",
  "claude-3-sonnet-20240229",
  "claude-sonnet-4-20250514",
  "claude-opus-4-20250514",
  "claude-opus-4-1-20250805"
]);

/**
 * USD per million tokens, only for models whose price has been verified. Unlisted models have no price here:
 * callers must treat cost as unavailable instead of guessing.
 */
export const ANTHROPIC_PRICING_PER_MTOK: Readonly<Record<string, { input: number; output: number }>> = {
  "claude-sonnet-5-5": { input: 2, output: 10 }
};

/** ANTHROPIC_MODEL, then LLM_MODEL, then the default. Retired model IDs are never returned. */
export function resolveAnthropicModel(): string {
  const configured = (process.env.ANTHROPIC_MODEL || process.env.LLM_MODEL || "").trim();
  if (!configured || RETIRED_ANTHROPIC_MODELS.has(configured)) {
    return DEFAULT_ANTHROPIC_MODEL;
  }
  return configured;
}
