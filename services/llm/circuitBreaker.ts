/**
 * Circuit Breaker for shoRDs AI Gateway
 * Prevents cascading provider failures by tripping to OPEN state after consecutive errors,
 * entering HALF_OPEN after a cooldown, and probing before full closure.
 */

import { LLMProviderType } from "../../types/llmGateway";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface ProviderCircuitStatus {
  provider: LLMProviderType;
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  nextProbeTime?: number;
}

export class CircuitBreaker {
  private failureThreshold: number;
  private cooldownMs: number;
  private circuits: Map<LLMProviderType, ProviderCircuitStatus> = new Map();

  constructor(failureThreshold: number = 3, cooldownMs: number = 30000) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
  }

  isAvailable(provider: LLMProviderType): boolean {
    const status = this.getOrCreateStatus(provider);
    const now = Date.now();

    if (status.state === "CLOSED") {
      return true;
    }

    if (status.state === "OPEN") {
      if (status.nextProbeTime && now >= status.nextProbeTime) {
        status.state = "HALF_OPEN";
        return true; // Allow single test probe
      }
      return false;
    }

    // HALF_OPEN
    return true;
  }

  recordSuccess(provider: LLMProviderType): void {
    const status = this.getOrCreateStatus(provider);
    status.consecutiveFailures = 0;
    status.lastSuccessTime = Date.now();
    status.state = "CLOSED";
    status.nextProbeTime = undefined;
  }

  recordFailure(provider: LLMProviderType, isFatalError: boolean = false): void {
    const status = this.getOrCreateStatus(provider);
    status.lastFailureTime = Date.now();
    status.consecutiveFailures++;

    if (isFatalError || status.consecutiveFailures >= this.failureThreshold || status.state === "HALF_OPEN") {
      status.state = "OPEN";
      status.nextProbeTime = Date.now() + this.cooldownMs;
    }
  }

  getStatus(provider: LLMProviderType): ProviderCircuitStatus {
    return { ...this.getOrCreateStatus(provider) };
  }

  resetAll(): void {
    this.circuits.clear();
  }

  private getOrCreateStatus(provider: LLMProviderType): ProviderCircuitStatus {
    if (!this.circuits.has(provider)) {
      this.circuits.set(provider, {
        provider,
        state: "CLOSED",
        consecutiveFailures: 0
      });
    }
    return this.circuits.get(provider)!;
  }
}
