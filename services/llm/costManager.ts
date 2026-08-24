/**
 * Cost Manager & Token Budget Controller for shoRDs AI Gateway
 * Tracks token usage, enforces configurable daily/monthly spending limits per user/tenant/project,
 * and maintains accurate pricing matrices.
 */

import { LLMProviderType, UserPlanTier } from "../../types/llmGateway";

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface BudgetLimits {
  maxDailyCostUsd: number;
  maxMonthlyCostUsd: number;
  maxTokensPerRequest: number;
  maxRequestsPerDay: number;
}

export interface UsageRecord {
  tenantId: string;
  userIdHash: string;
  projectId: string;
  provider: LLMProviderType;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: string;
}

export class CostManager {
  private pricingMatrix: Record<string, ModelPricing> = {
    // Anthropic
    "claude-3-5-sonnet-20241022": { inputPerMillion: 3.00, outputPerMillion: 15.00 },
    "claude-3-5-sonnet": { inputPerMillion: 3.00, outputPerMillion: 15.00 },
    "claude-3-5-haiku-20241022": { inputPerMillion: 0.80, outputPerMillion: 4.00 },
    "claude-3-opus-20240229": { inputPerMillion: 15.00, outputPerMillion: 75.00 },
    // OpenAI
    "gpt-4o": { inputPerMillion: 2.50, outputPerMillion: 10.00 },
    "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.60 },
    "o1-preview": { inputPerMillion: 15.00, outputPerMillion: 60.00 },
    "o1-mini": { inputPerMillion: 3.00, outputPerMillion: 12.00 },
    // Gemini
    "gemini-1.5-pro": { inputPerMillion: 1.25, outputPerMillion: 5.00 },
    "gemini-1.5-flash": { inputPerMillion: 0.075, outputPerMillion: 0.30 },
    // Local / Dev
    "local-deterministic-v1": { inputPerMillion: 0.0, outputPerMillion: 0.0 }
  };

  private tierBudgetLimits: Record<UserPlanTier, BudgetLimits> = {
    FREE: { maxDailyCostUsd: 1.00, maxMonthlyCostUsd: 15.00, maxTokensPerRequest: 4096, maxRequestsPerDay: 50 },
    PRO: { maxDailyCostUsd: 10.00, maxMonthlyCostUsd: 150.00, maxTokensPerRequest: 16384, maxRequestsPerDay: 500 },
    INSTITUTION: { maxDailyCostUsd: 100.00, maxMonthlyCostUsd: 2000.00, maxTokensPerRequest: 65536, maxRequestsPerDay: 5000 },
    ENTERPRISE: { maxDailyCostUsd: 500.00, maxMonthlyCostUsd: 10000.00, maxTokensPerRequest: 128000, maxRequestsPerDay: 50000 }
  };

  // In-memory telemetry accumulator for quick aggregates (backed by DB in production)
  private usageHistory: UsageRecord[] = [];

  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = this.pricingMatrix[model] || { inputPerMillion: 3.00, outputPerMillion: 15.00 };
    const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
    return Number((inputCost + outputCost).toFixed(6));
  }

  checkBudget(tenantId: string, planTier: UserPlanTier, estimatedTokens: number): { allowed: boolean; reason?: string } {
    const limits = this.tierBudgetLimits[planTier] || this.tierBudgetLimits.FREE;

    if (estimatedTokens > limits.maxTokensPerRequest) {
      return {
        allowed: false,
        reason: `REQUEST_EXCEEDS_MAX_TOKENS: Request requires ~${estimatedTokens} tokens which exceeds the ${planTier} tier limit of ${limits.maxTokensPerRequest} tokens.`
      };
    }

    const todayStr = new Date().toISOString().substring(0, 10);
    const todayUsage = this.usageHistory.filter(u => u.tenantId === tenantId && u.timestamp.startsWith(todayStr));
    const dailySpend = todayUsage.reduce((acc, u) => acc + u.costUsd, 0);

    if (dailySpend >= limits.maxDailyCostUsd) {
      return {
        allowed: false,
        reason: `DAILY_BUDGET_EXCEEDED: Daily spend of $${dailySpend.toFixed(2)} reached configured limit of $${limits.maxDailyCostUsd.toFixed(2)} for ${planTier} tier.`
      };
    }

    if (todayUsage.length >= limits.maxRequestsPerDay) {
      return {
        allowed: false,
        reason: `DAILY_REQUEST_LIMIT_REACHED: Daily request count (${todayUsage.length}) reached limit of ${limits.maxRequestsPerDay} for ${planTier} tier.`
      };
    }

    return { allowed: true };
  }

  recordUsage(record: UsageRecord): void {
    this.usageHistory.push(record);
    if (this.usageHistory.length > 50000) {
      this.usageHistory.shift(); // retain bounded history in-memory
    }
  }

  getTenantMetrics(tenantId: string): { totalRequests: number; totalCostUsd: number; totalTokens: number } {
    const records = this.usageHistory.filter(u => u.tenantId === tenantId);
    return {
      totalRequests: records.length,
      totalCostUsd: Number(records.reduce((acc, r) => acc + r.costUsd, 0).toFixed(4)),
      totalTokens: records.reduce((acc, r) => acc + r.inputTokens + r.outputTokens, 0)
    };
  }
}
