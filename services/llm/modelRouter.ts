/**
 * Model Router for shoRDs AI Gateway
 * Routes requests based on operation complexity, user plan tier, latency/cost trade-offs, and provider availability.
 */

import { LLMRequest, LLMOperationType, LLMProviderType, UserPlanTier } from "../../types/llmGateway";

export interface ModelRouteDecision {
  provider: LLMProviderType;
  model: string;
  maxTokens: number;
  temperature: number;
  reason: string;
}

export class ModelRouter {
  private defaultProvider: LLMProviderType;
  private defaultModel: string;

  constructor() {
    this.defaultProvider = (process.env.LLM_PROVIDER as LLMProviderType) || "anthropic";
    this.defaultModel = process.env.LLM_MODEL || "claude-3-5-sonnet-20241022";
  }

  route(request: LLMRequest, availableProviders: LLMProviderType[]): ModelRouteDecision {
    // If request explicitly specifies provider & model, honor it if available
    if (request.provider && availableProviders.includes(request.provider)) {
      return {
        provider: request.provider,
        model: request.model || this.getModelForOperation(request.provider, request.operation, request.planTier || "PRO"),
        maxTokens: request.maxOutputTokens || 1024,
        temperature: request.temperature ?? 0.1,
        reason: "EXPLICIT_REQUEST_ROUTING"
      };
    }

    const provider = availableProviders.includes(this.defaultProvider)
      ? this.defaultProvider
      : (availableProviders[0] || "local_deterministic");

    const planTier: UserPlanTier = request.planTier || "PRO";
    const model = this.getModelForOperation(provider, request.operation, planTier);

    return {
      provider,
      model,
      maxTokens: request.maxOutputTokens || (request.operation === "COMPARE" || request.operation === "SYNTHESIS" ? 2048 : 1024),
      temperature: request.temperature ?? (request.operation === "FIND_CONTRADICTION" || request.operation === "FIND_GAP" ? 0.0 : 0.1),
      reason: `ROUTED_FOR_${request.operation}_TIER_${planTier}`
    };
  }

  private getModelForOperation(provider: LLMProviderType, operation: LLMOperationType, tier: UserPlanTier): string {
    if (provider === "local_deterministic") return "local-deterministic-v1";

    const isComplex = operation === "COMPARE" || operation === "FIND_GAP" || operation === "FIND_CONTRADICTION" || operation === "SYNTHESIS";

    if (provider === "anthropic") {
      if (tier === "FREE" && !isComplex) return "claude-3-5-haiku-20241022";
      return "claude-3-5-sonnet-20241022";
    }

    if (provider === "openai") {
      if (tier === "FREE" && !isComplex) return "gpt-4o-mini";
      return "gpt-4o";
    }

    if (provider === "gemini") {
      if (tier === "FREE" && !isComplex) return "gemini-1.5-flash";
      return "gemini-1.5-pro";
    }

    return this.defaultModel;
  }
}
