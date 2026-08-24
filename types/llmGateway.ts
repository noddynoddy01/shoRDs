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
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  bypassCache?: boolean;
  metadata?: Record<string, any>;
  planTier?: UserPlanTier;
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
  costStatus: "MEASURED" | "ESTIMATED" | "NOT_AVAILABLE";
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
  healthy: boolean;
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
