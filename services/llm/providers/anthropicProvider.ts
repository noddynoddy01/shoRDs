/**
 * Anthropic Claude Provider Adapter for shoRDs AI Gateway
 * Implements Messages API with token/cost tracking, timeout, and sanitized error mapping.
 */

import { LLMProvider, LLMRequest, LLMResponse, LLMCapabilities, LLMHealthStatus, LLMProviderType, LLMErrorCategory } from "../../../types/llmGateway";

export class AnthropicProvider implements LLMProvider {
  name = "Anthropic Claude";
  providerType: LLMProviderType = "anthropic";
  private apiKey?: string;
  private defaultModel = "claude-3-5-sonnet-20241022";

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || process.env.LLM_API_KEY;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0 && !this.apiKey.includes("REPLACE_WITH"));
  }

  getCapabilities(): LLMCapabilities {
    return {
      provider: "anthropic",
      supportsStreaming: true,
      supportsStructuredOutputs: true,
      maxContextWindow: 200000,
      supportedModels: [
        "claude-3-5-sonnet-20241022",
        "claude-3-5-sonnet",
        "claude-3-5-haiku-20241022",
        "claude-3-opus-20240229"
      ],
      defaultModel: this.defaultModel
    };
  }

  async healthCheck(): Promise<LLMHealthStatus> {
    const lastChecked = new Date().toISOString();
    if (!this.isConfigured()) {
      return { provider: "anthropic", healthy: false, configured: false, lastChecked, error: "API Key not configured" };
    }
    return { provider: "anthropic", healthy: true, configured: true, lastChecked };
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw this.buildError("INVALID_CREDENTIAL", "Anthropic API key is not configured in server environment.", 401);
    }

    let model = request.model || this.defaultModel;
    if (model === "claude-3-5-sonnet") {
      model = "claude-3-5-sonnet-20241022";
    }

    const timeoutMs = request.timeoutMs || 30000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = performance.now();

    try {
      const messages = [{ role: "user", content: request.prompt }];
      const system = request.systemPrompt || "You are shoRDs Research Intelligence Copilot. All statements must be factual and grounded.";

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey!,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model,
          max_tokens: request.maxOutputTokens || 1024,
          system,
          messages,
          temperature: request.temperature ?? 0.1
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
        else if (resp.status === 400 && errText.toLowerCase().includes("credit balance")) cat = "INSUFFICIENT_CREDITS";
        else if (resp.status === 404) cat = "MODEL_UNAVAILABLE";
        else if (resp.status >= 500) cat = "PROVIDER_5XX";
        else if (resp.status === 400) cat = "INVALID_REQUEST";

        throw this.buildError(cat, `Anthropic HTTP ${resp.status}: ${errText.substring(0, 150)}`, resp.status);
      }

      const data: any = await resp.json();
      const content = data.content?.[0]?.text || "";
      const inputTokens = data.usage?.input_tokens || Math.ceil(request.prompt.length / 4);
      const outputTokens = data.usage?.output_tokens || Math.ceil(content.length / 4);

      // Model pricing: Claude 3.5 Sonnet: $3.00/M in, $15.00/M out; Haiku: $0.80/M in, $4.00/M out
      const isHaiku = model.includes("haiku");
      const costPerInput = isHaiku ? 0.0000008 : 0.000003;
      const costPerOutput = isHaiku ? 0.000004 : 0.000015;
      const estimatedCostUsd = (inputTokens * costPerInput) + (outputTokens * costPerOutput);

      return {
        requestId: request.requestId,
        provider: "anthropic",
        model,
        content,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd,
        costStatus: "MEASURED",
        latencyMs: t1 - t0,
        finishReason: data.stop_reason === "max_tokens" ? "LENGTH" : "STOP",
        retryCount: 0,
        cacheHit: false,
        fallbackUsed: false,
        timestamp: new Date().toISOString(),
        promptVersion: "2026.1"
      };
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        throw this.buildError("TIMEOUT", `Anthropic request timed out after ${timeoutMs}ms`, 504);
      }
      if (err.category) throw err;
      throw this.buildError("NETWORK_ERROR", `Network failure contacting Anthropic: ${err.message}`);
    }
  }

  private buildError(category: LLMErrorCategory, message: string, httpStatus?: number): Error & { category: LLMErrorCategory; httpStatus?: number } {
    const err: any = new Error(`[ANTHROPIC_${category}] ${message}`);
    err.category = category;
    err.httpStatus = httpStatus;
    return err;
  }
}
