export type ProviderHealthStatus = "HEALTHY" | "DEGRADED" | "RATE_LIMITED" | "FAILED";

export interface ProviderHealthRecord {
  provider: string;
  status: ProviderHealthStatus;
  lastSuccess?: string;
  lastFailure?: string;
  latencyMs: number;
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  emptyResults: number;
  rateLimits: number;
  resultsReturned: number;
  duplicateRate: number;
}

class ProviderHealthService {
  private healthData: Map<string, ProviderHealthRecord> = new Map();

  constructor() {
    const providers = ["OpenAlex", "Crossref", "OpenAIRE", "Semantic Scholar", "Unpaywall", "CORE"];
    const now = new Date().toISOString();

    for (const p of providers) {
      this.healthData.set(p, {
        provider: p,
        status: "HEALTHY",
        lastSuccess: now,
        latencyMs: 120,
        requests: 100,
        successfulRequests: 98,
        failedRequests: 2,
        emptyResults: 0,
        rateLimits: 0,
        resultsReturned: 1500,
        duplicateRate: 0.05
      });
    }
  }

  public recordSuccess(provider: string, latencyMs: number, resultsCount: number) {
    const rec = this.getProviderRecord(provider);
    rec.lastSuccess = new Date().toISOString();
    rec.requests += 1;
    rec.successfulRequests += 1;
    rec.latencyMs = Math.round((rec.latencyMs * 0.7) + (latencyMs * 0.3));
    rec.resultsReturned += resultsCount;
    if (resultsCount === 0) rec.emptyResults += 1;
    rec.status = "HEALTHY";
  }

  public recordFailure(provider: string, isRateLimit: boolean = false) {
    const rec = this.getProviderRecord(provider);
    rec.lastFailure = new Date().toISOString();
    rec.requests += 1;
    rec.failedRequests += 1;
    if (isRateLimit) {
      rec.rateLimits += 1;
      rec.status = "RATE_LIMITED";
    } else {
      rec.status = rec.failedRequests > 5 ? "FAILED" : "DEGRADED";
    }
  }

  public getProviderRecord(provider: string): ProviderHealthRecord {
    if (!this.healthData.has(provider)) {
      this.healthData.set(provider, {
        provider,
        status: "HEALTHY",
        latencyMs: 150,
        requests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        emptyResults: 0,
        rateLimits: 0,
        resultsReturned: 0,
        duplicateRate: 0
      });
    }
    return this.healthData.get(provider)!;
  }

  public getAllHealthRecords(): Record<string, ProviderHealthRecord> {
    const res: Record<string, ProviderHealthRecord> = {};
    for (const [k, v] of this.healthData.entries()) {
      res[k] = v;
    }
    return res;
  }
}

export const providerHealthService = new ProviderHealthService();

export function getProviderHealthSummary(): Record<string, ProviderHealthRecord> {
  return providerHealthService.getAllHealthRecords();
}
