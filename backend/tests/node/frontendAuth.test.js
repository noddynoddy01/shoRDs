"use strict";
/**
 * Frontend authentication logic (services/auth/*.ts, services/copilotMapping.ts): pure TypeScript modules with injected
 * dependencies, loaded here through Node's built-in type stripping. This is the logic behind the sign-in screen, the route guard,
 * the token-bearing API client and project selection. (React rendering and the Firebase SDK are not exercised here; see docs.)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const load = (p) => require(path.join(root, p));
const S = load("services/auth/session.ts");
const G = load("services/auth/routeGuard.ts");
const A = load("services/auth/apiClient.ts");
const P = load("services/auth/projects.ts");
const F = load("services/auth/forms.ts");
const M = load("services/copilotMapping.ts");

// ------------------------------------------------------------------------------------------------ session machine
const U = { uid: "uid-1", email: "a@example.test", displayName: "Ada", emailVerified: true };

test("session: LOADING -> SIGNED_IN / SIGNED_OUT only on Firebase's say-so; signing out clears the user", () => {
  assert.equal(S.initialSession.status, "LOADING");
  const inn = S.reduceSession(S.initialSession, { type: "AUTH_STATE", user: U });
  assert.deepEqual([inn.status, inn.user.uid], ["SIGNED_IN", "uid-1"]);
  const out = S.reduceSession(inn, { type: "AUTH_STATE", user: null });
  assert.deepEqual([out.status, out.user, out.issue], ["SIGNED_OUT", null, null]);
  assert.equal(S.reduceSession(S.initialSession, { type: "AUTH_STATE", user: null }).status, "SIGNED_OUT", "no user at start = signed out");
});

test("session: missing configuration is UNCONFIGURED and nothing can change that (no fake login)", () => {
  const u = S.reduceSession(S.initialSession, { type: "CONFIG_MISSING" });
  assert.equal(u.status, "UNCONFIGURED");
  assert.equal(u.issue.code, "NOT_CONFIGURED");
  assert.equal(S.reduceSession(u, { type: "AUTH_STATE", user: U }).status, "UNCONFIGURED");
  assert.equal(S.reduceSession(u, { type: "SIGN_IN_FAILED", issue: S.issue("UNKNOWN") }).status, "UNCONFIGURED");
});

test("session: a failed sign-in or a listener error leaves the user SIGNED_OUT with a reason; the reason survives the next null auth event and clears when seen", () => {
  let s = S.reduceSession(S.initialSession, { type: "AUTH_STATE", user: null });
  s = S.reduceSession(s, { type: "SIGN_IN_FAILED", issue: S.mapFirebaseError({ code: "auth/wrong-password" }) });
  assert.deepEqual([s.status, s.user, s.issue.code], ["SIGNED_OUT", null, "INVALID_CREDENTIALS"]);
  assert.equal(S.reduceSession(s, { type: "AUTH_STATE", user: null }).issue.code, "INVALID_CREDENTIALS");
  assert.equal(S.reduceSession(s, { type: "ISSUE_SEEN" }).issue, null);
  const l = S.reduceSession(S.initialSession, { type: "LISTENER_ERROR", issue: S.issue("NETWORK") });
  assert.deepEqual([l.status, l.issue.code], ["SIGNED_OUT", "NETWORK"]);
});

test("session: a backend-rejected session ends the sign-in with the right reason (and only from SIGNED_IN)", () => {
  const inn = S.reduceSession(S.initialSession, { type: "AUTH_STATE", user: U });
  const a = S.reduceSession(inn, { type: "SESSION_REJECTED", reason: "EXPIRED" });
  assert.deepEqual([a.status, a.user, a.issue.code], ["SIGNED_OUT", null, "SESSION_EXPIRED"]);
  assert.equal(S.reduceSession(inn, { type: "SESSION_REJECTED", reason: "INVALID" }).issue.code, "TOKEN_INVALID");
  const out = S.reduceSession(S.initialSession, { type: "AUTH_STATE", user: null });
  assert.equal(S.reduceSession(out, { type: "SESSION_REJECTED", reason: "EXPIRED" }), out);
});

test("session: Firebase error mapping is complete for the codes users hit, and never leaks raw text", () => {
  const cases = { "auth/wrong-password": "INVALID_CREDENTIALS", "auth/user-not-found": "INVALID_CREDENTIALS", "auth/invalid-credential": "INVALID_CREDENTIALS", "auth/invalid-email": "INVALID_EMAIL", "auth/weak-password": "WEAK_PASSWORD", "auth/email-already-in-use": "EMAIL_IN_USE", "auth/user-disabled": "ACCOUNT_DISABLED", "auth/too-many-requests": "TOO_MANY_ATTEMPTS", "auth/network-request-failed": "NETWORK", "auth/user-token-expired": "SESSION_EXPIRED", "auth/invalid-user-token": "TOKEN_INVALID", "auth/popup-closed-by-user": "POPUP_CLOSED", "auth/invalid-api-key": "NOT_CONFIGURED" };
  for (const [code, want] of Object.entries(cases)) assert.equal(S.mapFirebaseError({ code }).code, want, code);
  assert.equal(S.mapFirebaseError({ code: "auth/wrong-password" }).message, S.mapFirebaseError({ code: "auth/user-not-found" }).message, "no account enumeration");
  for (const weird of [null, undefined, "x", 5, {}, { code: 5 }, new Error("secret-internal-detail"), { code: "auth/something-new", message: "secret-internal-detail" }]) {
    const i = S.mapFirebaseError(weird);
    assert.equal(i.code, "UNKNOWN");
    assert.ok(!i.message.includes("secret-internal-detail"));
  }
});

test("session: only uid, email, displayName and emailVerified are ever taken from the Firebase user (no tokens)", () => {
  const fb = { uid: "u9", email: "x@y.test", displayName: "X", emailVerified: 1, stsTokenManager: { accessToken: "SECRET-ACCESS", refreshToken: "SECRET-REFRESH" }, accessToken: "SECRET-ACCESS", providerData: [{}] };
  const u = S.toSessionUser(fb);
  assert.deepEqual(Object.keys(u).sort(), ["displayName", "email", "emailVerified", "uid"]);
  assert.equal(u.emailVerified, false, "strictly true only");
  assert.ok(!JSON.stringify(u).includes("SECRET"));
  for (const bad of [null, undefined, {}, { uid: "" }, { uid: 5 }, { uid: "x".repeat(129) }]) assert.equal(S.toSessionUser(bad), null);
});

test("session: the local profile is derived from Firebase; role is ALWAYS 'user' whatever was stored; another user's stored data is not inherited", () => {
  const tampered = { id: "uid-1", name: "Old", role: "admin", bio: "my bio", interests: ["X"], phoneNumber: "+1 555", subscription: { tier: "premium" } };
  const p = S.profileFromSession(U, tampered);
  assert.equal(p.role, "user", "a locally stored 'admin' is ignored");
  assert.equal(p.id, "uid-1");
  assert.equal(p.name, "Ada", "Firebase display name wins");
  assert.equal(p.bio, "my bio");
  assert.equal(p.email, "a@example.test");
  const other = S.profileFromSession(U, { ...tampered, id: "someone-else" });
  assert.deepEqual([other.bio === "my bio", other.phoneNumber, other.subscription, other.role], [false, undefined, undefined, "user"]);
  assert.equal(S.profileFromSession({ uid: "u", email: "grace@example.test", displayName: null, emailVerified: false }, null).name, "grace");
});

// ------------------------------------------------------------------------------------------------ route guard
test("route guard: LOADING never redirects; signed-out can reach only landing and /auth; signed-in is taken into the app", () => {
  for (const segs of [[], ["auth"], ["(tabs)"], ["paper", "x"], ["research", "copilot"]]) assert.deepEqual(G.decideRoute({ status: "LOADING", segments: segs }), { action: "WAIT" });
  for (const status of ["SIGNED_OUT", "UNCONFIGURED"]) {
    assert.deepEqual(G.decideRoute({ status, segments: [] }), { action: "ALLOW" });
    assert.deepEqual(G.decideRoute({ status, segments: ["index"] }), { action: "ALLOW" });
    assert.deepEqual(G.decideRoute({ status, segments: ["auth"] }), { action: "ALLOW" });
    for (const segs of [["(tabs)"], ["(tabs)", "profile"], ["paper", "p1"], ["chat", "x"], ["research", "copilot"], ["paywall"], ["projects"], ["canvas"]]) {
      assert.deepEqual(G.decideRoute({ status, segments: segs }), { action: "REDIRECT", to: "/auth" }, `${status} ${segs.join("/")}`);
    }
  }
  assert.deepEqual(G.decideRoute({ status: "SIGNED_IN", segments: [] }), { action: "REDIRECT", to: "/(tabs)" });
  assert.deepEqual(G.decideRoute({ status: "SIGNED_IN", segments: ["auth"] }), { action: "REDIRECT", to: "/(tabs)" });
  for (const segs of [["(tabs)"], ["(tabs)", "explore"], ["paper", "p1"], ["research", "copilot"], ["projects"]]) assert.deepEqual(G.decideRoute({ status: "SIGNED_IN", segments: segs }), { action: "ALLOW" });
});

test("route guard: no redirect loops — following any redirect always lands on an allowed route, for every status", () => {
  const routes = [[], ["index"], ["auth"], ["(tabs)"], ["(tabs)", "index"], ["paper", "a"], ["chat", "b"], ["research", "copilot"], ["projects"], ["paywall"], ["canvas"], ["review-mode"], ["search"], ["contact"], ["unknown"]];
  for (const status of ["LOADING", "SIGNED_OUT", "SIGNED_IN", "UNCONFIGURED"]) {
    for (const segments of routes) {
      const d = G.decideRoute({ status, segments });
      if (d.action !== "REDIRECT") continue;
      const next = G.decideRoute({ status, segments: G.segmentsOf(d.to) });
      assert.equal(next.action, "ALLOW", `${status} ${segments.join("/") || "/"} -> ${d.to} -> ${next.action}`);
    }
  }
  // and a sign-in / sign-out sequence converges: out -> in -> out never ping-pongs
  let status = "SIGNED_OUT", at = ["(tabs)"];
  for (const next of ["SIGNED_IN", "SIGNED_OUT", "SIGNED_IN"]) {
    status = next;
    for (let i = 0; i < 3; i++) { const d = G.decideRoute({ status, segments: at }); if (d.action === "REDIRECT") at = G.segmentsOf(d.to); }
    assert.equal(G.decideRoute({ status, segments: at }).action, "ALLOW");
  }
});

// ------------------------------------------------------------------------------------------------ API client
const TOKEN = "TOKEN.header.payload-SECRET-1";
const FRESH = "TOKEN.header.payload-SECRET-2";
const res = (status, body, headers = {}) => ({ status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

function harness(opts = {}) {
  const { ready = "SIGNED_IN", tokens = [TOKEN, FRESH], responses = [], timeoutMs } = opts;
  const baseUrl = "baseUrl" in opts ? opts.baseUrl : "https://api.shords.test";
  const h = { calls: [], tokenCalls: [], rejected: [] };
  let t = 0;
  let r = 0;
  h.client = A.createApiClient({
    baseUrl,
    timeoutMs,
    waitForAuthReady: async () => ready,
    getIdToken: async (force) => { h.tokenCalls.push(force); if (force) t = Math.min(t + 1, tokens.length - 1); return tokens[Math.min(t, tokens.length - 1)]; },
    onSessionRejected: (why) => h.rejected.push(why),
    fetchImpl: async (url, init) => {
      h.calls.push({ url, init });
      const next = responses[Math.min(r++, responses.length - 1)];
      if (typeof next === "function") return next(url, init);
      return next;
    }
  });
  return h;
}
const kind = async (p) => { try { await p; return "RESOLVED"; } catch (e) { assert.ok(e instanceof A.ApiError, String(e)); return e.kind; } };

test("api client: the token goes ONLY in the Authorization header — not in the URL, query, body, errors or logs", async () => {
  const logs = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.join(" "));
  const h = harness({ responses: [res(200, { ok: true }), res(403, { error: "FORBIDDEN", message: "no" })] });
  try {
    await h.client.get("/api/v1/projects", { query: { limit: 5 } });
    await h.client.post("/api/v1/copilot/query", { query: "q", paperId: "doi:10.1/x" }).catch((e) => { assert.ok(!JSON.stringify({ m: e.message, k: e.kind, c: e.code, s: e.stack }).includes("SECRET")); });
  } finally { Object.assign(console, orig); }
  const [get, post] = h.calls;
  assert.equal(get.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(post.init.headers.Authorization, `Bearer ${TOKEN}`);
  for (const c of h.calls) {
    assert.ok(!c.url.includes("SECRET") && !c.url.includes("TOKEN"), "not in the URL");
    assert.ok(!String(c.init.body || "").includes("SECRET"), "not in the body");
    assert.equal(c.init.redirect, "error", "a redirect cannot carry the token elsewhere");
    assert.equal(c.init.credentials, "omit", "no cookies");
    assert.ok(c.url.startsWith("https://api.shords.test/api/v1/"));
  }
  assert.equal(get.url, "https://api.shords.test/api/v1/projects?limit=5");
  assert.equal(logs.filter((l) => l.includes("SECRET")).length, 0, "nothing logged");
});

test("api client: nothing protected is sent before auth is ready, or while signed out / unconfigured", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = [];
  const c = A.createApiClient({ baseUrl: "https://api.shords.test", waitForAuthReady: () => gate, getIdToken: async () => TOKEN, fetchImpl: async (u, i) => { calls.push(u); return res(200, {}); } });
  const pending = c.get("/api/v1/projects");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 0, "auth is still LOADING: nothing sent");
  release("SIGNED_IN");
  await pending;
  assert.equal(calls.length, 1);
  for (const ready of ["SIGNED_OUT", "UNCONFIGURED"]) {
    const h = harness({ ready, responses: [res(200, {})] });
    assert.equal(await kind(h.client.get("/api/v1/projects")), "SIGNED_OUT");
    assert.equal(h.calls.length, 0, `${ready}: no request`);
  }
  const noToken = harness({ tokens: [null], responses: [res(200, {})] });
  assert.equal(await kind(noToken.client.get("/api/v1/projects")), "SIGNED_OUT");
  assert.equal(noToken.calls.length, 0);
});

test("api client: the backend address must be https (http only for localhost); a bad base or path never gets a token", async () => {
  for (const bad of [undefined, null, "", "   ", "not a url", "http://api.shords.test", "ftp://x.test", "https://user:pw@api.shords.test", "https://api.shords.test/?x=1", "javascript:alert(1)"]) {
    const h = harness({ baseUrl: bad, responses: [res(200, {})] });
    assert.equal(await kind(h.client.get("/api/v1/projects")), "NOT_CONFIGURED", String(bad));
    assert.equal(h.calls.length, 0);
  }
  for (const ok of ["http://localhost:4000", "http://127.0.0.1:4000/", "https://api.shords.test/", "https://api.shords.test/base/"]) {
    const h = harness({ baseUrl: ok, responses: [res(200, {})] });
    await h.client.get("/api/v1/projects");
    assert.ok(h.calls[0].url.startsWith(A.normalizeBaseUrl(ok) + "/api/v1/"), ok);
    assert.ok(!h.calls[0].url.includes("//api/v1"));
  }
  for (const badPath of ["https://evil.example/api/v1/x", "//evil.example/api/v1/x", "/api/v2/x", "api/v1/x", "/api/v1/../admin", "/api/v1//x", "/health", "/api/v1/x?token=abc", "/api/v1/x y", "/api/v1/x\r\nHost: evil", "/api/v1/x@evil.example"]) {
    const h = harness({ responses: [res(200, {})] });
    assert.equal(await kind(h.client.get(badPath)), "INVALID_REQUEST", badPath);
    assert.equal(h.calls.length, 0, badPath);
  }
  const h = harness({ responses: [res(200, {})] });
  for (const q of ["token", "access_token", "id_token", "Authorization", "api_key", "key"]) assert.equal(await kind(h.client.get("/api/v1/projects", { query: { [q]: "x" } })), "INVALID_REQUEST", q);
  assert.equal(h.calls.length, 0);
});

test("api client: 401 -> force-refresh once -> retry once with the new token; success is returned", async () => {
  const h = harness({ responses: [res(401, { error: "UNAUTHENTICATED" }), res(200, { projects: [] })] });
  assert.deepEqual(await h.client.get("/api/v1/projects"), { projects: [] });
  assert.deepEqual(h.tokenCalls, [false, true]);
  assert.deepEqual(h.calls.map((c) => c.init.headers.Authorization), [`Bearer ${TOKEN}`, `Bearer ${FRESH}`]);
  assert.deepEqual(h.rejected, []);
});

test("api client: still 401 after the retry -> session rejected, UNAUTHENTICATED, exactly 2 requests (no loop); failed refresh -> EXPIRED after 1 request", async () => {
  const h = harness({ responses: [res(401, {})] });
  assert.equal(await kind(h.client.get("/api/v1/projects")), "UNAUTHENTICATED");
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.rejected, ["INVALID"]);
  const g = harness({ tokens: [TOKEN, null], responses: [res(401, {})] });
  assert.equal(await kind(g.client.get("/api/v1/projects")), "UNAUTHENTICATED");
  assert.equal(g.calls.length, 1);
  assert.deepEqual(g.rejected, ["EXPIRED"]);
});

test("api client: concurrent 401s share one forced refresh", async () => {
  const h = harness({ responses: [res(401, {}), res(401, {}), res(401, {}), res(200, { ok: 1 }), res(200, { ok: 1 }), res(200, { ok: 1 })] });
  const out = await Promise.all([h.client.get("/api/v1/a"), h.client.get("/api/v1/b"), h.client.get("/api/v1/c")]);
  assert.equal(out.length, 3);
  assert.equal(h.tokenCalls.filter((f) => f).length, 1, "one refresh for three 401s");
});

test("api client: 403 (not a member / role too low) is a typed error, NOT retried, NOT a sign-out", async () => {
  const h = harness({ responses: [res(403, { error: "FORBIDDEN", message: "You do not have access to this project.", requestId: "req_1" })] });
  const e = await h.client.get("/api/v1/projects/prj_x").catch((x) => x);
  assert.deepEqual([e.kind, e.status, e.code, e.requestId], ["FORBIDDEN", 403, "FORBIDDEN", "req_1"]);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.tokenCalls, [false]);
  assert.deepEqual(h.rejected, []);
});

test("api client: every other outcome is typed (404, 429 + Retry-After, 503, 400, 5xx, unreadable 200, network, timeout)", async () => {
  const k = async (response) => { const h = harness({ responses: [response] }); return h.client.get("/api/v1/x").then(() => "OK", (e) => e); };
  assert.equal((await k(res(404, { error: "NOT_FOUND" }))).kind, "NOT_FOUND");
  const rl = await k(res(429, { error: "RATE_LIMITED", message: "slow down" }, { "retry-after": "17" }));
  assert.deepEqual([rl.kind, rl.retryAfterSec], ["RATE_LIMITED", 17]);
  assert.equal((await k(res(429, {}, { "retry-after": "-5" }))).retryAfterSec, null);
  assert.equal((await k(res(429, {}, { "retry-after": "999999" }))).retryAfterSec, null);
  const un = await k(res(503, { error: "AUTH_NOT_CONFIGURED", message: "Sign-in is not available." }, { "retry-after": "5" }));
  assert.deepEqual([un.kind, un.code, un.retryAfterSec], ["UNAVAILABLE", "AUTH_NOT_CONFIGURED", 5]);
  const bad = await k(res(400, { error: "INVALID_PAPER_ID", message: "`paperId` must be a DOI" }));
  assert.deepEqual([bad.kind, bad.code], ["INVALID_REQUEST", "INVALID_PAPER_ID"]);
  const boom = await k(res(500, { error: "INTERNAL_ERROR", message: "SECRET-INTERNAL at /srv/app.js:1" }));
  assert.equal(boom.kind, "SERVER");
  assert.ok(!boom.message.includes("SECRET-INTERNAL"), "5xx text is replaced, never echoed");
  assert.equal((await k(res(200, "<html>not json</html>"))).kind, "SERVER");
  assert.equal((await k(res(502, "<html>bad gateway</html>"))).kind, "SERVER");
  const long = await k(res(400, { message: "x".repeat(5000) }));
  assert.ok(long.message.length <= 300);
  const net = harness({ responses: [() => { throw new TypeError("fetch failed"); }] });
  assert.equal(await kind(net.client.get("/api/v1/x")), "NETWORK");
  const slow = harness({ timeoutMs: 30, responses: [(u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))))] });
  assert.equal(await kind(slow.client.get("/api/v1/x")), "TIMEOUT");
});

test("api client: describeApiError gives plain messages and never includes internals", () => {
  const E = A.ApiError;
  assert.match(A.describeApiError(new E("FORBIDDEN", "x")), /do not have access/);
  assert.match(A.describeApiError(new E("RATE_LIMITED", "x", { retryAfterSec: 9 })), /9 seconds/);
  assert.match(A.describeApiError(new E("NETWORK", "x")), /connection/);
  assert.match(A.describeApiError(new E("SIGNED_OUT", "x")), /Sign in/);
  assert.equal(A.describeApiError(new Error("SECRET")), "Something went wrong. Try again.");
});

// ------------------------------------------------------------------------------------------------ project selection
const PRJ = (n, role = "OWNER") => ({ projectId: `prj_${String(n).padStart(18, "0")}`, name: `Project ${n}`, role });

test("projects: 0 -> onboarding, 1 -> auto-selected, many -> picker (or the remembered one if the server still lists it)", () => {
  assert.deepEqual(P.decideProjectState([], "prj_000000000000000001"), { kind: "NONE" });
  assert.deepEqual(P.decideProjectState([PRJ(1)], null), { kind: "SELECTED", project: PRJ(1), auto: true });
  assert.equal(P.decideProjectState([PRJ(1)], PRJ(7).projectId).project.projectId, PRJ(1).projectId, "a stale preference never overrides the only server-listed project");
  const many = [PRJ(1), PRJ(2), PRJ(3)];
  assert.equal(P.decideProjectState(many, null).kind, "PICK");
  assert.equal(P.decideProjectState(many, undefined).projects.length, 3);
  assert.equal(P.decideProjectState(many, PRJ(9).projectId).kind, "PICK", "remembered project not in the server list (e.g. removed): ignored, not trusted");
  const kept = P.decideProjectState(many, PRJ(2).projectId);
  assert.deepEqual([kept.kind, kept.project.projectId, kept.auto], ["SELECTED", PRJ(2).projectId, false]);
});

test("projects: the server's list is validated; malformed, duplicate or hostile entries are dropped", () => {
  const list = P.parseProjectList({ projects: [PRJ(1), PRJ(1), { ...PRJ(2), role: "GOD" }, { ...PRJ(3), projectId: "prj_../../etc" }, { ...PRJ(4), name: "" }, { ...PRJ(5), name: "x".repeat(121) }, null, "x", 5, { projectId: PRJ(6).projectId }, { ...PRJ(7), role: "VIEWER", isAdmin: true }] });
  assert.deepEqual(list.map((p) => p.projectId), [PRJ(1).projectId, PRJ(7).projectId]);
  assert.deepEqual(Object.keys(list[1]).sort(), ["name", "projectId", "role"], "unknown fields are not carried");
  for (const bad of [null, undefined, "x", 5, [], {}, { projects: "x" }, { projects: {} }]) assert.deepEqual(P.parseProjectList(bad), []);
  assert.ok(P.parseProjectList({ projects: Array.from({ length: 500 }, (_, i) => PRJ(i + 1)) }).length <= 100);
  assert.equal(P.canAnalyze("VIEWER"), false);
  assert.equal(P.canAnalyze("EDITOR"), true);
  assert.equal(P.validProjectName("  "), false);
  assert.equal(P.validProjectName("My project"), true);
});

// ------------------------------------------------------------------------------------------------ forms
test("forms: local checks; Firebase stays the authority", () => {
  assert.ok(F.validateSignIn({ email: "", password: "" }));
  assert.ok(F.validateSignIn({ email: "not-an-email", password: "x" }));
  assert.equal(F.validateSignIn({ email: "a@b.co", password: "x" }), null);
  assert.ok(F.validateSignUp({ name: "", email: "a@b.co", password: "123456" }));
  assert.ok(F.validateSignUp({ name: "A", email: "a@b.co", password: "123" }));
  assert.equal(F.validateSignUp({ name: "A", email: "a@b.co", password: "123456" }), null);
});

// ------------------------------------------------------------------------------------------------ copilot mapping
const NOW = () => Date.UTC(2026, 9, 4);
const BASE = { requestId: "req_1", queryType: "RESEARCH_QUESTION", answer: "Training used six hours [doi:10.9999/x_chunk_3].", verificationStatus: "UNVERIFIED", contentCoverage: "FULL_TEXT", coverageNotice: "Full text of the paper was analysed.", aiCalled: true, model: "claude-sonnet-5-5", cache: { status: "MISS" }, paper: { paperId: "doi:10.9999/x", title: "T", authors: ["A. One", { name: "B. Two" }], year: 2020, doi: "10.9999/x" }, evidence: [{ chunkId: "doi:10.9999/x_chunk_3", paperId: "doi:10.9999/x", section: "METHODOLOGY", page: null, text: "Training used one accelerator for six hours." }], claims: [{ text: "server-side claim that must not become VERIFIED", verificationStatus: "VERIFIED" }] };

test("copilot mapping: a real answer is UNVERIFIED with coverage, the server's evidence and an honest limitation — never VERIFIED", () => {
  const r = M.mapCopilotResponse(BASE, NOW);
  assert.equal(r.status, "UNVERIFIED");
  assert.equal(r.coverage, "FULL_TEXT");
  assert.deepEqual(r.claims, [], "per-claim verification is not invented");
  assert.equal(r.evidence.length, 1);
  assert.equal(r.evidence[0].page, null, "an unknown page stays unknown");
  assert.deepEqual(r.sources[0].authors, ["A. One", "B. Two"]);
  assert.ok(r.limitations.some((l) => /Not verified/.test(l)));
  assert.equal(r.aiCalled, true);
  assert.ok(!JSON.stringify(r).includes('"VERIFIED"'));
});

test("copilot mapping: server statuses are shown as they are; an unexpected VERIFIED is downgraded; garbage is FAILED", () => {
  for (const s of ["FALLBACK", "CONTENT_UNAVAILABLE", "METADATA_ONLY"]) assert.equal(M.mapCopilotResponse({ ...BASE, verificationStatus: s, evidence: [] }, NOW).status, s);
  const v = M.mapCopilotResponse({ ...BASE, verificationStatus: "VERIFIED" }, NOW);
  assert.equal(v.status, "UNVERIFIED");
  assert.ok(v.limitations.some((l) => /cannot confirm/.test(l)));
  assert.equal(M.mapCopilotResponse({ ...BASE, verificationStatus: "SOMETHING_NEW" }, NOW).status, "FAILED");
  for (const bad of [null, undefined, "x", 5, []]) assert.equal(M.mapCopilotResponse(bad, NOW).status, "FAILED");
  const gate = M.mapCopilotResponse({ ...BASE, verificationStatus: "CONTENT_UNAVAILABLE", contentCoverage: "CONTENT_UNAVAILABLE", answer: "", aiCalled: false, evidence: [], coverageNotice: "No record of this paper could be retrieved." }, NOW);
  assert.equal(gate.answer, "No record of this paper could be retrieved.");
  assert.equal(gate.aiCalled, false);
  assert.equal(M.needsPaper("t").status, "NEEDS_CLARIFICATION");
});

// ------------------------------------------------------------------------------------------------ source scans
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", ".expo", "android", "ios", "assets"].includes(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (/\.(ts|tsx|js|jsx|json|md|html|env|example|yml|yaml)$/.test(e.name)) out.push(f);
  }
  return out;
}

test("security scan: the old hardcoded admin credential, its profile and the mentor/offline fallbacks are gone from the whole repository", () => {
  // The literals are assembled at run time so this file itself does not contain them.
  const needles = ["ABHI" + "NAV01", "abhi" + "nav01@shords", "87576" + "74333", '"admin-' + 'user"', "mentor-${Date" + ".now()}", "Admin Login " + "Successful", "Mentor Login " + "Successful", "Fallback for offline/local " + "sandbox"];
  const hits = [];
  for (const f of walk(root)) {
    if (f.endsWith("frontendAuth.test.js")) continue;
    const text = fs.readFileSync(f, "utf8");
    for (const n of needles) if (text.includes(n)) hits.push(`${path.relative(root, f)}: ${n.slice(0, 6)}…`);
  }
  assert.deepEqual(hits, []);
});

test("security scan: the token is handled only by the auth modules; no frontend code builds its own Authorization header or stores a token", () => {
  const allowed = new Set(["services/auth/apiClient.ts", "services/auth/firebaseSession.ts", "services/auth/session.ts"]);
  const offenders = [];
  for (const dir of ["app", "components", "services", "context", "hooks"]) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    for (const f of walk(base)) {
      const rel = path.relative(root, f);
      if (!/\.(ts|tsx)$/.test(f) || allowed.has(rel)) continue;
      const t = fs.readFileSync(f, "utf8");
      if (/getIdToken\(|Authorization\s*[:=]|["'`]Bearer\s/.test(t) && !rel.startsWith("services/llm/")) offenders.push(rel);
      if (/AsyncStorage\.setItem\([^)]*(token|idToken|accessToken)/i.test(t) || /localStorage\.setItem\([^)]*token/i.test(t)) offenders.push(`${rel} (stores a token)`);
    }
  }
  assert.deepEqual(offenders, []);
  for (const f of ["services/auth/apiClient.ts", "services/auth/session.ts", "services/auth/routeGuard.ts", "services/auth/projects.ts"]) {
    const t = fs.readFileSync(path.join(root, f), "utf8");
    assert.ok(!/AsyncStorage|localStorage|sessionStorage|document\.cookie/.test(t), `${f} stores nothing`);
    assert.ok(!/console\.(log|warn|error|info|debug)/.test(t), `${f} logs nothing`);
  }
  const client = fs.readFileSync(path.join(root, "services/auth/apiClient.ts"), "utf8");
  assert.match(client, /redirect:\s*"error"/);
  assert.match(client, /credentials:\s*"omit"/);
  const session = fs.readFileSync(path.join(root, "services/auth/firebaseSession.ts"), "utf8");
  assert.ok(!/console\.(log|warn|error|info|debug)/.test(session), "the Firebase session layer logs nothing");
});

test("security scan: the sign-in screen has no local/offline login path and uses Firebase through the auth context only", () => {
  const src = fs.readFileSync(path.join(root, "app/auth.tsx"), "utf8");
  assert.ok(!/AsyncStorage/.test(src), "the screen writes no profile of its own");
  assert.ok(!/role:\s*"(admin|mentor)"/.test(src));
  assert.ok(!/"mentor"|mode === "mentor"|Mentor Hub|Mentor ID/.test(src), "no mentor login mode");
  assert.match(src, /type AuthMode = "login" \| "signup"/);
  assert.match(src, /useAuth\(\)/);
  const authCtx = fs.readFileSync(path.join(root, "context/AuthContext.tsx"), "utf8");
  assert.ok(!/role:\s*"(admin|mentor)"/.test(authCtx));
  const layout = fs.readFileSync(path.join(root, "app/_layout.tsx"), "utf8");
  assert.match(layout, /decideRoute/);
  assert.match(layout, /<AuthProvider>/);
  const fb = fs.readFileSync(path.join(root, "services/firebase.ts"), "utf8");
  for (const k of ["EXPO_PUBLIC_FIREBASE_API_KEY", "EXPO_PUBLIC_FIREBASE_PROJECT_ID", "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN", "EXPO_PUBLIC_FIREBASE_APP_ID"]) assert.ok(fb.includes(`process.env.${k}`), k);
  assert.ok(!/AIza[0-9A-Za-z_\-]{30,}/.test(fb), "no embedded API key");
});
