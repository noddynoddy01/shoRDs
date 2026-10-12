# Provider-agnostic AI gateway: design

Status: design for owner approval, 2026-10-06. **Nothing here is implemented.** It touches Claude calls, caching and evidence recording, so implementation waits for approval (see the roadmap, Phase 6).
Related: [`AI_SUBSYSTEM_AUDIT.md`](AI_SUBSYSTEM_AUDIT.md), ADR-005 to ADR-009, [`AI_COST_CONTROL_DESIGN.md`](AI_COST_CONTROL_DESIGN.md).

## 1. Goals and non-goals

Goals: application logic never sees a provider's wire format; any provider can be added by writing one adapter; every analysis is permanently auditable; model changes never change the meaning of an analysis without a record; cost, rate limits, outages and deprecations are handled in one place.

Non-goals: a "universal prompt" that works identically on every model (prompts are versioned per task and model class); automatic quality parity between models; a claim of reproducibility (Section 8).

## 2. Layers

```
 application (copilot, analysis jobs, future tasks)
        |  GatewayRequest / GatewayResult  (provider-neutral, versioned)
 +------v----------------------------------------------------------+
 | AI GATEWAY                                                       |
 |  policy resolution  ->  budget/kill switch  ->  cache identity   |
 |  ->  single-flight  ->  rate-limit/cooldown/circuit breaker      |
 |  ->  adapter call  ->  normalise  ->  provenance + ledger write  |
 +------+-----------------------------------------------+-----------+
        |                                               |
  AnthropicAdapter        (OpenAIAdapter ...)     LocalDeterministicAdapter
  (only place that knows Anthropic)                (labelled fallback; never "VERIFIED")
```

The gateway owns: model policy, budgets, cache identity, deduplication, retries and backoff, cooldowns, circuit breakers, fallback routing, cost computation, provenance. Adapters own only: translate request, call, translate response, classify errors, describe models and prices.

## 3. Normalised contract

TypeScript notation for readability; the runtime is JavaScript with JSDoc types and a schema validator, and the same shapes become the stored record. Versioned by `contractVersion`.

```ts
type TaskKind = "PAPER_QA" | "PAPER_INTELLIGENCE" | string;      // a task has a prompt, an output schema and an analysisVersion

interface GatewayRequest {
  contractVersion: 1;
  task: TaskKind;
  analysisVersion: string;                 // semantic version of "what this analysis means" (Section 7)
  modelPolicy: string;                     // policy id, e.g. "standard-quality"; resolved by the gateway, never a provider name
  system: PromptRef;                       // {id, version, hash}; text is looked up, never sent by clients
  input: { messages: Message[]; evidence: EvidenceSetRef };   // evidence is by reference: ids + hashes, text loaded server-side
  output: { kind: "TEXT" } | { kind: "JSON"; schemaId: string; schemaVersion: number };
  limits: { maxOutputTokens: number; maxInputTokens: number; timeoutMs: number; deadlineAt?: string };
  reasoning: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "MAX";     // normalised; each adapter maps it (Anthropic: effort)
  stream: boolean;
  idempotencyKey?: string;                 // gateway-level; also used for single-flight
  cancel?: AbortSignal;
  context: { tenantId: string; projectId?: string; userHash: string; jobId?: string; requestId: string };
}

interface GatewayResult {
  contractVersion: 1;
  status: "COMPLETE" | "TRUNCATED" | "REFUSED" | "FILTERED" | "FAILED";
  output?: { text?: string; json?: unknown };
  model: { requested: string; served: string | null; servedVersion: string | null; versionPinned: boolean };
  provider: string;                        // "anthropic" | "openai" | "local_deterministic" ...
  usage: { inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null;
           cachedInputTokens: number | null; source: "PROVIDER" | "ESTIMATED" | "NONE" };
  cost: { microUsd: number | null; status: "COMPUTED" | "UNKNOWN" | "NONE"; priceTableVersion: string | null };
  timing: { queueMs: number; firstTokenMs: number | null; totalMs: number };
  ids: { gatewayRequestId: string; providerRequestId: string | null };
  attempts: Array<{ n: number; provider: string; model: string; outcome: ErrorCategory | "OK"; billable: "YES" | "NO" | "UNKNOWN"; ms: number }>;
  fallback: { used: boolean; kind: "NONE" | "SAME_ANALYSIS_VERSION" | "DIFFERENT_ANALYSIS_VERSION" | "LOCAL_DETERMINISTIC"; from?: ModelRef; reason?: ErrorCategory };
  cache: { status: "MISS" | "HIT" | "DEDUPLICATED" | "BYPASS"; identity: string; originalRunId?: string };
  provenanceId: string;                    // the permanent record (Section 6)
  providerMeta: unknown;                   // opaque, stored, never read by application logic
}

type ErrorCategory =
  | "RATE_LIMITED" | "OVERLOADED" | "TIMEOUT" | "NETWORK"            // transient
  | "AUTH" | "BILLING" | "MODEL_NOT_FOUND" | "MODEL_DEPRECATED"      // permanent until an operator acts
  | "INVALID_REQUEST" | "CONTEXT_TOO_LARGE" | "REFUSED" | "CONTENT_FILTERED"   // permanent for this input
  | "MALFORMED_RESPONSE" | "TRUNCATED_NO_OUTPUT" | "UNKNOWN";

interface GatewayError { category: ErrorCategory; retryable: boolean; retryAfterMs?: number; billable: "YES"|"NO"|"UNKNOWN"; providerRequestId?: string; httpStatus?: number }
```

