# shoRDs security audit, October 2026

Scope: backend (`backend/`), the Expo web client, the Electron shell (`desktop/`), build and deploy configuration, third-party and provider interactions. Posture: a startup product that handles research data and spends money per request.
Method: code review of the shipped path, plus **local attack demonstrations** against the real HTTP handler, a real PostgreSQL 16 and Redis 7 on localhost (throwaway databases, fake credentials, stub model). **Nothing was run against production. No paid call was made.** No security control was weakened to make a test pass.
Commit audited: `800cd96` plus the changes listed in Section 5. Test results: Section 6.

## 1. Threat model

### 1.1 Assets
1. Users' research data (projects, analyses) and the confidentiality boundary between tenants.
2. Money: the Anthropic account (spend per request), later billing records.
3. Service availability (a small single-region deployment).
4. Credentials: Anthropic key, database and Redis URLs, Firebase project, future signing keys.
5. Trust: the claim that shoRDs shows evidence-grounded, honestly labelled results.

### 1.2 Actors and assumptions (as requested)
| Actor | Capability assumed |
|---|---|
| Anonymous internet client | reads the web bundle, replays and modifies API calls, sends oversized or malformed input |
| Authenticated free user | creates many accounts, probes other users' ids, abuses limits, crafts questions and project names |
| Collaborator with a low role | attempts privilege escalation within a project |
| Malicious paper author | controls the content, title and abstract of a paper that shoRDs will fetch and send to the model |
| Compromised or faulty provider (scholarly or AI) | returns oversized, malformed, hostile or wrong responses |
| Leaked credential holder | holds an old key or token |
| Local process or other user on a desktop machine | talks to the Electron shell's loopback server and IPC |
| Supply-chain attacker | a vulnerable or malicious dependency |

### 1.3 Trust boundaries
Browser to API (untrusted input, bearer token); API to Postgres and Redis (trusted network, authenticated); API to scholarly providers and to Anthropic (outbound, allow-listed hosts, responses untrusted); document text to the model (untrusted data inside a prompt); model output back to users (untrusted until validated); Electron renderer to main process (IPC, untrusted).

### 1.4 Out of scope here
Anthropic's and Firebase's own infrastructure; physical and social attacks; the contents of the Railway, Vercel and Firebase consoles (not inspected: see Section 7).

## 2. Results by area

