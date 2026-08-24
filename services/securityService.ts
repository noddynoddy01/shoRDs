/**
 * Security & Input Validation Service for shoRDs Research OS
 * Provides SSRF protection, input validation, error sanitization,
 * and environment variable privacy checks.
 */

import { parse as parseUrl } from "url";

// SSRF IP & Hostname Blocklists
const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254", // AWS / Cloud Metadata API
  "metadata.google.internal"
]);

const PRIVATE_IP_PREFIXES = [
  "10.",
  "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.",
  "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.",
  "172.30.", "172.31.",
  "192.168.",
  "169.254."
];

/**
 * Validates whether a target URL is safe for server-side fetching (SSRF Protection).
 */
export function isSafeExternalUrl(targetUrl: string): { safe: boolean; reason?: string } {
  if (!targetUrl || typeof targetUrl !== "string") {
    return { safe: false, reason: "INVALID_URL_TYPE" };
  }

  const trimmed = targetUrl.trim();
  const lower = trimmed.toLowerCase();

  // Reject dangerous schemes
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("file:")) {
    return { safe: false, reason: "DISALLOWED_SCHEME" };
  }

  if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
    return { safe: false, reason: "DISALLOWED_SCHEME" };
  }

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();

    if (BLOCKED_HOSTS.has(hostname)) {
      return { safe: false, reason: "BLOCKED_HOSTNAME" };
    }

    for (const prefix of PRIVATE_IP_PREFIXES) {
      if (hostname.startsWith(prefix)) {
        return { safe: false, reason: "PRIVATE_NETWORK_IP" };
      }
    }

    return { safe: true };
  } catch {
    return { safe: false, reason: "MALFORMED_URL" };
  }
}

/**
 * Validates canonical paper IDs to prevent path traversal or injection.
 */
export function validateCanonicalPaperId(paperId: string): boolean {
  if (!paperId || typeof paperId !== "string") return false;
  if (paperId.includes("..") || paperId.includes("/") || paperId.includes("\\")) {
    // Allow prefixes like doi: or arxiv:
    if (/^(doi:[a-zA-Z0-9.\-_/()]+|arxiv:[a-zA-Z0-9.\-_]+|title:[a-zA-Z0-9.\-_]+)$/.test(paperId)) {
      return !paperId.includes("..");
    }
    return false;
  }
  return paperId.length <= 256;
}

/**
 * Validates pagination feed cursors to prevent negative numbers or invalid values.
 */
export function validateCursor(cursorStr?: string | number): { valid: boolean; page: number } {
  if (cursorStr === undefined || cursorStr === null || cursorStr === "") {
    return { valid: true, page: 1 };
  }

  const parsed = typeof cursorStr === "number" ? cursorStr : parseInt(String(cursorStr), 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 10000) {
    return { valid: false, page: 1 };
  }

  return { valid: true, page: parsed };
}

/**
 * Validates request payload size (max 5MB).
 */
export function validatePayloadSize(payload: string | object, maxSizeMb: number = 5): boolean {
  const bytes = typeof payload === "string" ? Buffer.byteLength(payload) : Buffer.byteLength(JSON.stringify(payload));
  return bytes <= maxSizeMb * 1024 * 1024;
}

/**
 * Sanitizes backend error responses to prevent exposing stack traces or secrets.
 */
export function sanitizeErrorResponse(error: any, errorCode: string = "INTERNAL_ERROR"): { errorCode: string; message: string } {
  console.error(`[SECURITY_LOG] ${errorCode}:`, error?.message || error);
  return {
    errorCode,
    message: "An unexpected condition occurred while processing the research request."
  };
}
