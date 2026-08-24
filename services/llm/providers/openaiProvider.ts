/**
 * OpenAI Provider Adapter for shoRDs AI Gateway
 * Implements Chat Completions API with token/cost tracking, timeout, and sanitized error mapping.
 */

import { LLMProvider, LLMRequest, LLMResponse, LLMCapabilities, LLMHealthStatus, LLMProviderType, LLMErrorCategory } from "../../../types/llmGateway";

export class OpenAIProvider implements LLMProvider {
  name = "OpenAI GPT";
  providerType: LLMProviderType = "openai";
  private apiKey?: string;
  private defaultModel = "gpt-4o";

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0 && !this.apiKey.includes("REPLACE_WITH"));
  }

  getCapabilities(): LLMCapabilities {
    return {
      provider: "openai",
      supportsStreaming: true,
      supportsStructuredOutputs: true,
      maxContextWindow: 128000,
      supportedModels: ["gpt-4o", "gpt-4o-mini", "o1-preview", "o1-mini"],
      defaultModel: this.defaultModel
    };
  }

  async healthCheck(): Promise<LLMHealthStatus> {
    const lastChecked = new Date().toISOString();
    if (!this.isConfigured()) {
      return { provider: "openai", healthy: false, configured: false, lastChecked, error: "API Key not configured" };
    }
    return { provider: "openai", healthy: true, configured: true, lastChecked };
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw this.buildError("INVALID_CREDENTIAL", "OpenAI API key is not configured in server environment.", 401);
    }

    const model = request.model || this.defaultModel;
    const timeoutMs = request.timeoutMs || 30000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = performance.now();

    try {
      const messages: any[] = [];
      if (request.systemPrompt) {
        messages.push({ role: "system", content: request.systemPrompt });
      }
      messages.push({ role: "user", content: request.prompt });

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: request.temperature ?? 0.1,
          max_tokens: request.maxOutputTokens || 1024
        }),
        signal: controller.signal
      });

      clearTimeout(timer);
      const t1 = performance.now();

      if (!resp.ok) {
        const errText = await resp.text();
        let cat: LLMErrorCategory = "UNKNOWN";
        if (resp.status === 401 || resp.status === 403) cat = "INVALID_CREDENTIAL";
        else if (resp.status === 429) cat = "RATE_LIMITED";
        else if (resp.status === 400 && errText.toLowerCase().includes("quota")) cat = "INSUFFICIENT_CREDITS";
        else if (resp.status === 404) cat = "MODEL_UNAVAILABLE";
        else if (resp.status >= 500) cat = "PROVIDER_5XX";
        else if (resp.status === 400) cat = "INVALID_REQUEST";

        throw this.buildError(cat, `OpenAI HTTP ${resp.status}: ${errText.substring(0, 150)}`, resp.status);
      }

      const data: any = await resp.json();
      const content = data.choices?.[0]?.message?.content || "";
      const inputTokens = data.usage?.prompt_tokens || Math.ceil(request.prompt.length / 4);
      const outputTokens = data.usage?.completion_tokens || Math.ceil(content.length / 4);

      // Model pricing: GPT-4o: $2.50/M in, $10.00/M out; GPT-4o-mini: $0.15/M in, $0.60/M out
      const isMini = model.includes("mini");
      const costPerInput = isMini ? 0.00000015 : 0.0000025;
      const costPerOutput = isMini ? 0.0000006 : 0.000010;
      const estimatedCostUsd = (inputTokens * costPerInput) + (outputTokens * costPerOutput);

      return {
        requestId: request.requestId,
        provider: "openai",
        model,
        content,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd,
        costStatus: "MEASURED",
        latencyMs: t1 - t0,
        finishReason: data.choices?.[0]?.finish_reason === "length" ? "LENGTH" : "STOP",
        retryCount: 0,
        cacheHit: false,
        fallbackUsed: false,
        timestamp: new Date().toISOString(),
        promptVersion: "2026.1"
      };
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        throw this.buildError("TIMEOUT", `OpenAI request timed out after ${timeoutMs}ms`, 504);
      }
      if (err.category) throw err;
      throw this.buildError("NETWORK_ERROR", `Network failure contacting OpenAI: ${err.message}`);
    }
  }

  private buildError(category: LLMErrorCategory, message: string, httpStatus?: number): Error & { category: LLMErrorCategory; httpStatus?: number } {
    const err: any = new Error(`[OPENAI_${category}] ${message}`);
    err.category = category;
    err.httpStatus = httpStatus;
    return err;
  }
}