| Area | Result | Evidence / note |
|---|---|---|
| Authentication | Good | RS256 only, header `alg` pinned, signature via Google JWKS (cached), `exp`, `iat`, `auth_time`, `aud`, `iss`, `sub` checked; forged, `alg:none`, truncated, wrong-audience and expired-claim tokens rejected (existing `auth.test.js`; live checks on 2026-10-05). Gaps: no revocation check (a disabled account stays valid up to the token lifetime, about 1 hour); `email_verified` not required (V-17) |
| Authorization | Good | role per project checked on every request; low roles cannot write or analyse (local test) |
| Project/tenant isolation, BOLA/IDOR | Good | local attack matrix: a stranger cannot read, promote self, analyse, ask a project-scoped question, read or cancel a job; "exists but not yours" and "does not exist" are indistinguishable; the attempts changed nothing |
| Privilege escalation | Good | VIEWER cannot set own role or create paid work; role values are an allow-list; arrays, objects, `__proto__` and numbers rejected |
| CORS | Good | exact allow-list; browsers from other origins are blocked (live check). Note: `PUT` missing from allowed methods and no exposed rate-limit headers (P2-1) |
| CSRF | Not applicable | authentication is a bearer header, never a cookie; CORS prevents cross-origin reads. If cookies are ever introduced this changes |
| SSRF | Good, with one fixed issue | outbound requests go only to a fixed host allow-list over https with redirect re-validation; no user-supplied URL is ever fetched. V-4 (path steering) fixed |
| SQL injection | Good | every query is parameterised; hostile names are stored literally; table survives (local test) |
| Command injection | None found | no `child_process`, `exec`, `eval` or `new Function` in the production backend |
| Path traversal | Fixed where found | paper references (V-4) and the two Electron paths (V-8, V-9); production backend serves no files |
| Prototype pollution | Good | `__proto__` / `constructor.prototype` in JSON bodies do not reach `Object.prototype` (local test) |
| Request smuggling | Low risk | Node's strict HTTP parser; no custom framing; `headersTimeout` 15 s and `requestTimeout` 60 s set. Behind Railway's proxy: not independently verified. No `maxHeadersCount`/`maxConnections` (P3) |
| Malicious document parsing | One issue fixed | markup parser has depth, node, tag-length and time budgets; V-5 (CPU exhaustion by "<a <a <a ...") fixed; `x<y` mis-parse is a fidelity bug (V-19) |
| Oversized documents | Good | provider size caps (2 MB metadata, 12 MB full text), 600 chunks, 1.5 M characters, 120,000-character model context |
| Regex DoS | One issue open | V-10 `neutralizeTags` is quadratic; parsers and identity regexes are bounded or anchored |
| File handling | n/a server side | no uploads reach the server (the upload screen is a stub). Desktop: fixed |
| API abuse and rate limiting | Partly good | Redis Lua limits, fail closed, per IP/user/tenant/day; counts requests not dollars: spend is unbounded in total (`AI_COST_CONTROL_DESIGN.md`); fixed windows and unmasked IPv6 (V-20) |
| Secret management | Needs work | secrets only in platform env; none in the bundle (scan passes); old credential in git history (V-22); Firebase web key unrestricted (VERIFY) |
| Logging of sensitive data | Good | one JSON line per request with a 10-hex hash of the uid; no tokens, emails, prompts or paper text logged; local test confirms errors do not echo the token |
| Token handling | Good | tokens never stored by the backend; client keeps Firebase SDK state |
| Firebase verification | Good | see Authentication. The Firestore/Storage rules are not in the repo (V-13) |
| Proxy trust | Good, fragile | `TRUST_PROXY=true`, hops 2 measured live; wrong hop count would merge all clients into one IP bucket (config validation: Phase 1) |
| Admin endpoints | Good | `ADMIN_UIDS` unset in production so both admin routes return 403 to everyone; non-admin gets 403, anonymous 401 |
| AI prompt injection | Partially mitigated | data tags, "data not instructions" system rule, server-owned evidence, output validation; look-alike delimiters (V-2) and an unbounded title (V-10) remain |
| Evidence injection | Good | clients cannot send evidence text (7 key names refused); chunk ids tied to one paper; unknown or foreign chunk ids refused (local test) |
| Model output validation | Weakest area | numeric check by substring (V-1); Q&A answers only checked for citation existence; `VERIFIED` is unreachable by code (correct) |

## 3. Vulnerability register

Format: id, severity (my estimate: Critical/High/Medium/Low), the **demonstrated attack**, the **regression test**, the **fix** and the **rerun**, or why it is not fixed yet.

### Fixed in this audit (attack demonstrated, test written, fix applied, test rerun green)

**V-4 Request-path steering through a DOI (Low-Medium)**
- Attack (local): `POST /api/v1/papers/resolve {"paperId":"doi:10.1000/../../../etc/passwd"}` returned 200. The server then requested `https://api.openalex.org/works/doi:10.1000/../../../etc/passwd?...`, which resolves to `/etc/passwd` on api.openalex.org: a caller can choose the path of a request the server makes to an allow-listed host (escaping `/works/`). Also stored junk keyed by an attacker-chosen id.
- Test: `securityAudit.integration.test.js` "path traversal / injection through paper references" (checks status and that no outbound URL contains a dot-segment) and `securityAudit.test.js` "path traversal: DOIs with dot-segments ...".
- Fix: `papers/identity.js` rejects any DOI or canonical id with a `.` or `..` path segment (`normalizeDoi`, `isCanonicalPaperId`). Real DOIs (dots inside segments, nested slashes) are unchanged (test "legitimate DOIs ... are unchanged").
- Rerun: red before (`POST doi:10.1000/../../../etc/passwd -> 200`), green after.

