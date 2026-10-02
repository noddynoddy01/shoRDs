"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parsePolicy, loadPolicies, clientIp, rateLimitHeaders, DEFAULT_POLICIES } = require("../../security/rateLimit");

test("defaults are present for every protected scope", () => {
  const p = loadPolicies({});
  for (const name of Object.keys(DEFAULT_POLICIES)) assert.ok(p[name].limit >= 1 && p[name].windowSec >= 1, name);
  assert.deepEqual({ l: p.COPILOT_USER.limit, w: p.COPILOT_USER.windowSec }, { l: 20, w: 60 });
});

test("limits are configurable through RATE_LIMIT_<NAME>=<limit>/<windowSec>", () => {
  const p = loadPolicies({ RATE_LIMIT_COPILOT_USER: "5/10", RATE_LIMIT_GLOBAL_IP: "1000/60" });
  assert.deepEqual({ l: p.COPILOT_USER.limit, w: p.COPILOT_USER.windowSec }, { l: 5, w: 10 });
  assert.equal(p.GLOBAL_IP.limit, 1000);
  assert.equal(p.ANALYSIS_USER.limit, 10, "untouched policies keep their defaults");
});

test("an invalid value stops startup instead of silently using another limit", () => {
  for (const bad of ["abc", "0/60", "10/0", "10", "-1/60", "10/60/5", "1e3/60", ""]) {
    if (bad === "") { assert.equal(loadPolicies({ RATE_LIMIT_COPILOT_USER: "" }).COPILOT_USER.limit, 20); continue; }
    assert.throws(() => loadPolicies({ RATE_LIMIT_COPILOT_USER: bad }), /RATE_LIMIT_COPILOT_USER/, bad);
  }
  assert.throws(() => parsePolicy("X", "5/ 60 x"));
});

test("client IP: X-Forwarded-For is ignored unless TRUST_PROXY, and then only the entry `hops` from the right counts", () => {
  const req = (xff) => ({ headers: xff ? { "x-forwarded-for": xff } : {}, socket: { remoteAddress: "10.0.0.9" } });
  assert.equal(clientIp(req("1.2.3.4"), {}), "10.0.0.9", "not trusted: the socket address wins (a client cannot choose its IP)");
  assert.equal(clientIp(req("6.6.6.6, 1.2.3.4"), { trustProxy: true, hops: 1 }), "1.2.3.4", "a spoofed leftmost entry is ignored");
  assert.equal(clientIp(req("1.2.3.4, 5.5.5.5"), { trustProxy: true, hops: 2 }), "1.2.3.4");
  assert.equal(clientIp(req(""), { trustProxy: true }), "10.0.0.9");
  assert.equal(clientIp(req("1.2.3.4"), { trustProxy: true, hops: 3 }), "10.0.0.9", "fewer entries than hops: do not guess");
});

test("headers: limited responses carry Retry-After", () => {
  const h = rateLimitHeaders({ allowed: false, limit: 5, remaining: 0, resetSec: 42 });
  assert.equal(h["Retry-After"], "42");
  assert.equal(h["RateLimit-Limit"], "5");
  assert.equal(rateLimitHeaders({ allowed: true, limit: 5, remaining: 3, resetSec: 40 })["Retry-After"], undefined);
});
