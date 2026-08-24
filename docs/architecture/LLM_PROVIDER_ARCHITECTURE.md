# shoRDs Provider-Agnostic AI Gateway Architecture

## 1. Executive Summary

shoRDs decouples the Research Copilot and literature synthesis workflows from any single AI vendor. The application interacts exclusively with a normalized internal contract (`LLMRequest` / `LLMResponse`).

```
                    User / Client Request
                             │
                             ▼
                    shoRDs Express Gateway
                             │
                             ▼
               Authorization & Scope Filtering
                             │
                             ▼
             Evidence Retrieval & Chunk Selection
                             │
                             ▼
                    shoRDs AI Gateway
 ┌───────────────────────────┴───────────────────────────┐
 │                                                       │
 │  1. Rate Limiting (Global / Tenant / User)            │
 │  2. Token Budget & Daily Spend Verification           │
 │  3. Semantic & Hash Caching (Redis 7.2 Namespaces)    │
 │  4. In-Flight Request Coalescing (Deduplication)      │
 │  5. Privacy Guard & Institutional Data Restrictions   │
 │  6. Model Router (Operation & Tier Aware)             │
 │  7. Circuit Breaker & Health Tracking                 │
 │                                                       │
 └───────────────────────────┬───────────────────────────┘
                             │
                             ▼
                   Provider Adapters
      ┌──────────────────────┼──────────────────────┐
      │                      │                      │
 Anthropic Claude       OpenAI GPT-4o        Google Gemini
 (Sonnet / Haiku)       (4o / 4o-mini)       (Pro / Flash)
      │                      │                      │
      └──────────────────────┼──────────────────────┘
                             │
                             ▼
                   Normalized Response
                             │
                             ▼
               Candidate Claim Extraction
                             │
                             ▼
            Authoritative Claim Verification Gate
          (Grounds every claim against Chunk IDs)
                             │
                             ▼
                 Verified Response to Client
```

---

## 2. Supported Provider Adapters

| Provider | Adapter Path | Models Supported | Context Window |
|---|---|---|---|
| **Anthropic** | `services/llm/providers/anthropicProvider.ts` | `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, `claude-3-opus-20240229` | 200k tokens |
| **OpenAI** | `services/llm/providers/openaiProvider.ts` | `gpt-4o`, `gpt-4o-mini`, `o1-preview`, `o1-mini` | 128k tokens |
| **Google Gemini** | `services/llm/providers/geminiProvider.ts` | `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-2.0-flash-exp` | 1M tokens |
| **Local Deterministic** | `services/llm/providers/localDeterministicProvider.ts` | `local-deterministic-v1` (offline test/dev) | 32k tokens |

---

## 3. Dynamic Model Routing

Requests are dynamically mapped based on operation complexity and user plan tier:

- **Complex Synthesis** (`COMPARE`, `FIND_GAP`, `FIND_CONTRADICTION`, `SYNTHESIS`):
  - Anthropic: `claude-3-5-sonnet-20241022`
  - OpenAI: `gpt-4o`
  - Gemini: `gemini-1.5-pro`
- **Fast / Simple Inquiries** (`ASK`, `EXPLAIN`):
  - Free Tier: `claude-3-5-haiku-20241022` / `gpt-4o-mini` / `gemini-1.5-flash`
  - Pro / Enterprise Tier: `claude-3-5-sonnet-20241022` / `gpt-4o` / `gemini-1.5-pro`

---

## 4. Fundamental Law: Evidence is Authoritative

The LLM is **never** the source of truth.
1. The LLM produces an untrusted candidate synthesis.
2. The claim verifier independently verifies every claim against full-text chunk citations.
3. Unsupported claims are stripped from the response before serialization.