**V-5 CPU exhaustion by a hostile document (Medium)**
- Attack (local): a page of `<a <a <a ...` of 300 KB held the single-threaded process for 2.2 s; 600 KB held it for the full 3.2 s to 4 s budget; the parser runs in the API process for retrieval, so one hostile page stalls every user. Requires an attacker-controlled page on an allow-listed host (an arXiv HTML page, for example).
- Test: "DoS: a hostile page of unterminated tags cannot hold the event loop for seconds" (five hostile shapes, three entry points, each under 1.5 s) and the realistic-article control.
- Fix: `papers/markup.js` remembers the position of the next `>` and rejects a tag attempt in O(1) when none is within the tag length cap; plus a hard cap on scan work wasted by failed tag attempts. Parsing of ordinary articles is unchanged (control test, and the existing extraction tests still pass).
- Rerun: red before (`600000 bytes held the event loop for 3199 ms`), green after. The existing pathological-input test (`papers.test.js`) still passes, which preserves the earlier contract that such input degrades rather than throws.
- Residual: parsing still runs in the API process. Moving it to a worker is in the roadmap (Phase 7).

**V-6 A malformed size limit disables the body cap (Medium)**
- Attack (local): start the service with `MAX_REQUEST_BODY_BYTES=512KB` (a plausible dashboard typo): a 3 MB JSON body was read fully into memory and answered `400` instead of `413`. (`Number("512KB")` is `NaN`, and `received > NaN` is always false.)
- Test: "CONFIG: a malformed MAX_REQUEST_BODY_BYTES ... must not disable the body size limit".
- Fix: `app.js` accepts only a positive integer, otherwise falls back to the 524,288-byte default and logs a warning. Valid values behave as before.
- Rerun: red then green. Still open: the same unvalidated-config pattern for `TRUST_PROXY_HOPS`, `PG_POOL_MAX`, `WORKER_CONCURRENCY` (roadmap Phase 1; touches proxy trust, so left for approval).

**V-7 A NUL byte in user text becomes a 503 (Low)**
- Attack (local): `POST /api/v1/projects {"name":"a\u0000b"}` returned `503 DEPENDENCY_UNAVAILABLE` (PostgreSQL rejects NUL). A user can generate "dependency down" noise and retry storms at will.
- Test: "SQL injection: hostile text is stored ... literally" (also asserts a NUL name is never a 5xx).
- Fix: the route rejects control characters in project names with 400 `INVALID_NAME`.
- Rerun: red then green. Residual: other free-text fields are validated by pattern; the general fix is mapping client-caused SQL errors to 4xx (Phase 1).

**V-8 Arbitrary file write from the Electron renderer (High for desktop, none for web)**
- Attack: the `export-downloads` IPC handler did `path.join(downloadsDir, fileName)` with a name chosen by web content, so `../../.bashrc` writes outside Downloads, and it overwrote silently.
- Test: "desktop: export file names from web content cannot escape the downloads folder" (traversal, absolute, drive-letter, reserved device names, NUL, trailing dot or space, length, non-strings).
- Fix: `desktop/safeExport.js` `resolveDownloadTarget` accepts only a plain file name that resolves directly inside the downloads folder; the handler also checks the data type and size. Existing overwrite behaviour was kept on purpose, to preserve working behaviour.
- Rerun: green. Limit: the Electron handler itself is not executed under test (needs Electron); the pure function it calls is.

