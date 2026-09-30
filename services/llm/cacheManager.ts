/**
 * Semantic & Request Caching Layer for shoRDs AI Gateway
 * Provides Redis-backed request caching with tenant isolation, TTL management,
 * evidence versioning, and cache hit/miss observability.
 */

import * as crypto from "crypto";
import { LLMRequest, LLMResponse } from "../../types/llmGateway";
import { RedisCacheAdapter } from "../redisCacheAdapter";

export interface CacheOptions {
  ttlSeconds?: number;
  namespacePrefix?: string;
}

export class CacheManager {
  private defaultTtlSeconds = 86400; // 24 hours
  private prefix = "shords:v1:llm";
  private localMemoryFallback: Map<string, { response: LLMResponse; expiresAt: number }> = new Map();

  generateCacheKey(request: LLMRequest, promptVersion: string = "2026.1"): string {
    // Incorporate normalized query, evidence IDs, operation, model, paperId, contentHash, schemaVersion, and prompt version
    const evidenceIds = (request.evidenceChunks || []).map(c => c.chunkId).sort().join(",");
    const paperId = request.paperId || "global";
    const contentHash = request.contentHash || "nohash";
    const schemaVersion = request.schemaVersion || "v1";
    const rawPayload = `${request.operation}:${paperId}:${contentHash}:${schemaVersion}:${request.prompt.trim().toLowerCase()}:${evidenceIds}:${request.model || "default"}:${promptVersion}`;
    const hash = crypto.createHash("sha256").update(rawPayload).digest("hex").substring(0, 32);

    return `${this.prefix}:${request.tenantId}:${request.projectId}:${paperId}:${hash}`;
  }

  async get(request: LLMRequest): Promise<LLMResponse | null> {
    if (request.bypassCache) {
      return null;
    }

    const key = this.generateCacheKey(request);

    // 1. Query Redis
    try {
      const redis = RedisCacheAdapter.getInstance();
      const raw = await redis.get(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          ...parsed,
          requestId: request.requestId,
          cacheHit: true,
          latencyMs: 1.2
        };
      }
    } catch {
      // Fall through to memory fallback
    }

    // 2. Local memory fallback
    const entry = this.localMemoryFallback.get(key);
    if (entry) {
      if (Date.now() > entry.expiresAt) {
        this.localMemoryFallback.delete(key);
        return null;
      }
      return {
        ...entry.response,
        requestId: request.requestId, // Preserve requesting client's correlation ID
        cacheHit: true,
        latencyMs: 1.5 // Cache retrieval latency
      };
    }

    return null;
  }

  async set(request: LLMRequest, response: LLMResponse, ttlSeconds?: number): Promise<void> {
    const key = this.generateCacheKey(request);
    const ttl = ttlSeconds || this.defaultTtlSeconds;
    const expiresAt = Date.now() + (ttl * 1000);

    // Write to Redis
    try {
      const redis = RedisCacheAdapter.getInstance();
      await redis.set(key, JSON.stringify(response), ttl);
    } catch {
      // Ignore Redis set failure, memory fallback saves it
    }

    this.localMemoryFallback.set(key, { response, expiresAt });
  }

  async invalidateTenantProject(tenantId: string, projectId: string): Promise<number> {
    const matchPrefix = `${this.prefix}:${tenantId}:${projectId}:`;
    let count = 0;
    for (const key of this.localMemoryFallback.keys()) {
      if (key.startsWith(matchPrefix)) {
        this.localMemoryFallback.delete(key);
        count++;
      }
    }
    return count;
  }

  clearAll(): void {
    this.localMemoryFallback.clear();
  }
}
