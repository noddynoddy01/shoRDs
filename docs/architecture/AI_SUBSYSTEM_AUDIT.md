# AI subsystem audit (read-only, 2026-10-06)

Scope: everything between "a user asks for an analysis" and "an answer is stored and shown": `backend/llm/*`, `backend/jobs/analysisProcessor.js`, the cache, the ledger, and the paper-to-evidence path. Viewpoint: shoRDs will process millions of papers and use several AI providers.
No paid call was made. The cache proof below ran against a stub model.
Commit audited: `800cd96` plus the test files added in this pass.

Finding ids (C1, C2, ...) are referenced from tests and from the roadmap.

## 1. Summary

| Id | Finding | Severity | Status |
|---|---|---|---|
| C1 | Anthropic-specific values and structures are used outside the adapter file (7 modules) | High for multi-provider | Documented; a `todo` boundary test lists every violation |
| C2 | The paper title is part of the structured-analysis prompt but not part of the cache identity | Low (stale metadata only) | Demonstrated (`todo` test) |
| C3 | Prompt text, profile parameters and validation thresholds are identified only by hand-bumped version strings | Medium | **Guard test added**: edit without bump now fails CI |
| C4 | Cached bodies embed the paper header and coverage notice as they were when the entry was written | Low | Demonstrated (`todo` test) |
| C5 | The cache identity has no provider field and no provider-reported model snapshot | Medium for multi-provider | Documented; fixed in design (ADR-007) |
| C6 | The question-answering path and the structured path have no shared "analysis version" | Medium | Design (ADR-006) |
| C7 | Provenance is incomplete and not permanent (Section 4) | High | Design (ADR-006), nothing implemented |
| C8 | A retired or overridden model is swapped silently: the swap is logged, but the stored result records only the substituted model | Medium | Documented; design rule in ADR-008 |
| C9 | `modelVersion` is the provider's `model` string, or the *requested* model when the provider sent none, with no flag saying which | Medium | Documented |
| C10 | Token accounting ignores cache-read, cache-creation and reasoning token detail; cost is exact-id matched | Medium | Documented |
| C11 | No cancellation, no streaming, no per-call abort | Medium | Documented; interface in the gateway design |
| C12 | Output validation weaknesses (numeric substring match, delimiter look-alikes) | Medium | Demonstrated (`todo` tests, security audit V-1, V-2) |
| C13 | The question-answer path persists nothing: no durable record of what was asked, answered or on what evidence | High for auditability | Documented |
| C14 | Evidence chunks are overwritten on re-fetch, so an old analysis can no longer show the text it cited | High for reproducibility | Documented; design in ADR-006 |
| C15 | No spend ceiling, global limit or kill switch | High | See `AI_COST_CONTROL_DESIGN.md` |
| C16 | Whole-paper context is capped at 120,000 characters with section-quota truncation; no map-reduce for long documents | Low today, medium at scale | Documented |

## 2. Provider coupling (C1)

Rule requested: *the application must never depend directly on Anthropic-specific response structures outside the provider adapter.* Today the adapter is `backend/llm/anthropicClient.js` (request building, response parsing, error classification, pricing, retries). Values from it leak into the application in these places:

| Where | What leaks |
|---|---|
| `llm/copilotService.js`, `llm/intelligence.js` | import `callMessages`, `resolveApiKey`, `resolveModelConfig`, `resolveProfile`; read `result.usage`, `result.stopReason`, `result.model`, `result.requestId`; set `provider: "anthropic"` and `modelMode: "EXTERNAL_CLAUDE"` as literals; copy Anthropic stop reasons into the stored result |
| `llm/aiPipeline.js` | calls `resolveApiKey` and `resolveModelConfig` (Anthropic environment variable names) to decide whether caching applies |
| `llm/resultCache.js` | `isRealCompleteAnswer` tests `modelMode === "EXTERNAL_CLAUDE"` |
| `llm/usageLedger.js` | derives `aiCalled` from `modelMode === "EXTERNAL_CLAUDE"` and `tokens.source === "REAL_PROVIDER"` |
| `readiness.js`, `runtime.js` | probe and configure Anthropic specifically |
| error handling | the application switches on Anthropic error categories (`INSUFFICIENT_CREDITS`, `MODEL_UNAVAILABLE`, ...) and hints mention Anthropic settings |

