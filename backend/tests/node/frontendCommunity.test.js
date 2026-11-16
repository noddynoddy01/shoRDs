"use strict";
/**
 * Frontend community logic (services/social/*.ts, services/auth/routeGuard.ts onboarding, apiClient.delete): pure TypeScript with injected
 * dependencies, loaded through Node's type stripping. React screens are NOT rendered here (there is no React test renderer in this project);
 * they are covered by the TypeScript compiler and the web bundle build, and are not verified with a real Firebase sign-in. See docs.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const load = (p) => require(path.join(root, p));
const MD = load("services/social/markdown.ts");
const PA = load("services/social/parse.ts");
const FM = load("services/social/format.ts");
const DR = load("services/social/draft.ts");
const CL = load("services/social/client.ts");
const AC = load("services/auth/apiClient.ts");
const RG = load("services/auth/routeGuard.ts");

// ------------------------------------------------------------------------------------------------ markdown
test("markdown: bold, italic, code, lists, headings and https links parse; nothing becomes HTML", () => {
  const b = MD.parseMarkdown("# Title\n\nSome **bold** and *it* and `code`.\n\n- one\n- two\n\n1. a\n2. b\n\n```\nlet x = 1;\n```\n\n> quoted");
  assert.deepEqual(b.map((x) => x.t), ["h", "p", "ul", "ol", "code", "quote"]);
  assert.deepEqual(b[1].c.map((x) => x.t), ["text", "bold", "text", "italic", "text", "code", "text"]);
  assert.equal(b[4].v.trim(), "let x = 1;");
});

test("markdown: raw HTML and script stay plain text; only https links are links", () => {
  const html = MD.parseMarkdown("<script>alert(1)</script><img src=x onerror=alert(1)>");
  assert.equal(html.length, 1);
  assert.ok(html[0].c.every((i) => i.t === "text"), "no element types other than text");
  const l = MD.parseInline("[ok](https://example.com/a) [js](javascript:alert(1)) [http](http://example.com) [cred](https://u:p@example.com)");
  assert.deepEqual(l.filter((x) => x.t === "link").map((x) => x.href), ["https://example.com/a"]);
  assert.equal(MD.safeHref("data:text/html,x"), null);
  assert.equal(MD.safeHref("https://localhost/x"), null, "needs a dotted host");
});

test("markdown: oversized or hostile input is bounded; plain-text conversion drops the markup", () => {
  const big = MD.parseMarkdown("a\n\n".repeat(50000));
  assert.ok(big.length <= 200);
  assert.doesNotThrow(() => MD.parseMarkdown("*".repeat(5000) + "[".repeat(5000) + "`".repeat(5000)));
  const plain = MD.toPlainText("**Hi** [site](https://example.com) `x`\n- item");
  assert.ok(!plain.includes("**") && !plain.includes("]("));
  assert.ok(plain.includes("Hi") && plain.includes("item"));
});

// ------------------------------------------------------------------------------------------------ parsers
const validProfile = { uid: "u1", displayName: "Ada", persona: "MENTOR", verifiedMentor: true, availability: "LIMITED", researchInterests: ["x"], links: { publications: ["https://a.example"] } };

test("parsers: a valid profile parses; bad shapes throw; unknown enum values are rejected, never guessed", () => {
  const p = PA.parseProfile(validProfile);
  assert.equal(p.uid, "u1"); assert.equal(p.verifiedMentor, true); assert.equal(p.own, undefined, "no private block on a public profile");
  assert.throws(() => PA.parseProfile(null));
  assert.throws(() => PA.parseProfile({ ...validProfile, persona: "ADMIN" }));
  assert.throws(() => PA.parseProfile({ displayName: "no uid", persona: "STUDENT" }));
});

test("parsers: the private block appears only when the server sent it; lists drop malformed entries instead of repairing them", () => {
  const own = PA.parseProfile({ ...validProfile, onboardingCompleted: true, email: "a@example.test", allowDirectMessages: true, mentorCapacity: 3 });
  assert.equal(own.own.email, "a@example.test");
  const m = PA.parseMentors({ mentors: [validProfile, { nope: 1 }, "x", null], hasMore: true, total: 9 });
  assert.equal(m.items.length, 1); assert.equal(m.hasMore, true); assert.equal(m.total, 9);
  assert.deepEqual(PA.parseList("not an array", PA.parseProfile), []);
});

test("parsers: notification data keeps only string and number values; conversations and messages are validated", () => {
  const n = PA.parseNotification({ id: "1", type: "NEW_MESSAGE", title: "t", body: "b", data: { a: "x", b: 2, c: { evil: 1 }, d: [1] }, read: false, createdAt: "2026-01-01T00:00:00Z" });
  assert.deepEqual(n.data, { a: "x", b: 2 });
  assert.throws(() => PA.parseConversation({ conversationId: "c", kind: "OTHER" }));
  const msg = PA.parseMessage({ id: "5", senderUid: "u", body: "hi", createdAt: "2026-01-01T00:00:00Z", mine: true, readByOther: null });
  assert.equal(msg.readByOther, null);
});

// ------------------------------------------------------------------------------------------------ format helpers
test("format: notificationTarget only ever returns in-app paths and validates ids", () => {
  assert.equal(FM.notificationTarget("NEW_MESSAGE", { conversationId: "conv_0123456789abcdef01" }), "/messages/conv_0123456789abcdef01");
  assert.equal(FM.notificationTarget("NEW_MESSAGE", { conversationId: "../../etc/passwd" }), "/messages");
  assert.equal(FM.notificationTarget("NEW_MESSAGE", { conversationId: "https://evil.example" }), "/messages");
  assert.equal(FM.notificationTarget("MENTORSHIP_REQUEST_RECEIVED", {}), "/mentorship/requests");
  assert.equal(FM.notificationTarget("MENTOR_APPLICATION_RECEIVED", {}), "/mentor/review");
  assert.equal(FM.notificationTarget("SOMETHING_NEW", {}), null);
  for (const t of ["NEW_MESSAGE", "MENTORSHIP_REQUEST_ACCEPTED", "MENTORSHIP_COMPLETED", "MENTOR_APPLICATION_APPROVED"]) {
    const to = FM.notificationTarget(t, { url: "https://evil.example" });
    assert.ok(to === null || to.startsWith("/"), t);
  }
});

test("format: timeAgo, initials, splitList behave and are bounded", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  assert.equal(FM.timeAgo("2026-11-14T11:59:50Z", now), "just now");
  assert.equal(FM.timeAgo("2026-11-14T11:30:00Z", now), "30 min ago");
  assert.equal(FM.timeAgo("2026-11-14T09:00:00Z", now), "3 h ago");
  assert.equal(FM.timeAgo("nonsense", now), "");
  assert.equal(FM.initials("Ada Lovelace"), "AL"); assert.equal(FM.initials("  "), "?");
  assert.deepEqual(FM.splitList("a, b ,, a,\nc", 15), ["a", "b", "c"]);
  assert.equal(FM.splitList(Array.from({ length: 40 }, (_, i) => "x" + i).join(","), 5).length, 5);
});

// ------------------------------------------------------------------------------------------------ profile draft -> request body
test("draft: bodies contain only allow-listed profile fields; privileged keys can never be produced", () => {
  const d = DR.draftFrom(null, "Ada");
  d.persona = "MENTOR"; d.interests = "ml, genomics"; d.headline = "  "; d.allowDirectMessages = true;
  const all = ["displayName", "persona", "headline", "bio", "institution", "department", "academicLevel", "interests", "domains", "expertise", "skills", "orcid", "linkedin", "github", "website", "publications", "availability", "allowDirectMessages"];
  const body = DR.bodyFrom(d, all);
  for (const forbidden of ["verifiedMentor", "isAdmin", "admin", "role", "mentorStatus", "uid", "email", "mentorCapacity", "completeOnboarding"]) assert.equal(forbidden in body, false, forbidden);
  assert.equal(body.persona, "MENTOR"); assert.equal(body.headline, null, "blank optional text clears (null)");
  assert.deepEqual(body.researchInterests, ["ml", "genomics"]); assert.equal(body.allowDirectMessages, true);
  assert.deepEqual(DR.bodyFrom(d, ["displayName"]), { displayName: "Ada" });
});

test("draft: an existing profile round-trips and direct messages default to off", () => {
  const d = DR.draftFrom(PA.parseProfile({ ...validProfile, links: { orcid: "0000-0002-1825-0097", publications: ["https://a.example"] } }));
  assert.equal(d.orcid, "0000-0002-1825-0097"); assert.equal(d.publications, "https://a.example"); assert.equal(d.allowDirectMessages, false);
});

// ------------------------------------------------------------------------------------------------ social client with a fake api
function fakeApi(routes) {
  const calls = [];
  const h = (method) => async (path, a, b) => {
    const opts = method === "get" || method === "delete" ? a : undefined; const body = method === "post" || method === "put" ? a : undefined;
    calls.push({ method, path, body, query: opts && opts.query });
    const r = routes[`${method} ${path}`]; if (r === undefined) throw new Error("unexpected " + method + " " + path);
    return typeof r === "function" ? r(body, opts) : r;
  };
  return { api: { get: h("get"), post: h("post"), put: h("put"), delete: h("delete") }, calls };
}

test("client: endpoints, methods and bodies are exactly what the backend expects", async () => {
  const { api, calls } = fakeApi({
    "get /api/v1/profiles/me": { profile: null, onboardingRequired: true, isAdmin: false },
    "put /api/v1/profiles/me": { profile: validProfile },
    "post /api/v1/mentorship/requests": { request: { requestId: "r1", status: "PENDING", role: "MENTEE", mentor: { uid: "m", displayName: "M" }, mentee: { uid: "s", displayName: "S" }, domain: "d", interests: "i", guidanceNeeded: "g", createdAt: "2026-01-01T00:00:00Z" } },
    "put /api/v1/mentorship/requests/r1": { request: { requestId: "r1", status: "ACCEPTED", role: "MENTOR", mentor: { uid: "m", displayName: "M" }, mentee: { uid: "s", displayName: "S" }, domain: "d", interests: "i", guidanceNeeded: "g", createdAt: "2026-01-01T00:00:00Z" }, conversationId: "conv_0123456789abcdef01" },
    "post /api/v1/conversations/conv_0123456789abcdef01/messages": { message: { id: "9", senderUid: "u", body: "hi", createdAt: "2026-01-01T00:00:00Z", mine: true, readByOther: false } },
    "delete /api/v1/assistant/conversations": {},
    "get /api/v1/me/counters": { notifications: 2, messages: 1 }
  });
  const c = CL.createSocialClient(api);
  assert.deepEqual(await c.getMyProfile(), { profile: null, onboardingRequired: true, isAdmin: false });
  await c.saveMyProfile({ displayName: "Ada" });
  await c.createRequest({ mentorUid: "m", domain: "d", interests: "i", guidanceNeeded: "g" });
  const r = await c.respondToRequest("r1", "ACCEPT", "welcome");
  assert.equal(r.conversationId, "conv_0123456789abcdef01");
  await c.sendMessage("conv_0123456789abcdef01", "hi", "client-12345678");
  await c.clearAssistantHistory();
  assert.deepEqual(await c.counters(), { notifications: 2, messages: 1 });
  assert.deepEqual(calls.find((x) => x.path.endsWith("/messages")).body, { body: "hi", clientId: "client-12345678" });
  assert.deepEqual(calls.find((x) => x.method === "put" && x.path.includes("requests")).body, { action: "ACCEPT", note: "welcome" });
});

test("client: a malformed server reply is an error, not silently accepted; ids are URL-encoded", async () => {
  const { api, calls } = fakeApi({ "get /api/v1/profiles/a%2Fb%3Fx": { profile: { nope: true } } });
  const c = CL.createSocialClient(api);
  await assert.rejects(() => c.getProfile("a/b?x"));
  assert.equal(calls[0].path, "/api/v1/profiles/a%2Fb%3Fx");
});

// ------------------------------------------------------------------------------------------------ api client delete
test("apiClient: delete sends DELETE with the bearer token and no body", async () => {
  const seen = [];
  const api = AC.createApiClient({
    baseUrl: "https://api.example.test", getIdToken: async () => "tok", waitForAuthReady: async () => "SIGNED_IN",
    fetchImpl: async (url, init) => { seen.push({ url, init }); return { status: 200, headers: { get: () => null }, text: async () => "{}" }; }
  });
  assert.equal(typeof api.delete, "function");
  await api.delete("/api/v1/assistant/conversations/ac_1");
  assert.equal(seen[0].init.method, "DELETE"); assert.equal(seen[0].init.headers.Authorization, "Bearer tok"); assert.equal(seen[0].init.body, undefined);
  assert.ok(seen[0].url.endsWith("/api/v1/assistant/conversations/ac_1"));
});

test("apiClient: delete refuses when signed out and never calls the network", async () => {
  let called = 0;
  const api = AC.createApiClient({ baseUrl: "https://api.example.test", getIdToken: async () => null, waitForAuthReady: async () => "SIGNED_OUT", fetchImpl: async () => { called++; return { status: 200, headers: { get: () => null }, text: async () => "{}" }; } });
  await assert.rejects(() => api.delete("/api/v1/assistant/conversations/ac_1"), (e) => e.kind === "SIGNED_OUT");
  assert.equal(called, 0);
});

// ------------------------------------------------------------------------------------------------ route guard with onboarding
test("routeGuard: signed-in people with an unfinished profile go to /onboarding once, and can skip", () => {
  const d = (onboarding, segs) => RG.decideRoute({ status: "SIGNED_IN", segments: segs, onboarding });
  assert.deepEqual(d("REQUIRED", ["(tabs)"]), { action: "REDIRECT", to: "/onboarding" });
  assert.deepEqual(d("REQUIRED", ["onboarding"]), { action: "ALLOW" });
  assert.deepEqual(d("UNKNOWN", ["(tabs)"]), { action: "ALLOW" }, "never redirect before the profile has loaded");
  assert.deepEqual(d("SKIPPED", ["(tabs)"]), { action: "ALLOW" });
  assert.deepEqual(d("DONE", ["(tabs)", "mentors"]), { action: "ALLOW" });
  assert.deepEqual(d("DONE", ["auth"]), { action: "REDIRECT", to: "/(tabs)/dashboard" });
});

test("routeGuard: no auth/onboarding combination can produce a redirect loop; signed-out users are never sent to onboarding", () => {
  const segsList = [[], ["index"], ["auth"], ["onboarding"], ["(tabs)"], ["(tabs)", "mentors"], ["mentors", "x"], ["messages", "y"], ["assistant"]];
  for (const status of ["LOADING", "SIGNED_OUT", "SIGNED_IN", "UNCONFIGURED"]) for (const onboarding of ["UNKNOWN", "REQUIRED", "SKIPPED", "DONE", undefined]) for (const segs of segsList) {
    const first = RG.decideRoute({ status, segments: segs, onboarding });
    if (first.action === "REDIRECT") {
      const second = RG.decideRoute({ status, segments: RG.segmentsOf(first.to), onboarding });
      assert.equal(second.action, "ALLOW", `${status}/${onboarding}/${segs.join("/")} -> ${first.to}`);
    }
    if (status !== "SIGNED_IN") assert.notEqual(first.to, "/onboarding");
  }
});
