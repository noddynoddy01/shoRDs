/**
 * Model Router for shoRDs AI Gateway
 * Routes requests based on operation complexity, user plan tier, latency/cost trade-offs, and provider availability.
 */

import { LLMRequest, LLMOperationType, LLMProviderType, UserPlanTier } from "../../types/llmGateway";
import { AnthropicEffort, resolveAnthropicModel } from "./anthropicModels";

export interface ModelRouteDecision {
  provider: LLMProviderType;
  model: string;
  maxTokens: number;
  /** Used by providers that accept sampling parameters. Anthropic Sonnet 5.5 rejects non-default values, so it ignores this. */
  temperature: number;
  /** Anthropic only. */
  effort?: AnthropicEffort;
  reason: string;
}

/** Anthropic thinking tokens count toward max_tokens, so the budget must leave room for thinking plus the reply. */
const ANTHROPIC_DEFAULT_MAX_TOKENS = 16000;

export class ModelRouter {
  private defaultProvider: LLMProviderType;
  private defaultModel: string;

  constructor() {
    this.defaultProvider = (process.env.LLM_PROVIDER as LLMProviderType) || "anthropic";
    this.defaultModel = resolveAnthropicModel();
  }

  route(request: LLMRequest, availableProviders: LLMProviderType[]): ModelRouteDecision {
    // If request explicitly specifies provider & model, honor it if available
    if (request.provider && availableProviders.includes(request.provider)) {
      return {
        provider: request.provider,
        model: request.model || this.getModelForOperation(request.provider, request.operation, request.planTier || "PRO"),
        maxTokens: request.maxOutputTokens || this.defaultMaxTokens(request.provider, request.operation),
        temperature: request.temperature ?? 0.1,
        effort: request.provider === "anthropic" ? request.effort || this.getEffort(request.operation, request.planTier || "PRO") : undefined,
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
      maxTokens: request.maxOutputTokens || this.defaultMaxTokens(provider, request.operation),
      temperature: request.temperature ?? (request.operation === "FIND_CONTRADICTION" || request.operation === "FIND_GAP" ? 0.0 : 0.1),
      effort: provider === "anthropic" ? request.effort || this.getEffort(request.operation, planTier) : undefined,
      reason: `ROUTED_FOR_${request.operation}_TIER_${planTier}`
    };
  }

  private defaultMaxTokens(provider: LLMProviderType, operation: LLMOperationType): number {
    if (provider === "anthropic") return ANTHROPIC_DEFAULT_MAX_TOKENS;
    return operation === "COMPARE" || operation === "SYNTHESIS" ? 2048 : 1024;
  }

  /** FREE-tier simple operations use low effort on the same model instead of a separate small model. */
  private getEffort(operation: LLMOperationType, tier: UserPlanTier): AnthropicEffort {
    const isComplex = operation === "COMPARE" || operation === "FIND_GAP" || operation === "FIND_CONTRADICTION" || operation === "SYNTHESIS";
    if (tier === "FREE" && !isComplex) return "low";
    return "high";
  }

  private getModelForOperation(provider: LLMProviderType, operation: LLMOperationType, tier: UserPlanTier): string {
    if (provider === "local_deterministic") return "local-deterministic-v1";

    const isComplex = operation === "COMPARE" || operation === "FIND_GAP" || operation === "FIND_CONTRADICTION" || operation === "SYNTHESIS";

    if (provider === "anthropic") {
      // One configurable model (ANTHROPIC_MODEL); cost is tuned through effort, not by switching to a retired or unverified model.
      return resolveAnthropicModel();
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