**V-9 Arbitrary file read from the Electron loopback server (Medium, local)**
- Attack: the embedded static server joined `req.url` onto the dist folder without a containment check, so `GET /../../etc/passwd` sent by a non-browser local client read any file the user can read. (Browsers normalise `..`; other local processes do not.) The server also sends `Access-Control-Allow-Origin: *`.
- Test: "desktop: the embedded static server never maps a URL outside its dist folder".
- Fix: `resolveStaticPath` rejects anything that leaves the dist directory; such requests fall back to the SPA index.
- Rerun: green. Open: the wildcard CORS header and `webSecurity: false` (V-14).

### Demonstrated, not fixed (the fix changes a protected area; awaiting approval)

**V-1 Numbers "found" by substring (Medium, trust)**: `validateIntelligence` uses `String.includes`, so a model value `5` is accepted as grounded in "15 percent", and `2.5` in "12.50 ms" (local run kept both; a value absent from the text was dropped). Test `securityAudit.test.js` "grounding: ..." is a `todo` that asserts the desired behaviour (whole-number match). Fix design: tokenise numbers with boundaries and compare normalised values; bump the intelligence prompt/schema version so caches invalidate (changes evidence grounding and cache identity).

**V-2 Delimiter look-alikes survive prompt neutralisation (Medium)**: `neutralizeTags` removes exact tags but not `< /paper_excerpts>`, zero-width-split names or full-width brackets; they reach the model intact (local run: 4 of 9 variants survive). Whether a given model is fooled is unknown and **not tested** (no paid calls); the defence-in-depth (system rule, output validation, server-owned ids) still holds. Fix design: normalise Unicode and strip zero-width characters before neutralising, escape `<` and `>` in untrusted text entirely, and use per-request random delimiters; changes prompts and cache identity. `todo` test written.

**V-3 Idempotency-Key reuse with a different request (Medium)**: the key is unique per user but not bound to the request; a different paper or depth with the same key returns the first job with 200 (local run: a DEEP request was answered with the QUICK job). Impact: a client believes it queued the wrong thing; no cross-user effect. Fix design: store a hash of the canonical request with the key and answer 422 on mismatch; additive columns. Changes the API contract (a response that used to succeed becomes an error), so it needs explicit approval. `todo` test written.

**V-10 Quadratic regex in prompt construction (Medium under the "compromised provider" assumption)**: `neutralizeTags` (`[^>]*`) takes ~1.5 s on 120 KB and ~95 s on 900 KB of `<excerpt <excerpt ...`. Chunk text is capped (3,000 characters per chunk, so a hostile chunk costs milliseconds) but **titles are not length-capped** and a provider response can be 2 MB. Fix design: cap titles at storage (for example 500 characters) and bound the pattern. `todo` test written.

**V-12 Failed migration poisons the pool and holds the lock (High operationally)**: demonstrated locally (`25P02`; pool end hangs). `migrationSafety.integration.test.js` (`todo`). Fix design in `DATA_DURABILITY.md` section 4.

### Documented, not locally demonstrable or needing the consoles

- **V-11 Postgres client**: default `sslmode` is `disable`, `require` does not verify the certificate, the client answers cleartext or MD5 authentication requests, no server-side statement timeouts, a parse error can leave a connection with a stale response stream (reproduced by the reviewer earlier; not re-run in this pass). Production's database URL is on Railway's private network; the transport setting there is unverified.
- **V-13 Firebase rules**: the client writes `users/{uid}` to Firestore at sign-up; no rules files exist in the repo; the live rules are unknown. If open, any visitor could read or alter profile documents. Needs the Firebase console (**VERIFY**), then either remove the write or commit and deploy rules.
- **V-14 Electron hardening**: `webSecurity: false`, `sandbox: false`, wildcard CORS on the loopback server; the backend runs inside the main process. Not distributed today; blocks any desktop release.
- **V-15 Android**: release build signed with the debug keystore (tracked in git), placeholder package id, broad permissions. Blocks any store release.
- **V-16 Web headers**: no CSP, `frame-ancestors`, `Referrer-Policy` or `X-Content-Type-Options` on the Vercel site; missing hashed assets are answered with `index.html`.
- **V-17 Account assurance**: no email verification and no revocation check; open sign-up lets one person create many accounts (spend risk: cost-control design).
- **V-18 Provider compromise**: titles, abstracts and full text are untrusted input at every use (V-5, V-10, V-2); a compromised AI provider can return anything, which is why output validation, `UNVERIFIED` labelling and no automatic actions on model output matter.
- **V-19 Parser fidelity**: text such as `x<y ... <a href>` is read as a tag and swallows the next real tag (the original parser already did this: 50 paragraphs produced zero links). It loses markup, not security.
- **V-20 Rate limiter details**: fixed windows allow 2x bursts; IPv6 addresses are not grouped by /64; headers of the last bucket overwrite earlier ones.
- **V-21 Dependencies**: the lockfile was not audited (`npm audit` was not run in this pass); the backend has zero runtime dependencies, so the exposure is the web and desktop toolchains. Add `npm audit` and an SCA tool to CI.
- **V-22 Credential history**: an old hard-coded credential is recoverable from git history (commit `a7bc050`). If it was ever used elsewhere, rotate it (owner action).

