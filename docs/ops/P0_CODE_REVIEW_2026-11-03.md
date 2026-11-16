# Review of the `p0-fixes` branch (10 commits, 24 uncommitted files), 2026-11-03

Scope: cloud copy `/home/claude/shoRDs`. Nothing committed, pushed, merged or deployed. Evidence labels: **[RAN]** executed with output seen; **[READ]** code read, not executed. Depth is stated per area; areas not listed as reviewed were not reviewed.

Shape of the change set (`git diff HEAD --stat`): 26 files, 1,249 insertions, 87 deletions at the time of writing. Application code is small (about 210 changed lines across 11 files); the bulk is tests (about 1,000 lines) and docs.

## 1. Are the four controls actually enforced?

| Control | Verdict | Evidence |
|---|---|---|
| **Spend controls** (kill switch, price known, per-request ceiling, breaker, duplicate lock, atomic reservation, settle) | Enforced on every production AI path, fails closed when Redis or Postgres is unavailable | **[READ]** `aiBudget.js` check order; `runtime.js` builds the budget and `aiPipeline` wraps the client with `guardClient`; no other code constructs a provider client. **[RAN]** 190 integration tests including real Redis (open and password-protected) and real Postgres, 0 skipped; 391 unit tests |
| **Evidence integrity** | Enforced for citations and for the *value* of quantitative results; **not** enforced for numbers in narrative statements, quantitative `context`, or meaning (negation, direction, scope) | **[RAN]** probe, then `backend/tests/node/evidenceGaps.test.js` (3 `todo` tests that pin the gaps; 1 passing test pins current behaviour). See finding F1 |
| **Idempotency** | Enforced. The key is bound to (project, paper, depth), which is every field the job request stores; reuse for a different request returns 422 `IDEMPOTENCY_KEY_REUSED`; a race is decided by a unique index | **[READ]** `jobStore.js` `requestIdentity`, `createJob`; `app.js:385-419`. **[RAN]** integration tests pass |
| **Migration safety** | Enforced: advisory lock, one transaction per migration, explicit rollback, connection destroyed if rollback fails, `MigrationError` with categories only | **[READ]** `migrations.js`. **[RAN]** `migrationSafety.integration.test.js` and `dataClients.integration.test.js` pass; new migration 3 applied on a fresh database ([1,2,3]) |

## 2. Findings

