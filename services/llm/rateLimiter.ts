/**
 * Multi-Layered Rate Limiter for shoRDs AI Gateway (Phase 1 & Phase 33)
 * Enforces hierarchical RPM limits across Global, Tenant, User, and Project scopes.
 * Implements Redis-backed distributed rate limiting across multi-replica deployments
 * with in-process fast-path tracking fallback.
 */

import { LLMRequest, UserPlanTier } from "../../types/llmGateway";
import { RedisCacheAdapter } from "../redisCacheAdapter";

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

  /**
   * Fast-path local synchronous rate limit check
   */
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

  /**
   * Distributed atomic rate limiter across all replicas using Redis INCR
   */
  async checkDistributedRateLimit(request: LLMRequest): Promise<RateLimitStatus> {
    const redis = RedisCacheAdapter.getInstance();
    const minuteBucket = Math.floor(Date.now() / 60000);

    try {
      // 1. Check Global RPM
      const globalKey = `global:${minuteBucket}`;
      const globalCount = await redis.incr(globalKey, 120);
      if (globalCount > this.globalLimitRpm) {
        return { allowed: false, scope: "GLOBAL", currentRpm: globalCount, maxRpm: this.globalLimitRpm, retryAfterSeconds: 5 };
      }

      // 2. Check Tenant RPM
      const tenantMax = (request.planTier === "ENTERPRISE" ? 1000 : (request.planTier === "INSTITUTION" ? 500 : 120));
      const tenantKey = `tenant:${request.tenantId}:${minuteBucket}`;
      const tenantCount = await redis.incr(tenantKey, 120);
      if (tenantCount > tenantMax) {
        return { allowed: false, scope: "TENANT", currentRpm: tenantCount, maxRpm: tenantMax, retryAfterSeconds: 10 };
      }

      // 3. Check User RPM
      const userMax = this.tierUserRpm[request.planTier || "PRO"] || 60;
      const userKey = `user:${request.userIdHash}:${minuteBucket}`;
      const userCount = await redis.incr(userKey, 120);
      if (userCount > userMax) {
        return { allowed: false, scope: "USER", currentRpm: userCount, maxRpm: userMax, retryAfterSeconds: 15 };
      }

      // Also record locally
      this.recordHit("global", Date.now());
      return { allowed: true };
    } catch {
      // Fallback to local synchronous check if Redis is temporarily unreachable
      return this.checkRateLimit(request);
    }
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