Rules that make this contract provider-neutral:
- Application code branches only on `status`, `fallback`, `ErrorCategory` and `cost.status`. It never reads `providerMeta`, stop reasons or raw usage fields.
- Token fields are `null` when unknown, never `0` or an estimate dressed as a measurement (`source` says which).
- Cost is stored as integer micro-dollars (no floats) and is `UNKNOWN` unless a versioned published price exists for that exact served model.
- `model.served` is whatever the provider reports. If the provider reports nothing, `served` is `null` and `versionPinned` is false; the current code instead substitutes the *requested* id (audit C9), which the new contract forbids.

## 4. Adapter interface

```ts
interface ProviderAdapter {
  id: string;
  capabilities(model: string): {
    contextWindowTokens: number; maxOutputTokens: number;
    structuredOutput: "NATIVE_SCHEMA" | "JSON_MODE" | "PROMPT_ONLY";
    streaming: boolean; cancellation: boolean; reasoningControl: "NONE" | "LEVELS" | "BUDGET";
    deterministicSampling: boolean;          // false for Sonnet 5.5 (temperature rejected)
    supportsPromptCaching: boolean;
  };
  describeModel(model: string): Promise<{ id: string; deprecatedAt?: string; retiresAt?: string } | null>; // from the provider's model listing; no tokens spent
  priceTable(): { version: string; effectiveFrom: string; models: Record<string, { inputPerMTok: number; outputPerMTok: number; cachedInputPerMTok?: number }> };
  estimateInputTokens(req: ResolvedRequest): { tokens: number; method: "PROVIDER_COUNT" | "CONSERVATIVE_CHARS" };
  maxCostMicroUsd(req: ResolvedRequest): number | null;         // null when it cannot be bounded: then the gateway refuses or requires an explicit override
  complete(req: ResolvedRequest, signal: AbortSignal): Promise<ProviderResult>;
  stream?(req: ResolvedRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
  classifyError(e: unknown): GatewayError;
}
```

Adapter obligations (tested by one shared **contract test suite** that every adapter must pass with a fake transport): never log keys or prompts; map every provider error to an `ErrorCategory`; honour `AbortSignal`; return usage as reported or `null`; report `billable` after cancellation as `UNKNOWN` unless the provider documents otherwise; never retry internally (the gateway owns retries so that budgets, cooldowns and attempts are counted once).

The Anthropic adapter is a **move, not a rewrite** of today's `anthropicClient.js`: same request body (a byte-for-byte golden test is the safety net), same `output_config.effort` mapping from `reasoning`, same refusal and truncation handling.

## 5. Policy, routing and fallback

### 5.1 Model policy

A policy is data (versioned, stored in the repository and mirrored into each analysis record):

