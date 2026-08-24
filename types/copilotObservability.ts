/**
 * Production Observability, LLM Adapter & Copilot Execution Pipeline Entities (Phase 39)
 * Defines strongly typed execution stage telemetries, provider adapters, alert thresholds, and HTTP contracts.
 */

export interface CopilotQueryRequest {
  query: string;
  scope: "GLOBAL_PUBLIC" | "USER_PRIVATE" | "PROJECT_PRIVATE";
  projectId?: string;
  paperIds?: string[];
  evidenceIds?: string[];
  activeQuestionId?: string;
  conversationId?: string;
}

export interface CopilotResponseClaim {
  claimId: string;
  text: string;
  verificationStatus: "VERIFIED" | "PARTIALLY_VERIFIED" | "UNSUPPORTED" | "NEEDS_REVIEW";
  evidenceChunkIds: string[];
  paperIds: string[];
}

export interface CopilotResponse {
  requestId: string;
  status: "VERIFIED" | "PARTIALLY_VERIFIED" | "INSUFFICIENT_EVIDENCE" | "FAILED";
  answer: string;
  claims: CopilotResponseClaim[];
  evidence: { chunkId: string; paperId: string; section: string; page: number; text: string }[];
  uncertainty?: string;
  queryType: string;
  latencyMs: number;
  modelVersion: string;
  modelMode: "LOCAL_DETERMINISTIC" | "EXTERNAL_LLM";
}

export interface StageTelemetry {
  stage: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  status: "OK" | "FAILED" | "SKIPPED";
  cacheHit: boolean;
  errorCode?: string;
}

export interface ExecutionTrace {
  requestId: string;
  userIdHash: string;
  projectId?: string;
  queryType: string;
  totalRequestMs: number;
  stages: {
    authMs: number;
    validationMs: number;
    intentMs: number;
    entityResolutionMs: number;
    queryPlanningMs: number;
    graphMs: number;
    evidenceMs: number;
    contextAssemblyMs: number;
    llmMs: number;
    claimVerificationMs: number;
    serializationMs: number;
  };
  claimsCandidateCount: number;
  claimsVerifiedCount: number;
  claimsRejectedCount: number;
  unsupportedClaimsToUI: number;
  cacheHit: boolean;
}

export interface LLMProviderResult {
  model: string;
  provider: string;
  requestId: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  finishReason: "STOP" | "LENGTH" | "ERROR";
  content: string;
  retryCount: number;
  costEstimatedUsd?: number;
}

export interface LLMProvider {
  name: string;
  isConfigured(): boolean;
  generate(prompt: string, context: Record<string, any>): Promise<LLMProviderResult>;
  stream(prompt: string, onChunk: (chunk: string) => void): Promise<LLMProviderResult>;
  healthCheck(): Promise<boolean>;
}

export interface ObservabilityAlertThresholds {
  copilotP95MaxMs: number; // default: 2000
  copilotP99MaxMs: number; // default: 5000
  maxLlmErrorRate: number; // default: 0.05
  maxEvidenceFailureRate: number; // default: 0.01
  maxUnsupportedClaimRate: number; // default: 0.00
  minCacheHitRate: number; // default: 0.70
  maxDbErrorRate: number; // default: 0.01
  maxHttp5xxRate: number; // default: 0.01
}
