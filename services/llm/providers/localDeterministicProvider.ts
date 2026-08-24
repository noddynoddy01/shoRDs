/**
 * Local Deterministic Provider Adapter for shoRDs AI Gateway
 * Used strictly for offline development, local unit testing, and isolated CI environments.
 */

import { LLMProvider, LLMRequest, LLMResponse, LLMCapabilities, LLMHealthStatus, LLMProviderType } from "../../../types/llmGateway";

export class LocalDeterministicProvider implements LLMProvider {
  name = "Local Deterministic Rule Engine";
  providerType: LLMProviderType = "local_deterministic";

  isConfigured(): boolean {
    return true;
  }

  getCapabilities(): LLMCapabilities {
    return {
      provider: "local_deterministic",
      supportsStreaming: false,
      supportsStructuredOutputs: true,
      maxContextWindow: 32000,
      supportedModels: ["local-deterministic-v1"],
      defaultModel: "local-deterministic-v1"
    };
  }

  async healthCheck(): Promise<LLMHealthStatus> {
    return {
      provider: "local_deterministic",
      healthy: true,
      configured: true,
      lastChecked: new Date().toISOString()
    };
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const t0 = performance.now();
    const content = "Deterministic evidence-backed analytical synthesis derived from verified full-text chunks.";
    const t1 = performance.now();
    const inputTokens = Math.ceil(request.prompt.length / 4);
    const outputTokens = Math.ceil(content.length / 4);

    return {
      requestId: request.requestId,
      provider: "local_deterministic",
      model: "local-deterministic-v1",
      content,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUsd: 0.0,
      costStatus: "MEASURED",
      latencyMs: t1 - t0,
      finishReason: "STOP",
      retryCount: 0,
      cacheHit: false,
      fallbackUsed: false,
      timestamp: new Date().toISOString(),
      promptVersion: "2026.1"
    };
  }
}
