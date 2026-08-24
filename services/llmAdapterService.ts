/**
 * Provider-Agnostic LLM Adapter & Gateway Bridge for shoRDs Research Intelligence OS (Phase 41)
 * Integrates the full multi-provider AI Gateway (Anthropic, OpenAI, Gemini, Local)
 * with backward compatibility for legacy Copilot controllers and pipelines.
 */

import { LLMProvider as LegacyLLMProvider, LLMProviderResult } from "../types/copilotObservability";
import { AIGateway } from "./llm/aiGateway";
import { LLMRequest } from "../types/llmGateway";

export { AIGateway } from "./llm/aiGateway";
export { AnthropicProvider } from "./llm/providers/anthropicProvider";
export { OpenAIProvider } from "./llm/providers/openaiProvider";
export { GeminiProvider } from "./llm/providers/geminiProvider";
export { LocalDeterministicProvider } from "./llm/providers/localDeterministicProvider";

export class LocalDeterministicModelProvider implements LegacyLLMProvider {
  name = "LocalDeterministicModel";

  isConfigured(): boolean {
    return true;
  }

  async generate(prompt: string, context: Record<string, any> = {}): Promise<LLMProviderResult> {
    const gateway = AIGateway.getInstance();
    const req: LLMRequest = {
      requestId: context.requestId || `loc_${Date.now()}`,
      tenantId: context.tenantId || "default_tenant",
      projectId: context.projectId || "default_project",
      userIdHash: context.userIdHash || "usr_hash_anonymous",
      operation: context.operation || "GENERAL",
      prompt,
      provider: "local_deterministic"
    };

    const res = await gateway.execute(req);

    return {
      model: res.model,
      provider: res.provider.toUpperCase(),
      requestId: res.requestId,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      latencyMs: res.latencyMs,
      finishReason: res.finishReason === "STOP" ? "STOP" : "LENGTH",
      content: res.content,
      retryCount: res.retryCount,
      costEstimatedUsd: res.estimatedCostUsd
    };
  }

  async stream(prompt: string, onChunk: (chunk: string) => void): Promise<LLMProviderResult> {
    const result = await this.generate(prompt, {});
    onChunk(result.content);
    return result;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

export class ExternalLLMModelProvider implements LegacyLLMProvider {
  name = "ExternalLLM";
  private gateway: AIGateway;

  constructor(apiKey?: string, provider?: "anthropic" | "openai" | "gemini", model?: string) {
    this.gateway = AIGateway.getInstance();
  }

  isConfigured(): boolean {
    const anthropic = this.gateway.getProvider("anthropic");
    const openai = this.gateway.getProvider("openai");
    const gemini = this.gateway.getProvider("gemini");
    return Boolean(
      (anthropic && anthropic.isConfigured()) ||
      (openai && openai.isConfigured()) ||
      (gemini && gemini.isConfigured())
    );
  }

  getProviderName(): string {
    const p = (process.env.LLM_PROVIDER || "anthropic").toUpperCase();
    return p;
  }

  getModelName(): string {
    return process.env.LLM_MODEL || "claude-3-5-sonnet-20241022";
  }

  async generate(prompt: string, context: Record<string, any> = {}): Promise<LLMProviderResult> {
    if (!this.isConfigured()) {
      throw new Error("LLM_STATUS = NOT_CONFIGURED: No active external LLM provider API key in environment.");
    }

    const req: LLMRequest = {
      requestId: context.requestId || `ext_${Date.now()}`,
      tenantId: context.tenantId || "default_tenant",
      projectId: context.projectId || "default_project",
      userIdHash: context.userIdHash || "usr_hash_anonymous",
      operation: context.operation || "ASK",
      prompt,
      evidenceChunks: context.evidenceChunks,
      model: context.model,
      provider: context.provider
    };

    const res = await this.gateway.execute(req);

    return {
      model: res.model,
      provider: res.provider.toUpperCase(),
      requestId: res.requestId,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      latencyMs: res.latencyMs,
      finishReason: res.finishReason === "STOP" ? "STOP" : "LENGTH",
      content: res.content,
      retryCount: res.retryCount,
      costEstimatedUsd: res.estimatedCostUsd
    };
  }

  async stream(prompt: string, onChunk: (chunk: string) => void): Promise<LLMProviderResult> {
    const result = await this.generate(prompt, {});
    onChunk(result.content);
    return result;
  }

  async healthCheck(): Promise<boolean> {
    return this.isConfigured();
  }
}
