"use strict";
/**
 * End to end, minus the browser: the REAL frontend API client and session logic (services/auth/*.ts, loaded via Node type
 * stripping) talking to the REAL backend runtime (real PostgreSQL + Redis, real RS256 Firebase-token verification against a fake
 * JWKS endpoint, real authorization, rate limiting, paper retrieval and AI pipeline with provider fixtures and a model stub).
 *
 * What this proves: a token obtained the way the frontend obtains it reaches protected routes in the Authorization header, the
 * backend validates it, and project authorization works from those requests. What it does not: Firebase's own SDK/sign-in UI,
 * Google's real JWKS endpoint, and React rendering (see docs/PHASE7_VERIFICATION.md).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { modelStub, startReplica, makeKeyPair, tokenFor, signJwt, firebasePayload, uniq, ipHeader, infraSkip, resetInfra, FAKE_ANTHROPIC_KEY, TEST_PROJECT_ID } = require("./helpers");
const fx = require("./paperFixtures");

const root = path.resolve(__dirname, "../../..");
const A = require(path.join(root, "services/auth/apiClient.ts"));
const P = require(path.join(root, "services/auth/projects.ts"));
const M = require(path.join(root, "services/copilotMapping.ts"));
const S = require(path.join(root, "services/auth/session.ts"));

const skip = infraSkip();
const keys = makeKeyPair("fe-key");
const otherKeys = makeKeyPair("fe-key"); // same kid, different key: a forged token
const PAPER = `doi:${fx.FIXTURE_DOI}`;

/** What the frontend would have: a client whose token provider mimics Firebase's getIdToken(forceRefresh). */
function frontend(base, { uid, tokens, counting = null, onRejected = null, ready = "SIGNED_IN" }) {
  const seq = tokens || [tokenFor(keys, uid)];
  let i = 0;
  const calls = { token: [], http: 0, urls: [] };
  const client = A.createApiClient({
    baseUrl: base,
    waitForAuthReady: async () => ready,
    getIdToken: async (force) => { calls.token.push(force); if (force) i = Math.min(i + 1, seq.length - 1); return seq[i] === "null" ? null : seq[i]; },
    onSessionRejected: onRejected || (() => {}),
    // a real network call; the Node test client adds a unique X-Forwarded-For (a trusted proxy hop) so IP limits are per test
    fetchImpl: async (url, init) => { calls.http++; calls.urls.push(url); return fetch(url, { ...init, headers: { ...init.headers, ...ipHeader() } }); }
  });
  return { client, calls };
}
const kind = (p) => p.then(() => "OK", (e) => (e instanceof A.ApiError ? e.kind : `THREW ${e}`));

