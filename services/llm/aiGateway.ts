/**
 * Central Provider-Agnostic AI Gateway for shoRDs Research Intelligence OS
 * Orchestrates Rate Limiting, Budget Controls, Semantic Caching, Request Deduplication,
 * Privacy Guards, Dynamic Model Routing, Circuit Breakers, Automated Retries, and Fallbacks.
 */

import {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMProviderType,
  LLMHealthStatus,
  LLMErrorCategory
} from "../../types/llmGateway";
import { AnthropicProvider } from "./providers/anthropicProvider";
import { OpenAIProvider } from "./providers/openaiProvider";
import { GeminiProvider } from "./providers/geminiProvider";
import { LocalDeterministicProvider } from "./providers/localDeterministicProvider";
import { ModelRouter } from "./modelRouter";
import { CostManager } from "./costManager";
import { CircuitBreaker } from "./circuitBreaker";
import { CacheManager } from "./cacheManager";
import { RequestDeduplicator } from "./requestDeduplicator";
import { RateLimiter } from "./rateLimiter";
import { PrivacyGuard } from "./privacyGuard";
import { PromptManager } from "./promptManager";

export class AIGateway {
  private static instance: AIGateway;
  private providers: Map<LLMProviderType, LLMProvider> = new Map();
  private router: ModelRouter;
  private costManager: CostManager;
  private circuitBreaker: CircuitBreaker;
  private cacheManager: CacheManager;
  private deduplicator: RequestDeduplicator;
  private rateLimiter: RateLimiter;
  private privacyGuard: PrivacyGuard;

  private fallbackEnabled: boolean = true;
  private fallbackChain: LLMProviderType[] = ["anthropic", "openai", "gemini", "local_deterministic"];

  constructor() {
    // Register all supported provider adapters
    this.registerProvider(new AnthropicProvider());
    this.registerProvider(new OpenAIProvider());
    this.registerProvider(new GeminiProvider());
    this.registerProvider(new LocalDeterministicProvider());

    this.router = new ModelRouter();
    this.costManager = new CostManager();
    this.circuitBreaker = new CircuitBreaker(3, 30000);
    this.cacheManager = new CacheManager();
    this.deduplicator = new RequestDeduplicator();
    this.rateLimiter = new RateLimiter();
    this.privacyGuard = new PrivacyGuard();
  }

  static getInstance(): AIGateway {
    if (!AIGateway.instance) {
      AIGateway.instance = new AIGateway();
    }
    return AIGateway.instance;
  }

  registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.providerType, provider);
  }

  getProvider(type: LLMProviderType): LLMProvider | undefined {
    return this.providers.get(type);
  }

  getCostManager(): CostManager {
    return this.costManager;
  }

  getCacheManager(): CacheManager {
    return this.cacheManager;
  }

  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  getPrivacyGuard(): PrivacyGuard {
    return this.privacyGuard;
  }

  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  async healthCheckAll(): Promise<Record<LLMProviderType, LLMHealthStatus>> {
    const statuses: any = {};
    for (const [type, provider] of this.providers.entries()) {
      statuses[type] = await provider.healthCheck();
    }
    return statuses;
  }

  /**
   * Main entrypoint for all Copilot and Research Engine LLM operations.
   */
  async execute(request: LLMRequest): Promise<LLMResponse> {
    // 1. Rate Limiting Check
    const rateCheck = this.rateLimiter.checkRateLimit(request);
    if (!rateCheck.allowed) {
      const err: any = new Error(`[RATE_LIMITED] Too many requests at ${rateCheck.scope} scope. Retry after ${rateCheck.retryAfterSeconds}s.`);
      err.category = "RATE_LIMITED";
      err.httpStatus = 429;
      throw err;
    }

    // 2. Token Budget & Spending Limits Check
    const estimatedTokens = Math.ceil((request.prompt.length + (request.systemPrompt?.length || 0)) / 4);
    const budgetCheck = this.costManager.checkBudget(request.tenantId, request.planTier || "PRO", estimatedTokens);
    if (!budgetCheck.allowed) {
      const err: any = new Error(`[BUDGET_EXCEEDED] ${budgetCheck.reason}`);
      err.category = "BUDGET_EXCEEDED";
      err.httpStatus = 402;
      throw err;
    }

    // 3. Check Semantic / Request Cache
    const cachedResponse = await this.cacheManager.get(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // 4. Request Deduplication (Coalescing in-flight requests)
    return this.deduplicator.coalesce(request, async () => {
      return this.executeWithRoutingAndFallback(request);
    });
  }

  private async executeWithRoutingAndFallback(request: LLMRequest): Promise<LLMResponse> {
    // Determine available, healthy providers
    const configuredProviders = Array.from(this.providers.values())
      .filter(p => p.isConfigured() && this.circuitBreaker.isAvailable(p.providerType))
      .map(p => p.providerType);

    // If no external providers are configured or healthy, allow local deterministic in development/test
    if (configuredProviders.length === 0) {
      configuredProviders.push("local_deterministic");
    }

    // Route request to appropriate provider & model
    const route = this.router.route(request, configuredProviders);
    let targetProviderType = route.provider;
    let targetModel = route.model;

    // Apply standardized prompts
    const systemPrompt = request.systemPrompt || PromptManager.buildSystemPrompt(request.operation);
    const sanitizedPrompt = this.privacyGuard.sanitizePrompt(request.prompt);
    const fullUserPrompt = PromptManager.buildUserPrompt({ ...request, prompt: sanitizedPrompt });

    const normalizedReq: LLMRequest = {
      ...request,
      prompt: fullUserPrompt,
      systemPrompt,
      model: targetModel,
      maxOutputTokens: route.maxTokens,
      temperature: route.temperature
    };

    // Execute with fallback chain if needed
    let lastError: any = null;
    let fallbackUsed = false;
    let primaryProviderFailed: LLMProviderType | undefined;

    const candidatesToTry: LLMProviderType[] = [targetProviderType];
    if (this.fallbackEnabled) {
      for (const p of this.fallbackChain) {
        if (!candidatesToTry.includes(p)) {
          candidatesToTry.push(p);
        }
      }
    }

    for (const providerType of candidatesToTry) {
      const provider = this.providers.get(providerType);
      if (!provider || !provider.isConfigured() || !this.circuitBreaker.isAvailable(providerType)) {
        continue;
      }

      // Check tenant privacy policies for this provider
      const privacyCheck = this.privacyGuard.validateRequest(request, providerType);
      if (!privacyCheck.allowed) {
        continue; // Skip disallowed provider
      }

      try {
        const response = await this.executeWithRetry(provider, normalizedReq);

        // Record circuit breaker success
        this.circuitBreaker.recordSuccess(providerType);

        // Record cost & usage
        this.costManager.recordUsage({
          tenantId: request.tenantId,
          userIdHash: request.userIdHash,
          projectId: request.projectId,
          provider: response.provider,
          model: response.model,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          costUsd: response.estimatedCostUsd,
          timestamp: response.timestamp
        });

        // Annotate response
        response.fallbackUsed = fallbackUsed;
        response.primaryProviderFailed = primaryProviderFailed;

        // Cache the response
        await this.cacheManager.set(request, response);

        return response;
      } catch (err: any) {
        lastError = err;
        const isFatal = err.category === "INVALID_CREDENTIAL" || err.category === "INSUFFICIENT_CREDITS";
        this.circuitBreaker.recordFailure(providerType, isFatal);

        if (!fallbackUsed) {
          fallbackUsed = true;
          primaryProviderFailed = providerType;
        }
      }
    }

    throw lastError || new Error("ALL_PROVIDERS_FAILED: No available LLM provider could fulfill the request.");
  }

  private async executeWithRetry(provider: LLMProvider, request: LLMRequest): Promise<LLMResponse> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      try {
        return await provider.generate(request);
      } catch (err: any) {
        const isRetryable = err.category === "RATE_LIMITED" || err.category === "TIMEOUT" || err.category === "NETWORK_ERROR" || err.category === "PROVIDER_5XX";
        if (attempt >= maxRetries || !isRetryable) {
          throw err;
        }

        // Exponential backoff with jitter
        const backoffMs = Math.min(500 * Math.pow(2, attempt) + Math.random() * 200, 3000);
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }

    throw new Error("RETRY_EXHAUSTED");
  }
}
