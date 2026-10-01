# AI Runtime Audit (2026-10-01)

Scope: the code that actually serves `/api/v1/copilot/query`, `/api/v1/llm/*`, `/ready` and `/api/v1/analysis` in production.
Method: read the code and ran it. Statements here are about this commit, not about earlier reports.

## What actually runs

Docker and `railway.json` both start `node backend/start_local_server.js`. That entrypoint requires only `http`, `net`, and the modules in `backend/llm/`.
It does **not** import anything from `services/` (TypeScript AI gateway, Redis cache, rate limiter, deduplicator, circuit breaker).

| Concern | State on the production request path |
| --- | --- |
| Claude call | `backend/llm/anthropicClient.js`, model `claude-sonnet-5-5` (configurable with `ANTHROPIC_MODEL`) |
| Paper content | Only what the caller sends as `evidenceChunks`. No retrieval is wired. No content means no model call. |
| Verification | None. Model output is labelled `UNVERIFIED`; local output `FALLBACK`; no content `CONTENT_UNAVAILABLE`. `VERIFIED` is never emitted here. |
| Telemetry | Real per-replica counters (`backend/llm/telemetry.js`); unmeasured values are `null` / `NOT_MEASURED` |
| Cache / dedup / rate limit | **Not wired** (reported as `NOT_WIRED` in `/api/v1/llm/metrics`) |
| Authentication | **Presence of an `Authorization` header only.** Any string passes. |
| CORS | `Access-Control-Allow-Origin: *` |
| Body size | Capped for `/api/v1/copilot/query` (`MAX_REQUEST_BODY_BYTES`, default 524288). Not capped for `/api/v1/analysis`. |

## Sonnet 5.5 request rules (from the current docs)

- Non-default `temperature`, `top_p`, `top_k` return 400 (never sent).
- `thinking` is never sent: adaptive thinking is the default; `disabled` and `budget_tokens` return 400.
- Effort is `output_config.effort` (`low|medium|high|xhigh|max`, default `high`).
- Thinking counts toward `max_tokens`; the first content block can be an empty `thinking` block, so the answer is read from `text` blocks.
- `stop_reason` can be `refusal` and `model_context_window_exceeded`.
- Retired (requests fail): `claude-3-5-sonnet-20241022`, `claude-3-7-sonnet-20250219`, `claude-3-5-haiku-20241022`, `claude-3-opus-20240229`. A configured retired model is overridden and flagged in `/api/v1/llm/health`.
- Price used for estimates: $2 / $10 per million input/output tokens (docs models overview). Unlisted models get no cost. The Console invoice is the source of truth.

Not yet confirmed against the live API: the request body has been checked against the docs and mocked tests only. A deliberately invalid key was used once to confirm the real HTTPS path and 401 mapping.

## Still open (in the order of the handoff phases)

- Real authentication, origin allow-list and Redis rate limiting before `ANTHROPIC_API_KEY` is added (hard requirement).
- Paper retrieval/grounding and claim-to-evidence verification (the endpoint currently relies on caller-supplied chunks).
- `/ready` reports `aiGateway: true` unconditionally and reports database/Redis as alive when their URLs are unset.
- `/api/v1/analysis`: jobs live in a per-replica in-memory `Map`, are advanced by `setTimeout`, complete with a templated result labelled `VERIFIED`, and are not visible to the other replica.
- Hardcoded fixtures (`0.924`, `chunk_1842`, `openalex-W123`) remain in `services/researchCopilotService.ts`, `services/researchMapService.ts`, `services/researchQueryEngine.ts`; not yet classified as production vs demo.
- Full `npx tsc --noEmit` and `npm ci` could not run in the audit environment (npm policy 403 on `yocto-queue@0.1.0`). The Docker build runs `tsc --noEmit`, so the first CI/Railway build is the real check.
- The Python suite (1070 tests) does not exercise the Node runtime. Node tests: `npm run test:node`.
