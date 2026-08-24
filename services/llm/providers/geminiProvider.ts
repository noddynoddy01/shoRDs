/**
 * Google Gemini Provider Adapter for shoRDs AI Gateway
 * Implements Gemini REST API with token/cost tracking, timeout, and sanitized error mapping.
 */

import { LLMProvider, LLMRequest, LLMResponse, LLMCapabilities, LLMHealthStatus, LLMProviderType, LLMErrorCategory } from "../../../types/llmGateway";

export class GeminiProvider implements LLMProvider {
  name = "Google Gemini";
  providerType: LLMProviderType = "gemini";
  private apiKey?: string;
  private defaultModel = "gemini-1.5-pro";

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.LLM_API_KEY;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0 && !this.apiKey.includes("REPLACE_WITH"));
  }

  getCapabilities(): LLMCapabilities {
    return {
      provider: "gemini",
      supportsStreaming: true,
      supportsStructuredOutputs: true,
      maxContextWindow: 1000000,
      supportedModels: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash-exp"],
      defaultModel: this.defaultModel
    };
  }

  async healthCheck(): Promise<LLMHealthStatus> {
    const lastChecked = new Date().toISOString();
    if (!this.isConfigured()) {
      return { provider: "gemini", healthy: false, configured: false, lastChecked, error: "API Key not configured" };
    }
    return { provider: "gemini", healthy: true, configured: true, lastChecked };
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw this.buildError("INVALID_CREDENTIAL", "Gemini API key is not configured in server environment.", 401);
    }

    const model = request.model || this.defaultModel;
    const timeoutMs = request.timeoutMs || 30000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = performance.now();

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
      const contents: any[] = [];
      if (request.systemPrompt) {
        contents.push({ role: "user", parts: [{ text: `System Instruction: ${request.systemPrompt}` }] });
      }
      contents.push({ role: "user", parts: [{ text: request.prompt }] });

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: request.temperature ?? 0.1,
            maxOutputTokens: request.maxOutputTokens || 1024
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timer);
      const t1 = performance.now();

      if (!resp.ok) {
        const errText = await resp.text();
        let cat: LLMErrorCategory = "UNKNOWN";
        if (resp.status === 400 && errText.toLowerCase().includes("key")) cat = "INVALID_CREDENTIAL";
        else if (resp.status === 429) cat = "RATE_LIMITED";
        else if (resp.status === 404) cat = "MODEL_UNAVAILABLE";
        else if (resp.status >= 500) cat = "PROVIDER_5XX";
        else if (resp.status === 400) cat = "INVALID_REQUEST";

        throw this.buildError(cat, `Gemini HTTP ${resp.status}: ${errText.substring(0, 150)}`, resp.status);
      }

      const data: any = await resp.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const inputTokens = data.usageMetadata?.promptTokenCount || Math.ceil(request.prompt.length / 4);
      const outputTokens = data.usageMetadata?.candidatesTokenCount || Math.ceil(content.length / 4);

      // Model pricing: Gemini 1.5 Pro: $1.25/M in, $5.00/M out; Flash: $0.075/M in, $0.30/M out
      const isFlash = model.includes("flash");
      const costPerInput = isFlash ? 0.000000075 : 0.00000125;
      const costPerOutput = isFlash ? 0.00000030 : 0.0000050;
      const estimatedCostUsd = (inputTokens * costPerInput) + (outputTokens * costPerOutput);

      return {
        requestId: request.requestId,
        provider: "gemini",
        model,
        content,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd,
        costStatus: "MEASURED",
        latencyMs: t1 - t0,
        finishReason: data.candidates?.[0]?.finishReason === "MAX_TOKENS" ? "LENGTH" : "STOP",
        retryCount: 0,
        cacheHit: false,
        fallbackUsed: false,
        timestamp: new Date().toISOString(),
        promptVersion: "2026.1"
      };
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        throw this.buildError("TIMEOUT", `Gemini request timed out after ${timeoutMs}ms`, 504);
      }
      if (err.category) throw err;
      throw this.buildError("NETWORK_ERROR", `Network failure contacting Gemini: ${err.message}`);
    }
  }

  private buildError(category: LLMErrorCategory, message: string, httpStatus?: number): Error & { category: LLMErrorCategory; httpStatus?: number } {
    const err: any = new Error(`[GEMINI_${category}] ${message}`);
    err.category = category;
    err.httpStatus = httpStatus;
    return err;
  }
}
