# shoRDs Production Readiness Specification

This document defines the production hardening, security configurations, reliability limits, health checks, and privacy policies for the **shoRDs Research Intelligence OS**.

---

## 🔒 1. Environment Variables & Secret Isolation

| Variable Name | Scope | Sensitivity | Usage & Description |
| :--- | :--- | :--- | :--- |
| `UNPAYWALL_EMAIL` | **SERVER-SIDE ONLY** | Private | User-Agent contact for OpenAccess resolution gateway (`api.unpaywall.org`). **MUST NOT** use `EXPO_PUBLIC_` prefix! |
| `EXPO_PUBLIC_APP_VARIANT` | Client / Public | Public | Defines build environment (`development` \| `test` \| `production`). |
| `EXPO_PUBLIC_API_URL` | Client / Public | Public | Base endpoint URL for shoRDs backend gateway. |

> [!CAUTION]
> **Zero Client-Side Credentials Policy**: No private API key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `UNPAYWALL_EMAIL`) may be bundled into client-side JS bundles or assigned `EXPO_PUBLIC_` prefixes.

---

## 🛡️ 2. API Security & SSRF Protection

1. **SSRF URL Gating (`services/securityService.ts`)**:
   * Blocked schemes: `file:`, `javascript:`, `data:`.
   * Blocked hostnames & IPs: `localhost`, `127.0.0.1`, `0.0.0.0`, `169.254.169.254` (AWS metadata), `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`.
2. **Input Validation**:
   * Canonical paper IDs validated against path traversal (`..`, `\`).
   * Feed cursors strictly checked as positive integers (`1..10000`).
   * Request payload size capped at **5MB**.
3. **Error Sanitization**:
   * Production error responses return sanitized error codes (`INTERNAL_ERROR`, `UNAUTHORIZED`, `RATE_LIMITED`). Stack traces and internal file paths are stripped.

---

## ⚡ 3. Provider Reliability & Circuit Breaker Limits

* **Timeout**: 8,000 ms per provider HTTP request.
* **Retry Strategy**: Exponential backoff (max 3 retries).
* **Circuit Breaker**: Transitions provider status to `DEGRADED` after 3 consecutive failures; falls back to healthy providers (`OpenAlex`, `Crossref`, `Europe PMC`).
* **Controlled Concurrency**: Bounded concurrent batches (max 5 simultaneous provider calls) to prevent rate limiting.

---

## 🏥 4. Health & Readiness Endpoints

* **Health Endpoint**: `GET /health` -> Returns service status, uptime, provider health summary, and heap memory usage.
* **Readiness Endpoint**: `GET /ready` -> Returns `ready: true` if database and primary discovery gateways (`OpenAlex`, `Crossref`) are operational.

---

## 🔐 5. Privacy & Data Retention Policy

1. **User Interaction Retention**: Tracks `feed_session_id`, `canonical_paper_id`, `IMPRESSION`, `OPEN`, `SAVE`, `LIKE`, and `DISMISS`.
2. **Telemetry Invalidation**: Feed history window retains recent paper IDs for up to 30 days or 200 papers to prevent feed repetition.
3. **Document & Summary Cache**: Full-text extractions and verified summaries are cached by `canonical_paper_id` + `summaryVersion` to eliminate redundant AI calls.
