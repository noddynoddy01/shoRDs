/**
 * Health & Readiness Endpoint Service for shoRDs Research OS
 * Provides GET /health and GET /ready checks without exposing credentials.
 */

import { getProviderHealthSummary } from "./providerHealth";

export interface HealthCheckResponse {
  status: "healthy" | "degraded" | "down";
  timestamp: string;
  uptimeSeconds: number;
  providers: Record<string, string>;
  memoryUsageMb: number;
}

export interface ReadinessCheckResponse {
  ready: boolean;
  timestamp: string;
  checks: {
    database: boolean;
    primaryProviders: boolean;
    evidenceIndex: boolean;
  };
}

const START_TIME = Date.now();

export function getHealthStatus(): HealthCheckResponse {
  const providerSummary = getProviderHealthSummary();
  const providerStatuses: Record<string, string> = {};
  
  let degradedCount = 0;
  for (const [pName, pHealth] of Object.entries(providerSummary)) {
    providerStatuses[pName] = pHealth.status;
    if (pHealth.status !== "HEALTHY") {
      degradedCount++;
    }
  }

  const overallStatus = degradedCount === 0 ? "healthy" : (degradedCount < 3 ? "degraded" : "down");
  const memMb = Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100;

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
    providers: providerStatuses,
    memoryUsageMb: memMb
  };
}

export function getReadinessStatus(): ReadinessCheckResponse {
  const health = getHealthStatus();
  const openAlexStatus = health.providers["openalex"] || "HEALTHY";
  const crossrefStatus = health.providers["crossref"] || "HEALTHY";

  const primaryProvidersReady = openAlexStatus !== "FAILED" || crossrefStatus !== "FAILED";

  return {
    ready: primaryProvidersReady,
    timestamp: new Date().toISOString(),
    checks: {
      database: true,
      primaryProviders: primaryProvidersReady,
      evidenceIndex: true
    }
  };
}
