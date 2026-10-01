/**
 * Anthropic Claude Provider Adapter for shoRDs AI Gateway
 * Implements the Messages API for Claude Sonnet 5.5 with real token usage, honest cost status,
 * timeout, and sanitized error mapping.
 *
 * Sonnet 5.5 request rules (https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide):
 *  - temperature / top_p / top_k with a non-default value return HTTP 400, so they are never sent.
 *  - Adaptive thinking is on by default; `thinking: {type: "disabled"}` and `budget_tokens` return HTTP 400, so
 *    `thinking` is never sent. Reasoning depth is controlled with `output_config.effort`.
 *  - Thinking tokens count toward `max_tokens`; the reply can start with an (empty) `thinking` block, so the
 *    answer is read from `text` blocks, not from `content[0]`.
 */

import { LLMProvider, LLMRequest, LLMResponse, LLMCapabilities, LLMHealthStatus, LLMProviderType, LLMErrorCategory } from "../../../types/llmGateway";
import {
  ANTHROPIC_PRICING_PER_MTOK,
  AnthropicEffort,
  DEFAULT_ANTHROPIC_MODEL,
  RETIRED_ANTHROPIC_MODELS,
  resolveAnthropicModel
} from "../anthropicModels";

const DEFAULT_MAX_OUTPUT_TOKENS = 16000;
const DEFAULT_TIMEOUT_MS = 120000;

export class AnthropicProvider implements LLMProvider {
  name = "Anthropic Claude";
  providerType: LLMProviderType = "anthropic";
  private apiKey?: string;
  private lastOutcome: { ok: boolean; at: string; category?: LLMErrorCategory } | null = null;

  constructor(apiKey?: string) {
    const provider = (process.env.LLM_PROVIDER || "").trim().toLowerCase();
    const genericKey = provider === "" || provider === "anthropic" ? process.env.LLM_API_KEY : undefined;
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || genericKey;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0 && !this.apiKey.includes("REPLACE_WITH"));
  }

  getCapabilities(): LLMCapabilities {
    return {
      provider: "anthropic",
      supportsStreaming: false,
      supportsStructuredOutputs: false,
      maxContextWindow: 1_000_000,
      // Only models this request format has been checked against. Other Claude models may need different
      // thinking/effort settings, so they are not advertised until verified.
      supportedModels: [DEFAULT_ANTHROPIC_MODEL],
      defaultModel: resolveAnthropicModel()
    };
  }

  /**
   * No network probe is made (that would spend tokens). `healthy` is true only after a real request has
   * succeeded with no failure since; `status` distinguishes "never tried" from "failing".
   */
  async healthCheck(): Promise<LLMHealthStatus> {
    const lastChecked = new Date().toISOString();
    if (!this.isConfigured()) {
      return { provider: "anthropic", healthy: false, status: "NOT_CONFIGURED", configured: false, lastChecked, error: "API Key not configured" };
    }
    if (!this.lastOutcome) {
      return { provider: "anthropic", healthy: false, status: "CONFIGURED_UNVERIFIED", configured: true, lastChecked };
    }
    if (this.lastOutcome.ok) {
      return { provider: "anthropic", healthy: true, status: "OK", configured: true, lastChecked };
    }
    return { provider: "anthropic", healthy: false, status: "DEGRADED", configured: true, lastChecked, error: `Last request failed: ${this.lastOutcome.category}` };
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      throw this.buildError("INVALID_CREDENTIAL", "Anthropic API key is not configured in server environment.", 401);
    }

    const model = request.model && !RETIRED_ANTHROPIC_MODELS.has(request.model) ? request.model : resolveAnthropicModel();
    const effort: AnthropicEffort = request.effort || "high";
    const maxTokens = request.maxOutputTokens || DEFAULT_MAX_OUTPUT_TOKENS;
    const timeoutMs = request.timeoutMs || Number(process.env.LLM_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
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
        // No temperature/top_p/top_k and no `thinking` field: see the file header.
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          messages,
          output_config: { effort }
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
        else if (resp.status === 400 || resp.status === 413 || resp.status === 422) cat = "INVALID_REQUEST";

        throw this.buildError(cat, `Anthropic HTTP ${resp.status}: ${errText.substring(0, 150)}`, resp.status);
      }

      let data: any;
      try {
        data = await resp.json();
      } catch {
        throw this.buildError("MALFORMED_RESPONSE", "Anthropic returned a body that is not valid JSON.", resp.status);
      }
      if (!data || !Array.isArray(data.content)) {
        throw this.buildError("MALFORMED_RESPONSE", "Anthropic response has no content array.", resp.status);
      }
      if (data.stop_reason === "refusal") {
        throw this.buildError("REFUSAL", "The model declined to answer (stop_reason=refusal).");
      }

      const content: string = data.content
        .filter((b: any) => b && b.type === "text" && typeof b.text === "string")
        .map((b: any) => b.text)
        .join("");
      if (!content.trim()) {
        const why = data.stop_reason === "max_tokens"
          ? "the output budget was used up before any text was produced (thinking counts toward max_tokens)"
          : "the response contained no text block";
        throw this.buildError("NO_TEXT_CONTENT", `Anthropic returned no answer text: ${why}.`);
      }

      const usageReported = Number.isFinite(data.usage?.input_tokens) && Number.isFinite(data.usage?.output_tokens);
      const inputTokens: number = usageReported ? data.usage.input_tokens : Math.ceil(request.prompt.length / 4);
      const outputTokens: number = usageReported ? data.usage.output_tokens : Math.ceil(content.length / 4);

      const servedModel: string = typeof data.model === "string" && data.model ? data.model : model;
      const price = ANTHROPIC_PRICING_PER_MTOK[servedModel];
      const estimatedCostUsd = price ? (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output : 0;

      this.lastOutcome = { ok: true, at: new Date().toISOString() };
      return {
        requestId: request.requestId,
        provider: "anthropic",
        model: servedModel,
        content,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd,
        costStatus: price ? "ESTIMATED" : "NOT_AVAILABLE",
        usageSource: usageReported ? "PROVIDER" : "ESTIMATED",
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
      let out: Error & { category: LLMErrorCategory; httpStatus?: number };
      if (err.name === "AbortError") {
        out = this.buildError("TIMEOUT", `Anthropic request timed out after ${timeoutMs}ms`, 504);
      } else if (err.category) {
        out = err;
      } else {
        out = this.buildError("NETWORK_ERROR", `Network failure contacting Anthropic: ${err.message}`);
      }
      this.lastOutcome = { ok: false, at: new Date().toISOString(), category: out.category };
      throw out;
    }
  }

  private buildError(category: LLMErrorCategory, message: string, httpStatus?: number): Error & { category: LLMErrorCategory; httpStatus?: number } {
    const err: any = new Error(`[ANTHROPIC_${category}] ${message}`);
    err.category = category;
    err.httpStatus = httpStatus;
    return err;
  }
}