Impact: adding a second provider today means editing at least seven modules and the cache rule, and the stored result schema would carry provider-specific values (`effort`, `stopReason`) with provider-specific meaning. The target design is in [`AI_GATEWAY_DESIGN.md`](AI_GATEWAY_DESIGN.md) and ADR-005. `backend/tests/node/aiGatewayBoundary.test.js` encodes the rule as an executable check and lists the current violations as a `todo`.

## 3. Cache identity: proof and gaps

### 3.1 What the key contains today

`buildCacheKey` hashes, in fixed order and JSON-encoded (so field boundaries cannot be forged): `CACHE_SCHEMA_VERSION`, tenant, project, paper id, **content hash of the evidence chunks actually sent** (chunk id, section, page, text), model, mode (question: `QUESTION:<depth>`; structured: `INTELLIGENCE:v<schema>:<depth>`), prompt version, and the SHA-256 of the question text (a constant for structured analysis).

The content hash is computed from the *selected* chunks after the budget selection, so anything that changes which text is sent (a different question, a different context budget, a re-fetched paper) changes the hash.

### 3.2 The proof, and its limits

`backend/tests/node/cacheIdentityAudit.test.js` runs the **real** pipeline (`answerQuestion`, `analyzePaper`) and the **real** result cache against an in-memory Redis stand-in and a stub model that records every call. For each analysis-relevant input it establishes a cached baseline, changes exactly that input, and observes whether the stub is called again.

| Changed input | Question path | Structured path |
|---|---|---|
| identical repeat (control: must hit) | hit | hit |
| padded question text, other member of same project (controls: must still hit) | hit | n/a |
| tenant | miss (correct) | miss |
| project | miss | miss |
| paper | miss | miss (same keying) |
| question text | miss | n/a |
| analysis depth | miss | miss |
| model | miss | miss |
| evidence: chunk text | miss | miss |
| evidence: chunk section | miss | miss |
| evidence: chunk added | miss | miss |
| evidence: chunk removed | miss | miss |
| question vs structured collide? | cannot (different mode prefix) | |
| provider failure then retry | nothing stored; next call reaches the model | |

Result: **20 tests pass, 0 fail, 2 `todo`** (the two gaps below).

**Sensitivity check ("does the test see a bug if there is one?")**: I temporarily removed the content hash and the model from the key. 10 of the tests failed as expected. The change was reverted (`git status` clean for `resultCache.js`).

**What this proves**: for every input that reaches the key *or the selected evidence*, a change cannot serve an old cached answer. **What it does not prove**: (a) inputs that influence the answer but are not in the key at all (C2 to C4 below); (b) that the provider is deterministic (it is not; see ADR-006); (c) behaviour of the real Redis server (the integration tests in `cache.integration.test.js` cover that).

### 3.3 Gaps found

- **C2 title** (demonstrated, `todo`): `buildIntelligencePrompt` puts the paper title in the prompt, the key does not contain it. A corrected title in the provider's metadata with unchanged text returns an analysis generated with the old title. Impact is low because the title is only context, but the rule "every analysis-relevant input" is violated.
- **C4 stale header** (demonstrated, `todo`): the cached body includes `paper` (title, venue, licence...), `coverageNotice` and `context.chunksOmitted` as of write time. A hit returns that header.
- **C3 prompt text and profiles** (fixed in test form): the system prompts, `COVERAGE_INSTRUCTION`, `ANALYSIS_PROFILES` (effort, max tokens, timeouts), validation thresholds and the response shaping code are covered only by `PROMPT_VERSION` / `INTEL_PROMPT_VERSION` / `INTEL_SCHEMA_VERSION` / `CACHE_SCHEMA_VERSION`, which a human must bump. A guard test now pins a fingerprint of the prompt text, the profiles and the four version strings. Editing any of them without updating the pinned fingerprint fails CI, and updating the fingerprint is the moment to bump the version, which changes every key. (Validation thresholds in `intelligence.js` are not in the fingerprint; ADR-007 moves to hashing the full prompt and a validator version into the key.)
- **C5 provider and served model**: no provider field; the model in the key is the *configured* model id. If a provider silently moves an alias to a new snapshot, the key does not change and old answers continue to be served. Whether Anthropic does that for `claude-sonnet-5-5` is **not known from the repository**; the design therefore records the served model string from every response and treats an alias as "version not guaranteed".
- **Minor**: the legacy `cachedCopilotQuery` path keys on the raw `analysisDepth` string (`"standard"` and `"STANDARD"` are different keys: extra misses, never stale hits). It is not on the production path.

