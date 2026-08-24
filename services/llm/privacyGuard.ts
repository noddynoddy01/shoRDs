/**
 * Privacy Guard & Provider Data Handling Policy for shoRDs AI Gateway
 * Enforces institutional data residency, user privacy controls, and prevents sending restricted research
 * or private workspace notes to disallowed cloud providers.
 */

import { LLMRequest, LLMProviderType } from "../../types/llmGateway";

export interface TenantPrivacyPolicy {
  tenantId: string;
  allowedProviders: LLMProviderType[];
  allowThirdPartyCloud: boolean;
  sanitizeSensitivePii: boolean;
}

export class PrivacyGuard {
  private tenantPolicies: Map<string, TenantPrivacyPolicy> = new Map();

  setTenantPolicy(policy: TenantPrivacyPolicy): void {
    this.tenantPolicies.set(policy.tenantId, policy);
  }

  validateRequest(request: LLMRequest, targetProvider: LLMProviderType): { allowed: boolean; reason?: string } {
    const policy = this.tenantPolicies.get(request.tenantId);
    if (!policy) {
      return { allowed: true };
    }

    if (!policy.allowedProviders.includes(targetProvider)) {
      return {
        allowed: false,
        reason: `PRIVACY_POLICY_VIOLATION: Provider '${targetProvider}' is not approved for tenant '${request.tenantId}'. Approved providers: [${policy.allowedProviders.join(", ")}].`
      };
    }

    if (!policy.allowThirdPartyCloud && targetProvider !== "local_deterministic") {
      return {
        allowed: false,
        reason: `DATA_RESIDENCY_RESTRICTION: Tenant '${request.tenantId}' prohibits sending proprietary workspace data to third-party cloud providers.`
      };
    }

    return { allowed: true };
  }

  sanitizePrompt(prompt: string): string {
    // Redact accidental credit card numbers, SSNs, API key substrings, and private bearer tokens
    return prompt
      .replace(/\b[A-Za-z0-9_-]{20,}\b/g, (match) => match.startsWith("sk-") || match.startsWith("ghp_") ? "[REDACTED_SECRET]" : match)
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]")
      .replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, "[REDACTED_CARD]");
  }
}