| ID | Severity | Status | Finding |
|---|---|---|---|
| F1 | High (correctness of the product's central promise) | **Open, needs owner approval** | Narrative statements keep a number that is not in the cited chunks (probe: 87.4 changed to 91.7 was kept), a quantitative result's free-text `context` is stored unchecked (an invented "40 points" was kept), and a statement that reverses the cited result is kept (lexical overlap at 20% cannot see "does not"). Only `quantitativeResults.value` is number-checked. Fix design: extend `numbersIn` grounding to every statement and to `context`; for meaning, use a second-pass checker after a human benchmark. Any change alters which statements survive, so it needs an `INTEL_PROMPT_VERSION` bump and falls under the protected-area approval the earlier audits asked for. Pinned by `evidenceGaps.test.js` |
| F2 | Low | **Fixed** | `RESERVE_LUA` wrote the reserved amount with Lua's default number formatting. At 1e14 micro-USD or more Lua writes `3e+14`, which the same script's reader cannot parse; with the Redis store a reservation of that size would fail to count against the limit. Reproduced with a test that failed on the original and passes with `string.format('%.0f', amount)`. **[RAN]** `aiBudgetLargeAmount.integration.test.js`. 1e14 micro-USD is $100 million, so the practical risk was very low; the fix is one line |
| F3 | Medium (performance, at scale) | **Fixed locally** | Project and user budget seeds scanned the whole day's `ai_usage` rows (about 230 ms at 100,000 rows/day). Migration 3 adds `(project_id, created_at)` and `(user_hash, created_at)`; about 0.15 ms after. **[RAN]** on a synthetic 2M-row table; migration tests 52/52. Plain `CREATE INDEX` blocks writes to `ai_usage` while it builds: negligible at today's size, but on a large table use a separate out-of-transaction step |
| F4 | Low | Open (design choice) | The duplicate-in-flight lock key is a hash of (tenant, model, system, user prompt, max tokens, effort). Two members of the same tenant asking the same question at the same moment: the second gets `DUPLICATE_IN_FLIGHT` instead of waiting for the first result. Today the tenant is per user, so this shows up only as a user's own double click; it will matter when projects have several members. Better: return the first caller's result through the existing cache wait. **[READ]** `aiBudget.js:503-516` |
| F5 | Low | Open | A call that is retried and eventually succeeds can be billed by the provider for the failed attempts while the ledger records only the successful call's tokens. The reservation covers the retry budget, so the ceiling holds, but the dollar counters can read low. **[READ]** |
| F6 | Low | Open | After a Redis flush the settle step can race with re-seeding from Postgres; at worst a counter reads slightly low until the next seed. Postgres remains authoritative. **[READ]**, not reproduced |
| F7 | Low | Open | Rate-limit counters (`ANALYSIS_USER_DAILY` etc.) are consumed before the idempotency check, so a legitimate retry of an idempotent request spends daily quota again. **[READ]** `app.js:394-398` |
| F8 | Info | Verified | Pricing table has one entry, `claude-sonnet-5-5` at $2 input / $10 output per million tokens. **Matches Anthropic's published price** (platform.claude.com pricing, read 2026-11-03). An unknown model is refused rather than priced at zero |
| F9 | Info | Verified | CORS allows `GET, POST, PUT, OPTIONS`; the backend routes use only GET and POST (`app.js:484-501`). PUT is allowed but unused |
| F10 | Info | Verified | Cache identity discipline is enforced by a fingerprint test: changing prompt text or a validation limit forces a version bump. Positive |
| F11 | Info | Observed | Pre-existing untracked files `dump.rdb` (a Redis dump dated 2026-11-01) and `backend/tests/node/fingerprintProbes.js` are in the working tree and were not touched. `dump.rdb` should not be committed |

## 3. Regression and working-tree integrity

- **[RAN]** `npm run test:node`: 391 tests, 387 pass, 0 fail, 0 skipped, 4 todo (1 pre-existing known gap, 3 new evidence gaps).
- **[RAN]** `npm run test:integration` with a throwaway PostgreSQL 16.15 and two Redis servers (one password-protected): 190 tests, 190 pass, 0 fail, **0 skipped** (the earlier run had 1 skipped, because no password-protected Redis was available).
- **[RAN]** Before/after comparison of every modified file by SHA-256 against the snapshot taken before this work: of the 25 files recorded, exactly two differ, `backend/llm/aiBudget.js` (the one-line F2 fix, diff shown) and `package.json` (test wiring and the `eval:summaries` script). One further tracked file was changed: `backend/data/migrations.js` (migration 3 appended, 13 added lines, no existing line altered). Untracked files before the work are all still present; new untracked files are listed in the execution register. No P0 change was overwritten.
- Not run: frontend lint, web build, frontend tests, dependency audit (npm registry unreachable from the container), Node 20 (the production image uses Node 20; the tests ran on Node 22), the CI workflow on GitHub.

## 4. Not reviewed in depth

`copilotService.js`, `resultCache.js` and `projects.js` diffs were read (a constant, a comment and an export each); `docker-compose.yml`, `.env.example`, `services/llm/aiGateway.ts` and the documentation edits were not examined line by line; the large test diffs (`cacheIdentityAudit.test.js`, `aiBudget.test.js`) were run but not read through for weak assertions.

## 5. Recommended owner decisions

1. Approve a protected-area change for F1 (statement-level number grounding plus a version bump), or accept the gap knowingly.
2. Decide whether `p0-fixes` is committed and merged, with the migration-3 index, once Railway has been checked.
3. Keep the spend limit in the Anthropic Console as the outer backstop regardless.


## Status update 2026-11-04 (phase 2)

F1 (evidence-validation gap): **closed in code** on branch `p0-fixes` (shared claim guard, every statement and field checked, `INTEL_PROMPT_VERSION 2026.3-intel`, evidence spans, evidence endpoint). Verified by unit and integration suites (see `PHASE2_TEST_AND_REGRESSION_REPORT_2026-11-04.md`). **Not closed as a quality matter:** guard accuracy on real summaries is unmeasured. Needs owner review before merge because it changes which statements survive and invalidates cached analyses.