### 3.4 Required key (design, ADR-007)

`identity = H(cache_schema, scope(tenant/project or "PUBLIC_PAPER"), provider, model_requested, model_served_version_if_pinned, analysis_version, prompt_hash, schema_hash, validator_version, parameters(effort, max_tokens), paper_id, evidence_set_hash, question_hash)`. Every component is a recorded field of the permanent analysis record, so a cache entry can always be explained.

## 4. Provenance: what is recorded today versus what is required

Requirement: every generated analysis permanently records provider, model, model version if available, prompt/schema version, analysis version, content hash, evidence-set version, timestamp, token usage, cost when known, request id when available, result status, fallback status.

| Required | Where it is today | Permanent? | Gap |
|---|---|---|---|
| provider | result body `provider` (literal `"anthropic"`) | Only inside `analysis_jobs.result` | Copilot answers are not stored at all (C13) |
| model | result body `model` (the provider-reported id, or the requested id if the provider sent none: C9) | same | cannot tell reported from requested |
| model version | `modelVersion` = same string as `model` | same | no real snapshot concept (C9) |
| prompt version | `promptVersion` | same | the text itself is not hashed or stored; only a hand-bumped label (C3) |
| schema version | `schemaVersion` (structured path only) | same | question path has none |
| analysis version | does not exist | n/a | C6 |
| content hash | `paper.contentHash` (whole paper) | same | not the hash of the evidence actually sent |
| evidence-set version | does not exist | n/a | selected chunk ids and hashes are not recorded; chunks are overwritten on re-fetch (C14) |
| timestamp | `analysis_jobs.finished_at`; ledger `created_at` | yes for jobs | none for copilot |
| token usage | body `tokens`; ledger columns | ledger yes (rows without request content) | reasoning/cache token detail dropped (C10) |
| cost when known | body `estimatedCostUsd` + `costStatus`; ledger `cost_usd` (float) | ledger yes | floats; price-table version not stored |
| request id | body `providerRequestId`; ledger `request_id` is the **shoRDs** id, not the provider's | job result only | ledger lacks the provider request id |
| result status | `status` | job | |
| fallback status | `fallbackUsed`, `fallbackReason` | job and ledger | |

Where the data lives matters: the structured result lives in `analysis_jobs.result` (an operational table with retention to be defined), and nothing durable exists for question answers. `ai_usage` is a cost ledger, not an audit trail: it holds no content, prompt hash or evidence reference.

**Reproducibility statement.** shoRDs cannot claim that an analysis is reproducible. The Sonnet 5.5 request rules in `anthropicClient.js` document that `temperature`, `top_p`, `top_k` are rejected, so no sampling control exists; adaptive thinking is on; the provider documents no determinism guarantee that the code can rely on. What shoRDs *can* make is an **audit trail**: exactly what text was sent (prompt hash plus content-addressed evidence set), under which model string and parameters, what came back (stored verbatim with its checksum), at what cost, and under which validation code. A re-run is a **new run linked to the old one**, never a claim of the same output. The design in ADR-006 uses the word "auditable" and never "reproducible" in the product or the API; a field `reproducibility` exists and has the single value `NOT_GUARANTEED` until a provider offers a documented guarantee.