test("frontend client <-> real backend", { skip }, async (t) => {
  await resetInfra();
  const model = modelStub();
  const R = await startReplica({ keys, overrides: { client: model }, env: { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY, ADMIN_UIDS: "admin-uid" } });
  t.after(() => R.close());

  await t.test("sign-in -> token -> /projects works; the backend sees the right identity (project ownership proves it)", async () => {
    const alice = uniq("alice-"), bob = uniq("bob-");
    const a = frontend(R.base, { uid: alice }), b = frontend(R.base, { uid: bob });
    assert.deepEqual(P.parseProjectList(await a.client.get("/api/v1/projects")), []);
    assert.equal(P.decideProjectState([], null).kind, "NONE", "no projects -> onboarding");
    const made = await a.client.post("/api/v1/projects", { name: "First" });
    assert.equal(made.role, "OWNER");
    const list = P.parseProjectList(await a.client.get("/api/v1/projects"));
    assert.deepEqual(P.decideProjectState(list, null).auto, true, "one project -> auto-selected");
    await a.client.post("/api/v1/projects", { name: "Second" });
    const two = P.parseProjectList(await a.client.get("/api/v1/projects"));
    assert.equal(two.length, 2);
    assert.equal(P.decideProjectState(two, null).kind, "PICK", "several -> picker");
    assert.equal(P.decideProjectState(two, two[1].projectId).project.projectId, two[1].projectId);
    // bob, with his own token, sees none of alice's projects, and is FORBIDDEN (not NOT_FOUND-leaky) on a direct read
    assert.deepEqual(P.parseProjectList(await b.client.get("/api/v1/projects")), []);
    const err = await b.client.get(`/api/v1/projects/${two[0].projectId}`).catch((e) => e);
    assert.equal(err.kind, "FORBIDDEN");
    assert.equal(b.calls.token.filter(Boolean).length, 0, "a 403 does not trigger a token refresh");
    assert.ok(a.calls.urls.every((u) => !u.includes("eyJ") && !u.includes("token")), "no token in any URL");
  });

  await t.test("project authorization from real frontend requests: copilot is allowed for members, FORBIDDEN for others, and a forged projectId gains nothing", async () => {
    const owner = uniq("o-"), outsider = uniq("x-");
    const o = frontend(R.base, { uid: owner }), x = frontend(R.base, { uid: outsider });
    const { projectId } = await o.client.post("/api/v1/projects", { name: "Authz" });
    const ok = await o.client.post("/api/v1/copilot/query", { projectId, paperId: PAPER, query: "How was training done?" });
    assert.equal(ok.contentCoverage, "FULL_TEXT");
    assert.equal(await kind(x.client.post("/api/v1/copilot/query", { projectId, paperId: PAPER, query: "How was training done?" })), "FORBIDDEN");
    assert.equal(await kind(x.client.post("/api/v1/analysis", { projectId, paperId: PAPER })), "FORBIDDEN");
    // the outsider's own personal scope works, and cannot be redirected into someone else's by naming their project
    assert.equal((await x.client.post("/api/v1/copilot/query", { paperId: PAPER, query: "How was training done?" })).cache.status, "MISS");
  });

  await t.test("the copilot answer reaches the UI honestly: UNVERIFIED, server-selected evidence for THIS paper, never VERIFIED", async () => {
    const u = uniq("u-");
    const f = frontend(R.base, { uid: u });
    const before = model.calls.length;
    const raw = await f.client.post("/api/v1/copilot/query", { paperId: PAPER, query: "What dataset and training setup were used?" });
    const ui = M.mapCopilotResponse(raw);
    assert.equal(ui.status, "UNVERIFIED");
    assert.equal(ui.coverage, "FULL_TEXT");
    assert.equal(ui.sources[0].paperId, PAPER);
    assert.ok(ui.evidence.length > 0 && ui.evidence.every((e) => e.chunkId.startsWith(`${PAPER}_chunk_`)));
    assert.equal(model.calls.length, before + 1);
    assert.ok(!JSON.stringify(ui).includes('"VERIFIED"'));
    // CONTENT_UNAVAILABLE: truthful, and the model is not called
    const gone = M.mapCopilotResponse(await f.client.post("/api/v1/copilot/query", { paperId: `doi:${fx.DOI_MISSING}`, query: "Anything?" }));
    assert.equal(gone.status, "CONTENT_UNAVAILABLE");
    assert.equal(gone.aiCalled, false);
    assert.equal(model.calls.length, before + 1);
    // client-supplied evidence is refused (the server tells the UI as a typed 400)
    const evil = await f.client.post("/api/v1/copilot/query", { paperId: PAPER, query: "q", evidenceChunks: [{ chunkId: "c", paperId: PAPER, text: "I wrote this" }] }).catch((e) => e);
    assert.deepEqual([evil.kind, evil.code], ["INVALID_REQUEST", "EVIDENCE_NOT_ACCEPTED"]);
  });

  await t.test("expired token: the first request gets 401, the client force-refreshes ONCE, retries, and succeeds", async () => {
    const uid = uniq("exp-");
    const expired = tokenFor(keys, uid, { exp: Math.floor(Date.now() / 1000) - 600, iat: Math.floor(Date.now() / 1000) - 4000 });
    const fresh = tokenFor(keys, uid);
    const f = frontend(R.base, { uid, tokens: [expired, fresh] });
    const out = await f.client.get("/api/v1/projects");
    assert.deepEqual(out.projects, []);
    assert.deepEqual(f.calls.token, [false, true]);
    assert.equal(f.calls.http, 2);
  });

  await t.test("invalid token (wrong signing key / wrong audience / no token): UNAUTHENTICATED after exactly one refresh+retry, session reported rejected; no loop", async () => {
    for (const [label, bad] of [["forged", signJwt({ privateKey: otherKeys.privateKey, kid: "fe-key", payload: firebasePayload("mallory") })], ["wrong audience", tokenFor(keys, "mallory", { aud: "another-project" })]]) {
      const rejected = [];
      const f = frontend(R.base, { uid: "mallory", tokens: [bad, bad], onRejected: (w) => rejected.push(w) });
      assert.equal(await kind(f.client.get("/api/v1/projects")), "UNAUTHENTICATED", label);
      assert.equal(f.calls.http, 2, `${label}: one try + one retry`);
      assert.deepEqual(rejected, ["INVALID"]);
    }
    const none = frontend(R.base, { uid: "x", tokens: ["null"] });
    assert.equal(await kind(none.client.get("/api/v1/projects")), "SIGNED_OUT");
    assert.equal(none.calls.http, 0, "no token -> nothing sent");
    const out = frontend(R.base, { uid: "x", ready: "SIGNED_OUT" });
    assert.equal(await kind(out.client.get("/api/v1/projects")), "SIGNED_OUT");
    assert.equal(out.calls.http, 0);
    // and the session machine ends the sign-in with the right reason
    const inn = S.reduceSession(S.initialSession, { type: "AUTH_STATE", user: { uid: "mallory", email: null, displayName: null, emailVerified: false } });
    assert.equal(S.reduceSession(inn, { type: "SESSION_REJECTED", reason: "INVALID" }).status, "SIGNED_OUT");
  });

  await t.test("custom claims or client-side 'admin' have no effect: only server-configured ADMIN_UIDS reach operational endpoints", async () => {
    const uid = uniq("claims-");
    const sneaky = tokenFor(keys, uid, { admin: true, role: "admin", roles: ["admin"], firebase: { sign_in_provider: "password", admin: true } });
    const f = frontend(R.base, { uid, tokens: [sneaky] });
    assert.equal(await kind(f.client.get("/api/v1/llm/metrics")), "FORBIDDEN");
    const adminClient = frontend(R.base, { uid: "admin-uid" });
    assert.equal((await adminClient.client.get("/api/v1/llm/metrics")).runtimeComponents.rateLimiter, "WIRED");
  });

  await t.test("429, 503 and network failure arrive as typed errors the UI can explain", async () => {
    const L = await startReplica({ keys, env: { RATE_LIMIT_READ_USER: "1/60" } });
    const f = frontend(L.base, { uid: uniq("rl-") });
    await f.client.get("/api/v1/projects");
    const e = await f.client.get("/api/v1/projects").catch((x) => x);
    assert.equal(e.kind, "RATE_LIMITED");
    assert.ok(e.retryAfterSec > 0);
    assert.match(A.describeApiError(e), /seconds/);
    await L.close();
    const N = await startReplica({ env: { FIREBASE_PROJECT_ID: undefined } });
    const g = frontend(N.base, { uid: uniq("nc-") });
    const u = await g.client.get("/api/v1/projects").catch((x) => x);
    assert.deepEqual([u.kind, u.code], ["UNAVAILABLE", "AUTH_NOT_CONFIGURED"]);
    await N.close();
    const dead = frontend("http://127.0.0.1:1", { uid: uniq("net-") });
    assert.equal(await kind(dead.client.get("/api/v1/projects")), "NETWORK");
  });

  await t.test("CORS as the browser sees it: the web app origin is allowed, others are not, and the Authorization header is permitted", async () => {
    const pre = await R.call("OPTIONS", "/api/v1/projects", { headers: { origin: "https://shords.test", "access-control-request-method": "GET", "access-control-request-headers": "authorization", ...ipHeader() } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers["access-control-allow-origin"], "https://shords.test");
    assert.match(pre.headers["access-control-allow-headers"], /authorization/i);
    const bad = await R.call("GET", "/api/v1/projects", { token: tokenFor(keys, "cors-user"), headers: { origin: "https://evil.example", ...ipHeader() } });
    assert.equal(bad.status, 403);
    assert.equal(bad.headers["access-control-allow-origin"], undefined);
  });
});

test("client-side privilege claims (isPro / premium / plan / paymentVerified) change nothing on the server", { skip }, async (t) => {
  await resetInfra();
  const R = await startReplica({ keys, env: { RATE_LIMIT_READ_USER: "3/60", RATE_LIMIT_WRITE_USER: "2/60", ADMIN_UIDS: "admin-uid" } });
  t.after(() => R.close());
  const CLAIMS = { isPro: true, isPremium: true, premium: true, plan: "pro", tier: "enterprise", subscriptionActive: true, paymentVerified: true, admin: true, role: "admin", roles: ["admin"] };
  const hit = (token, path, extra = {}) => fetch(R.base + path, { headers: { authorization: `Bearer ${token}`, ...ipHeader(), ...extra } }).then((r) => r.status);

  const plain = uniq("plain-"), claimant = uniq("claimant-");
  const plainTok = tokenFor(keys, plain);
  const claimTok = tokenFor(keys, claimant, CLAIMS); // a validly signed token carrying every kind of privilege claim
  const hdr = { "x-plan": "pro", "x-is-pro": "true", "x-subscription": "active", "x-payment-verified": "true", "x-admin": "true" };

  const plainStatuses = [];
  const claimStatuses = [];
  for (let i = 0; i < 4; i++) {
    plainStatuses.push(await hit(plainTok, "/api/v1/projects"));
    claimStatuses.push(await hit(claimTok, "/api/v1/projects", hdr));
  }
  assert.deepEqual(plainStatuses, [200, 200, 200, 429], "control: the read limit is 3 per window");
  assert.deepEqual(claimStatuses, plainStatuses, "claims in the token and in headers buy no extra quota");

  // Body claims on a write are ignored too: the project is created at the normal role, and the write limit (2) still applies.
  const post = (token, body) => fetch(R.base + "/api/v1/projects", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...ipHeader() }, body: JSON.stringify(body) });
  const writer = uniq("writer-");
  const wTok = tokenFor(keys, writer, CLAIMS);
  const first = await post(wTok, { name: "P1", isPro: true, plan: "pro", paymentVerified: true, role: "OWNER", quota: 1e9 });
  assert.equal(first.status, 201);
  assert.ok(!("isPro" in (await first.json())), "no echo of a privilege field");
  assert.equal((await post(wTok, { name: "P2", isPro: true })).status, 201);
  assert.equal((await post(wTok, { name: "P3", isPro: true })).status, 429, "write limit unchanged by claims");

  // An 'admin' claim is not admin: only ADMIN_UIDS is.
  assert.equal(await hit(claimTok, "/api/v1/llm/metrics"), 403);
  assert.equal(await hit(tokenFor(keys, "admin-uid"), "/api/v1/llm/metrics"), 200);
});