```yaml
id: standard-quality
task: PAPER_INTELLIGENCE
candidates:                       # ordered
  - { provider: anthropic, model: claude-sonnet-5-5, analysisVersion: "intel-2", equivalence: PRIMARY }
  - { provider: openai,    model: <tbd>,             analysisVersion: "intel-2-alt", equivalence: DIFFERENT }
fallbackOnCategories: [OVERLOADED, NETWORK, RATE_LIMITED, TIMEOUT]
allowDifferentAnalysisFallback: false        # default: do not change meaning automatically
maxFallbackCostFactor: 1.5
budget: { perCallMaxMicroUsd: 600000 }
```

### 5.2 The rule: never change the meaning of an analysis without recording it

Two candidates are **equivalent** only when an operator has declared the pair `SAME_ANALYSIS_VERSION` after an evaluation. Otherwise:

1. A transient failure on the primary is retried on the primary (bounded, with backoff and cooldown).
2. If it persists, and `allowDifferentAnalysisFallback` is **false** (the default), the gateway returns `FAILED` with a retryable category and the job waits, or serves the labelled **local deterministic** result (`fallback.kind = LOCAL_DETERMINISTIC`, never cached, never `VERIFIED`).
3. If a policy explicitly allows a different candidate, the result is stored under *that* candidate's `analysisVersion`, with `fallback.used = true`, `fallback.kind = DIFFERENT_ANALYSIS_VERSION`, `fallback.from` set, the reason, and a user-visible label ("analysed with a backup model"). It is **never** stored under the primary's identity and **never** served from the primary's cache entry.
4. A permanent category (`AUTH`, `BILLING`, `MODEL_NOT_FOUND`) opens the circuit for that provider, raises an alert (Observability), and does not fall over silently to a model with different behaviour.
5. A configuration that names a retired model is a **startup error in production** (not a silent substitution: today's behaviour, audit C8). The override list becomes data from `describeModel`, with a recorded decision.

### 5.3 Context-window and structured-output differences

The evidence budget is computed **per resolved model**: `evidenceBudgetTokens = min(policy.maxEvidenceTokens, capabilities.contextWindow - reserved)`. A smaller window yields a different selected evidence set, hence a different `evidenceSetHash`, hence a different cache identity and provenance: no silent loss. Structured output uses the best native mode the adapter offers; the **same validators** (citation existence, whole-number numeric match, support overlap) run on every provider's output, so a weaker provider cannot lower the verification floor. If a provider cannot meet the schema reliably, it is not eligible for that task.

### 5.4 Rate limits, cooldowns and breakers

- A shared (Redis) per-`(provider, model)` concurrency semaphore and tokens-per-minute budget sized from the console limits (read by an operator; not guessed).
- On `RATE_LIMITED` the adapter returns `retryAfterMs`; the gateway sets a cooldown key so **all replicas** pause that model (today each worker retries independently: retry storms).
- Circuit breaker per `(provider, model)`: open after N consecutive transient failures or one permanent failure; half-open probes are real requests of the lowest-cost kind or the provider's free model-list call, never speculative paid calls.
- Jobs requeue with exponential backoff and jitter (`run_after`), not immediately.

### 5.5 Deprecations and price changes

- A scheduled, free check calls `describeModel` for every model in a policy; a retirement date inside 60 days raises a ticket-grade alert.
- The price table is versioned with an effective date. Each analysis stores `priceTableVersion` and the computed cost at that time; history is never recomputed. A reconciliation job compares ledger totals to the provider's invoice or export (manual at first) and alerts when they differ by more than a threshold.
- A price or model change is a **policy change**: new policy version, evaluated, then enabled; old analyses keep their policy version.

## 6. Permanent analysis record (provenance)

An append-only table, separate from the operational `analysis_jobs`. Draft DDL (design only; migration policy in ADR-011):

```sql
CREATE TABLE analysis_runs (
  run_id              TEXT PRIMARY KEY,                   -- ar_<ulid>
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),  -- timestamp
  tenant_id           TEXT NOT NULL, project_id TEXT, user_hash TEXT,
  job_id              TEXT, parent_run_id TEXT REFERENCES analysis_runs(run_id),  -- a re-run links to the original
  task                TEXT NOT NULL,
  analysis_version    TEXT NOT NULL,                       -- semantic meaning of the analysis
  policy_id           TEXT NOT NULL, policy_version TEXT NOT NULL,
  provider            TEXT NOT NULL,
  model_requested     TEXT NOT NULL,
  model_served        TEXT,                                -- as the provider reported it; NULL if it did not
  model_version       TEXT, version_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  prompt_id           TEXT NOT NULL, prompt_version TEXT NOT NULL, prompt_hash TEXT NOT NULL,
  schema_id           TEXT, schema_version INTEGER, validator_version TEXT NOT NULL,
  parameters          JSONB NOT NULL,                      -- reasoning level, max tokens, timeouts (normalised)
  paper_id            TEXT NOT NULL,
  paper_content_hash  TEXT NOT NULL,                       -- the paper text version
  evidence_set_hash   TEXT NOT NULL,                       -- hash of the exact chunks sent (Section 6.1)
  evidence_set_version INTEGER NOT NULL,
  extractor_version   INTEGER NOT NULL,
  input_tokens        INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER, cached_input_tokens INTEGER,
  usage_source        TEXT NOT NULL,
  cost_micro_usd      BIGINT, cost_status TEXT NOT NULL, price_table_version TEXT,
  gateway_request_id  TEXT NOT NULL, provider_request_id TEXT,
  status              TEXT NOT NULL,                       -- COMPLETE | TRUNCATED | REFUSED | FAILED ...
  verification_status TEXT NOT NULL,                       -- UNVERIFIED | FALLBACK | ... never VERIFIED (until entailment checking exists)
  fallback_used       BOOLEAN NOT NULL, fallback_kind TEXT NOT NULL, fallback_from TEXT, fallback_reason TEXT,
  cache_status        TEXT NOT NULL, cache_source_run_id TEXT REFERENCES analysis_runs(run_id),
  result_checksum     TEXT,                                -- sha256 of the stored result bytes
  result_ref          TEXT,                                -- analysis_results.result_id (immutable JSONB, or object-store key later)
  reproducibility     TEXT NOT NULL DEFAULT 'NOT_GUARANTEED' CHECK (reproducibility IN ('NOT_GUARANTEED')),
  deleted_at          TIMESTAMPTZ                          -- soft delete / erasure marker (ADR-010)
);
```

Properties: **append-only** (a trigger rejects `UPDATE` and `DELETE` except by the retention role, ADR-010); every field from the requirement exists as a column; `parent_run_id` lets a re-run be compared with the original; cache hits create their own row pointing at the source run, so "who saw which answer when" is answerable; cost is integer micro-dollars; `reproducibility` has a single allowed value on purpose.

### 6.1 Evidence must outlive a re-fetch (audit C14)

`paper_chunks` is overwritten when a paper is refreshed, so an old analysis would cite text that no longer exists. Fix by content addressing:

```sql
CREATE TABLE evidence_chunks (chunk_hash TEXT PRIMARY KEY, section TEXT, text TEXT NOT NULL);       -- immutable, deduplicated
CREATE TABLE evidence_sets   (evidence_set_hash TEXT PRIMARY KEY, paper_id TEXT NOT NULL, extractor_version INTEGER NOT NULL,
                              chunk_hashes TEXT[] NOT NULL, ordinals INTEGER[] NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
```

An analysis stores `evidence_set_hash`; the exact cited text is always recoverable, however often the paper is refreshed. Storage is deduplicated across papers refreshes and tenants (public content). Retention: sets referenced by a run are kept as long as the run is.

### 6.2 Honest wording

API and UI say "analysed with *model X* on *date*, from *this text*" and offer "run again" (a new linked run). They never say "reproducible", "deterministic" or "verified" unless the corresponding guarantee exists (`verification_status` stays `UNVERIFIED` until a real claim-to-evidence check is built and validated).

## 7. Analysis version and model upgrades

`analysisVersion` identifies *what the analysis means*: the task definition, prompt family, schema, validators and evidence selection strategy. It changes when meaning changes (new fields, new rules), **not** when a model id changes under an unchanged definition, and **not** when an operator swaps in an equivalent model. A *model change* is recorded in the run (`model_served`, `policy_version`) and, if it could change meaning, is evaluated first:

1. Add the candidate to a policy in `SHADOW` mode: duplicate eligible requests to it at low rate (budgeted, owner-approved spend), store runs with `fallback_kind = SHADOW`, never shown to users.
2. Compare against a fixed evaluation set (human-labelled expectations, plus mechanical checks: citation validity, numeric faithfulness, schema validity, cost, latency).
3. Promote by changing the policy version, with the previous version one config revert away.
4. Old results stay, labelled with their model; bulk re-analysis is an explicit, budgeted job, never automatic.

## 8. Reproducibility: what we do and do not claim

Facts from the code and its recorded vendor rules: sampling parameters cannot be set for Sonnet 5.5 (non-default values are rejected), adaptive thinking is on, and the repository contains no vendor guarantee of deterministic output or of an immutable alias. Therefore: **auditable, not reproducible.** The record proves what was sent, to which model string, with which parameters and validators, what came back and what it cost. It does not promise that a new call returns the same text. If a provider later documents a determinism guarantee for a pinned snapshot, the adapter can set `versionPinned` and a new `reproducibility` value is added by a reviewed migration and a documented test, not before.

## 9. Streaming and cancellation

`stream: true` yields `ProviderEvent`s (`delta`, `usage`, `end`, `error`) normalised by the adapter; the gateway forwards deltas, accumulates the final text, **runs validation on the final text only**, and writes the provenance row at `end`. Partial streamed text is labelled `UNVALIDATED` in the UI. Cancellation propagates `AbortSignal` to the transport; the result is `status: FAILED, category: CANCELLED_BY_CALLER` with `billable: UNKNOWN`; the reserved budget is released at the worst-case-minus-observed amount only after usage is known. Today neither exists (audit C11): a "cancel" only sets a flag while the call continues to spend.

## 10. Migration plan (strangler, each step shippable and reversible)

| Step | Change | Behaviour change | Rollback |
|---|---|---|---|
| 0 | Golden tests that pin today's request body and response parsing byte for byte | none | n/a |
| 1 | Introduce `gateway/` with `AnthropicAdapter` wrapping the existing client; add the boundary test (it must pass for the new structure) | none | delete the module |
| 2 | Move copilot and intelligence to `GatewayRequest/Result`; the stored result body keeps its current fields and gains new ones | additive fields | revert |
| 3 | `analysis_runs`, `evidence_chunks`, `evidence_sets`: write-only, in parallel with the current job result | none visible | stop writing |
| 4 | Cache identity v2 | **one-time cache invalidation** (cost: one repeat of each cached call) | revert to v1 key |
| 5 | Budgets, kill switch, circuit breaker, backoff (cost-control design) | new 503 `AI_UNAVAILABLE` / `AI_BUDGET_EXHAUSTED` states | env switches |
| 6 | Second adapter in `SHADOW` mode with the contract suite | none (shadow) | disable policy entry |
| 7 | Remove the temporary compatibility fields | contract change, versioned | n/a (announced) |

## 11. Testing strategy

Shared adapter contract suite (fake transport); golden request/response tests for the Anthropic adapter; property tests that no application module imports an adapter or mentions a provider name (`aiGatewayBoundary.test.js`); policy tests for the no-silent-meaning-change rule (a forbidden fallback must never write under the primary's identity); cache identity tests extended from `cacheIdentityAudit.test.js` to every field of Section 6; fault-injection tests for 429, 5xx, timeout, refusal, truncation, malformed JSON, cancellation mid-stream; budget tests with concurrent reservations; a replay test that an old `analysis_runs` row still resolves its exact evidence after the paper is refreshed.

## 12. Open questions for the owner

1. Is a second provider wanted for **resilience**, for **price**, or for **quality**? Each leads to a different policy (the first needs equivalence classes, the second needs evaluation, the third needs shadow comparison).
2. Should popular public-paper analyses be shared across tenants (ADR-007)? It is the biggest cost lever and has a privacy review attached (the analysis of a public paper is not user data, but *which papers a tenant analyses* is).
3. What is the acceptable answer when AI is unavailable: labelled local extraction (today), queue and wait, or an explicit error?
