# shoRDs LLM Resiliency & Failure Recovery Architecture

## 1. Error Taxonomy & Action Matrix

| Error Category | HTTP Code | Retryable? | Behavior |
|---|---|---|---|
| **INVALID_CREDENTIAL** | 401 / 403 | No | Immediate Fail-Fast; trips circuit; notifies admin |
| **INSUFFICIENT_CREDITS** | 400 / 402 | No | Immediate Fail-Fast; trips circuit; triggers billing alert |
| **RATE_LIMITED** | 429 | Yes | Exponential backoff with jitter (up to 3 retries) |
| **TIMEOUT** | 504 | Yes | 30s circuit breaker abort; fallback to secondary provider |
| **PROVIDER_5XX** | 500 / 502 / 503 | Yes | Retry with backoff; fallback to secondary provider |
| **BUDGET_EXCEEDED** | 402 | No | Rejection with clear tier limit explanation |
| **PRIVACY_RESTRICTED** | 403 | No | Rejection; blocks sending data to unapproved provider |

---

## 2. Circuit Breaker State Machine

```
   [ CLOSED ]  ──(3 consecutive failures)──>  [ OPEN ]
       ▲                                         │
       │                                   (30s cooldown)
       │                                         │
       │                                         ▼
   (probe OK)  <───────── Probe ───────────  [ HALF_OPEN ]
```

- **CLOSED**: Traffic flows normally.
- **OPEN**: Provider is bypassed; traffic is immediately routed to the next configured fallback provider in `LLM_FALLBACK_PROVIDERS`.
- **HALF_OPEN**: A single probe request tests recovery; if successful, circuit transitions to CLOSED.