## 5. Failure modes and routing today

| Event | Today | Problem |
|---|---|---|
| 401/403 | `INVALID_CREDENTIAL`, local fallback (HTTP 200) | operator sees a log line only |
| 404 | `MODEL_UNAVAILABLE`, local fallback | a retired model looks like an outage |
| 429 | retry up to 2 times with `Retry-After` capped at 10 s, then fallback | no cooldown shared across replicas; retry storms across workers |
| 5xx / network | retry, then fallback | no circuit breaker |
| 400 "credit balance" | `INSUFFICIENT_CREDITS` | detected by message text; 402 or other wordings unclassified |
| timeout | not retried; request may still be billed | tokens recorded as null |
| refusal | `REFUSAL` category | fine; ensure not cached |
| truncated output | `truncated: true`, not cached | fine; billed |
| configured model in the retired list | silently replaced by the default, warning logged | C8: the result does not say the configured model was overridden |

Fallback is the deterministic local extractive answer, labelled `FALLBACK`, never `VERIFIED`, never cached: this is the correct honest behaviour and must be preserved. What is missing is a **routing layer** that distinguishes "same meaning elsewhere" from "different meaning" (ADR-008).

## 6. Token accounting and cost (C10)

`usage` keeps `input_tokens` and `output_tokens`. Thinking tokens are billed as output and are therefore included in `output_tokens` (documented in the client). Not captured: cache-read or cache-creation input tokens if the provider reports them, and a reasoning-token breakdown. The price table has one entry (`claude-sonnet-5-5`: $2 input, $10 output per million tokens); any other id yields `NOT_AVAILABLE` rather than a guess, which is the correct honest behaviour, and `ANTHROPIC_PRICE_*` variables can override both prices at once. Gaps: no per-model overrides, no effective-date or version for a price change, floating-point `cost_usd`.

Measured sanity check from the production run: 28,783 input and 4,704 output tokens gave $0.104606, which equals 28,783 x 2/1e6 + 4,704 x 10/1e6. The estimate is internally consistent; the Anthropic Console remains the source of truth and the comparison is still **NOT VERIFIED**.

## 7. Scale behaviour of the AI path

- One paper is processed with one call whose input is at most 120,000 characters (about 30,000 tokens at 4 characters per token; the measured paper used 28,783 tokens). Longer papers are truncated by section quotas, and the truncation is recorded in `context`. A map-reduce or hierarchical pass is not needed for the current product but is the correct future for books or very long papers (not recommended before there is a user need).
- Memory and CPU: `loadChunks` reads all chunks of a paper into memory; at 600 chunks and 1.5 million characters this is small.
- Throughput: a worker holds no Postgres connection during the model call (verified earlier), so database load does not grow with call duration.
- Millions of papers: the cost of analysing each paper once is about $0.05 to $0.10 (measured). One million papers once is on the order of $50K to $100K *if each were analysed*; analysing on demand and sharing results across tenants (ADR-007) is the only sustainable shape. Pre-analysing popular papers in batch is a product decision with its own budget.
- Evaluation: no quality benchmark exists. Before any model change (ADR-008) a fixed evaluation set with human-checked expectations is needed. Building it costs model calls and needs approval.

## 8. Items verified as good and preserved

Server-owned evidence (clients cannot send evidence), chunk ids tied to one paper, the coverage gate (nothing is sent to a model when there is no text), `VERIFIED` unreachable by code, local fallback always labelled, truncated and refused answers never cached, token-owned lock release, request timeouts per depth, a response that distinguishes `REAL_PROVIDER`, `FALLBACK` and `CACHE` token sources, and cost `null` instead of a guessed price.

## 9. Not verified in this audit

Provider-side behaviour: whether `claude-sonnet-5-5` is an alias that can move, Anthropic's data retention and training settings for the account, rate limit tier, batch interface availability, billing of timed-out requests. These need the vendor's current documentation or the console; none of them was checked.
