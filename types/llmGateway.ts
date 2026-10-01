/**
 * Production Provider-Agnostic LLM Gateway & Data Contracts for shoRDs
 * Defines normalized request/response schemas, error taxonomy, capabilities, and telemetry.
 */

export type LLMOperationType = "ASK" | "EXPLAIN" | "COMPARE" | "FIND_GAP" | "FIND_CONTRADICTION" | "SYNTHESIS" | "GENERAL";

export type LLMProviderType = "anthropic" | "openai" | "gemini" | "local_deterministic";

export type UserPlanTier = "FREE" | "PRO" | "INSTITUTION" | "ENTERPRISE";

export interface EvidenceContextChunk {
  chunkId: string;
  paperId: string;
  section: string;
  page: number;
  text: string;
}

export interface LLMRequest {
  requestId: string;
  tenantId: string;
  projectId: string;
  userIdHash: string;
  operation: LLMOperationType;
  prompt: string;
  systemPrompt?: string;
  evidenceChunks?: EvidenceContextChunk[];
  model?: string;
  provider?: LLMProviderType;
  /** Ignored by Anthropic Sonnet 5.5, which rejects non-default sampling values with HTTP 400. */
  temperature?: number;
  /** Anthropic only: reasoning/cost control, sent as output_config.effort. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxOutputTokens?: number;
  timeoutMs?: number;
  bypassCache?: boolean;
  metadata?: Record<string, any>;
  planTier?: UserPlanTier;
  paperId?: string;
  contentHash?: string;
  schemaVersion?: string;
}

export interface LLMResponse {
  requestId: string;
  provider: LLMProviderType;
  model: string;
  content: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  /** ESTIMATED = computed from token counts and a verified price table; NOT_AVAILABLE = no verified price (cost is 0, not real). */
  costStatus: "MEASURED" | "ESTIMATED" | "NOT_AVAILABLE";
  /** PROVIDER = token counts reported by the provider; ESTIMATED = approximated locally because the provider omitted usage. */
  usageSource?: "PROVIDER" | "ESTIMATED";
  latencyMs: number;
  finishReason: "STOP" | "LENGTH" | "ERROR" | "TIMEOUT";
  retryCount: number;
  cacheHit: boolean;
  fallbackUsed: boolean;
  primaryProviderFailed?: LLMProviderType;
  timestamp: string;
  promptVersion: string;
}

export type LLMErrorCategory =
  | "INVALID_CREDENTIAL"
  | "INSUFFICIENT_CREDITS"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "PROVIDER_5XX"
  | "INVALID_REQUEST"
  | "MODEL_UNAVAILABLE"
  | "CIRCUIT_OPEN"
  | "BUDGET_EXCEEDED"
  | "PRIVACY_RESTRICTED"
  | "REFUSAL"
  | "MALFORMED_RESPONSE"
  | "NO_TEXT_CONTENT"
  | "UNKNOWN";

export interface LLMErrorDetails {
  category: LLMErrorCategory;
  message: string;
  httpStatus?: number;
  provider: LLMProviderType;
  model?: string;
  retryable: boolean;
  sanitizedSummary: string;
}

export interface LLMCapabilities {
  provider: LLMProviderType;
  supportsStreaming: boolean;
  supportsStructuredOutputs: boolean;
  maxContextWindow: number;
  supportedModels: string[];
  defaultModel: string;
}

export interface LLMHealthStatus {
  provider: LLMProviderType;
  /** True only when a real request has succeeded and no failure has happened since; see `status` for the nuance. */
  healthy: boolean;
  status?: "NOT_CONFIGURED" | "CONFIGURED_UNVERIFIED" | "OK" | "DEGRADED";
  configured: boolean;
  latencyMs?: number;
  lastChecked: string;
  error?: string;
}

export interface LLMProvider {
  name: string;
  providerType: LLMProviderType;
  isConfigured(): boolean;
  getCapabilities(): LLMCapabilities;
  healthCheck(): Promise<LLMHealthStatus>;
  generate(request: LLMRequest): Promise<LLMResponse>;
}
