/**
 * Production Configuration & Fail-Fast Validator for shoRDs Research Intelligence OS (Phase 41)
 * Enforces provider-agnostic AI gateway configurations, secrets management,
 * and fail-fast invariants in production mode.
 */

import { LLMProviderType } from "../types/llmGateway";

export interface AppConfig {
  env: "development" | "staging" | "production" | "test";
  port: number;
  databaseUrl?: string;
  redisUrl?: string;
  llmApiKey?: string;
  llmProvider: LLMProviderType;
  llmModel: string;
  llmTimeoutMs: number;
  llmMaxRetries: number;
  llmCostControlEnabled: boolean;
  llmFallbackEnabled: boolean;
  llmCacheEnabled: boolean;
  sessionSecret: string;
  corsOrigins: string[];
  maxPayloadBytes: number;
  rateLimitMaxRpm: number;
}

export class ProductionConfigManager {
  private static instance: ProductionConfigManager;
  private config: AppConfig;

  constructor() {
    const env = (process.env.NODE_ENV as any) || "development";
    this.config = {
      env,
      port: parseInt(process.env.PORT || "4000", 10),
      databaseUrl: process.env.DATABASE_URL,
      redisUrl: process.env.REDIS_URL,
      llmApiKey: process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY,
      llmProvider: (process.env.LLM_PROVIDER as LLMProviderType) || "anthropic",
      llmModel: process.env.LLM_MODEL || "claude-3-5-sonnet-20241022",
      llmTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || "30000", 10),
      llmMaxRetries: parseInt(process.env.LLM_MAX_RETRIES || "3", 10),
      llmCostControlEnabled: process.env.LLM_COST_CONTROL_ENABLED !== "false",
      llmFallbackEnabled: process.env.LLM_FALLBACK_ENABLED !== "false",
      llmCacheEnabled: process.env.LLM_CACHE_ENABLED !== "false",
      sessionSecret: process.env.SESSION_SECRET || "shords_default_dev_secret_32_bytes_min!",
      corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:8081").split(","),
      maxPayloadBytes: 1024 * 1024 * 5, // 5MB limit
      rateLimitMaxRpm: parseInt(process.env.RATE_LIMIT_RPM || "300", 10)
    };
  }

  static getInstance(): ProductionConfigManager {
    if (!ProductionConfigManager.instance) {
      ProductionConfigManager.instance = new ProductionConfigManager();
    }
    return ProductionConfigManager.instance;
  }

  getConfig(): AppConfig {
    return this.config;
  }

  /**
   * Validates production configuration and enforces fail-fast invariants.
   */
  validateProductionReadiness(): { isValid: boolean; missingVariables: string[] } {
    const missing: string[] = [];
    if (this.config.env === "production") {
      if (!this.config.databaseUrl) missing.push("DATABASE_URL");
      if (!this.config.redisUrl) missing.push("REDIS_URL");
      if (!this.config.llmApiKey) missing.push("LLM_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY");
      if (this.config.sessionSecret.includes("default_dev_secret")) missing.push("SESSION_SECRET");
    }

    return {
      isValid: missing.length === 0,
      missingVariables: missing
    };
  }
}
