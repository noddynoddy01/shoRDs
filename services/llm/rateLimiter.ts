/**
 * Multi-Layered Rate Limiter for shoRDs AI Gateway
 * Enforces hierarchical RPM limits across Global, Tenant, User, and Project scopes.
 */

import { LLMRequest, UserPlanTier } from "../../types/llmGateway";

export interface RateLimitStatus {
  allowed: boolean;
  scope?: "GLOBAL" | "TENANT" | "USER" | "PROJECT";
  currentRpm?: number;
  maxRpm?: number;
  retryAfterSeconds?: number;
}

export class RateLimiter {
  private globalLimitRpm: number = 600;
  private tierUserRpm: Record<UserPlanTier, number> = {
    FREE: 10,
    PRO: 60,
    INSTITUTION: 300,
    ENTERPRISE: 600
  };

  private windowTracker: Map<string, number[]> = new Map();

  checkRateLimit(request: LLMRequest): RateLimitStatus {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // 1. Check Global RPM
    const globalCount = this.getAndPrune("global", oneMinuteAgo, now);
    if (globalCount >= this.globalLimitRpm) {
      return { allowed: false, scope: "GLOBAL", currentRpm: globalCount, maxRpm: this.globalLimitRpm, retryAfterSeconds: 5 };
    }

    // 2. Check Tenant RPM
    const tenantMax = (request.planTier === "ENTERPRISE" ? 1000 : (request.planTier === "INSTITUTION" ? 500 : 120));
    const tenantCount = this.getAndPrune(`tenant:${request.tenantId}`, oneMinuteAgo, now);
    if (tenantCount >= tenantMax) {
      return { allowed: false, scope: "TENANT", currentRpm: tenantCount, maxRpm: tenantMax, retryAfterSeconds: 10 };
    }

    // 3. Check User RPM
    const userMax = this.tierUserRpm[request.planTier || "PRO"] || 60;
    const userCount = this.getAndPrune(`user:${request.userIdHash}`, oneMinuteAgo, now);
    if (userCount >= userMax) {
      return { allowed: false, scope: "USER", currentRpm: userCount, maxRpm: userMax, retryAfterSeconds: 15 };
    }

    // Record the current hit across scopes
    this.recordHit("global", now);
    this.recordHit(`tenant:${request.tenantId}`, now);
    this.recordHit(`user:${request.userIdHash}`, now);

    return { allowed: true };
  }

  private getAndPrune(key: string, cutoff: number, now: number): number {
    const timestamps = (this.windowTracker.get(key) || []).filter(t => t > cutoff);
    this.windowTracker.set(key, timestamps);
    return timestamps.length;
  }

  private recordHit(key: string, now: number): void {
    const timestamps = this.windowTracker.get(key) || [];
    timestamps.push(now);
    this.windowTracker.set(key, timestamps);
  }

  reset(): void {
    this.windowTracker.clear();
  }
}
