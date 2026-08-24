# shoRDs LLM Cost Control & Token Budgeting Guide

## 1. Token Budget & Spending Limits

shoRDs implements multi-tier spending limits enforced server-side before calling external providers.

| Plan Tier | Daily Spend Cap | Monthly Spend Cap | Max Tokens / Request | Daily Request Limit |
|---|---|---|---|---|
| **FREE** | $1.00 | $15.00 | 4,096 tokens | 50 requests |
| **PRO** | $10.00 | $150.00 | 16,384 tokens | 500 requests |
| **INSTITUTION** | $100.00 | $2,000.00 | 65,536 tokens | 5,000 requests |
| **ENTERPRISE** | $500.00 | $10,000.00 | 128,000 tokens | 50,000 requests |

---

## 2. Pricing Matrix (Per 1 Million Tokens)

| Model | Input Price / M | Output Price / M |
|---|---|---|
| `claude-3-5-sonnet-20241022` | $3.00 | $15.00 |
| `claude-3-5-haiku-20241022` | $0.80 | $4.00 |
| `claude-3-opus-20240229` | $15.00 | $75.00 |
| `gpt-4o` | $2.50 | $10.00 |
| `gpt-4o-mini` | $0.15 | $0.60 |
| `gemini-1.5-pro` | $1.25 | $5.00 |
| `gemini-1.5-flash` | $0.075 | $0.30 |
| `local-deterministic-v1` | $0.00 | $0.00 |

---

## 3. Cost-Optimization Mechanisms

1. **Redis Semantic Caching**: Identical queries with identical evidence chunks retrieve cached results in <2ms, incurring $0.00 LLM costs.
2. **In-Flight Request Deduplication**: Concurrent identical analyses share a single in-flight LLM call.
3. **Tiered Routing**: Directing simple questions to Haiku / Mini reduces cost by up to 90%.
