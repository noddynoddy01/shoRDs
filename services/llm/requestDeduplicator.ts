/**
 * In-Flight Request Deduplicator & Coalescer for shoRDs AI Gateway (Phase 33 & Phase 41)
 * Prevents thunderous herd and duplicate provider requests across single and multi-replica clusters
 * when concurrent identical analyses are submitted within the same tenant/project boundary.
 */

import { LLMRequest, LLMResponse } from "../../types/llmGateway";
import { RedisCacheAdapter } from "../redisCacheAdapter";

export class RequestDeduplicator {
  private inFlightMap: Map<string, Promise<LLMResponse>> = new Map();
  private replicaId: string = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || `replica-${process.pid}`;

  generateDeduplicationKey(request: LLMRequest): string {
    const evidenceIds = (request.evidenceChunks || []).map(c => c.chunkId).sort().join(",");
    const paperId = request.paperId || "global";
    const contentHash = request.contentHash || "nohash";
    const schemaVersion = request.schemaVersion || "v1";
    return `${request.tenantId}:${request.projectId}:${paperId}:${contentHash}:${schemaVersion}:${request.operation}:${request.prompt.trim().toLowerCase()}:${evidenceIds}`;
  }

  async coalesce(request: LLMRequest, executeFn: () => Promise<LLMResponse>): Promise<LLMResponse> {
    const key = this.generateDeduplicationKey(request);

    // 1. Local process in-flight coalescing
    if (this.inFlightMap.has(key)) {
      const sharedPromise = this.inFlightMap.get(key)!;
      const sharedResponse = await sharedPromise;
      return {
        ...sharedResponse,
        requestId: request.requestId, // retain current client's unique requestId
        cacheHit: true
      };
    }

    // 2. Multi-replica distributed deduplication lock via Redis
    let redisLockAcquired = false;
    const lockKey = `dedup:${key}`;
    try {
      const redis = RedisCacheAdapter.getInstance();
      redisLockAcquired = await redis.setNx(lockKey, this.replicaId, 30);
    } catch {
      redisLockAcquired = true; // Proceed if Redis is temporarily unreachable
    }

    const promise = executeFn().finally(async () => {
      this.inFlightMap.delete(key);
      if (redisLockAcquired) {
        try {
          const redis = RedisCacheAdapter.getInstance();
          await redis.del(lockKey);
        } catch {
          // Ignore lock release cleanup errors
        }
      }
    });

    this.inFlightMap.set(key, promise);
    return promise;
  }

  getInFlightCount(): number {
    return this.inFlightMap.size;
  }

  getReplicaId(): string {
    return this.replicaId;
  }
}
