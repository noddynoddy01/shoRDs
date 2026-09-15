/**
 * In-Flight Request Deduplicator & Coalescer for shoRDs AI Gateway
 * Prevents thunderous herd and duplicate provider requests when concurrent identical analyses
 * are submitted within the same tenant/project boundary.
 */

import { LLMRequest, LLMResponse } from "../../types/llmGateway";

export class RequestDeduplicator {
  private inFlightMap: Map<string, Promise<LLMResponse>> = new Map();

  generateDeduplicationKey(request: LLMRequest): string {
    const evidenceIds = (request.evidenceChunks || []).map(c => c.chunkId).sort().join(",");
    const paperId = request.paperId || "global";
    const contentHash = request.contentHash || "nohash";
    const schemaVersion = request.schemaVersion || "v1";
    return `${request.tenantId}:${request.projectId}:${paperId}:${contentHash}:${schemaVersion}:${request.operation}:${request.prompt.trim().toLowerCase()}:${evidenceIds}`;
  }

  async coalesce(request: LLMRequest, executeFn: () => Promise<LLMResponse>): Promise<LLMResponse> {
    const key = this.generateDeduplicationKey(request);

    if (this.inFlightMap.has(key)) {
      const sharedPromise = this.inFlightMap.get(key)!;
      const sharedResponse = await sharedPromise;
      return {
        ...sharedResponse,
        requestId: request.requestId, // retain current client's unique requestId
        cacheHit: true
      };
    }

    const promise = executeFn().finally(() => {
      this.inFlightMap.delete(key);
    });

    this.inFlightMap.set(key, promise);
    return promise;
  }

  getInFlightCount(): number {
    return this.inFlightMap.size;
  }
}