## 4. Controls verified to hold (regression tests protect them)

Authentication claims and algorithm pinning; per-request authorisation; no existence oracle; role allow-list; evidence-injection refusal (7 key names and foreign chunk ids); parameterised SQL; prototype-pollution immunity; no 5xx or stack traces for malformed bodies (8 shapes, including a 50,000-deep nested array); body size cap with default; no token echo in errors; admin routes denied by default.

## 5. Files changed by this audit

Fixes: `backend/papers/identity.js`, `backend/papers/markup.js`, `backend/app.js`, `desktop/main.js`, new `desktop/safeExport.js`.
Tests added: `backend/tests/node/securityAudit.test.js`, `securityAudit.integration.test.js`, `cacheIdentityAudit.test.js`, `aiGatewayBoundary.test.js`, `migrationSafety.integration.test.js`; `package.json` script lists updated so they run.
Documents: this file and the architecture documents.

## 6. Test results

Run on 2026-10-06 against local Postgres 16 and Redis 7 (open and password-protected instances); no production system and no paid AI call was involved.

| Suite | Command | Tests | Pass | Fail | Skipped | Todo |
|---|---|---|---|---|---|---|
| Unit | `npm run test:node` | 225 | 219 | 0 | 0 | 6 |
| Integration | `npm run test:integration` | 148 | 146 | 0 | 0 | 2 |

Baseline before this audit: 191 unit and 131 integration tests.

The 8 `todo` tests are demonstrated-but-unfixed items that state the desired behaviour: V-1 and V-2 (grounding check), V-10 (quadratic tag neutralisation), V-3 (idempotency reuse), V-12 (migration poisoning), cache gaps C2 and C4, and the AI gateway boundary (seven modules). A `todo` test that starts passing is reported by the runner, which is how an approved fix will be confirmed. The integration tests skip without `TEST_DATABASE_URL` and `TEST_REDIS_URL`; the counts above are with them provided. `docs/PRODUCTION_VERIFICATION.md` is not changed: no production claim is made here.

## 7. Not verified

Railway and Vercel dashboard configuration, Firebase console rules and API-key restrictions, Redis authentication and network exposure in production, Postgres TLS in production, Anthropic account settings (data retention, spend limits), image contents, `npm audit`, behaviour of any real model against injection payloads (no paid calls), the Electron IPC handlers executed under Electron, load behaviour.

## 8. Recommended order

1. Owner actions with no code: Anthropic spend limit, Firebase rules check, Railway backup check, rotate the old credential if reused.
2. Approve the protected-area fixes together, because V-1, V-2, V-10 all change prompts or grounding and should share one prompt/schema version bump and one cache invalidation.
3. V-3 and V-12 with the migration and job-store work in Phase 1 and 3.
4. Native and desktop items (V-14, V-15) before any distribution.
