"use strict";
/**
 * The owner-run scripts (scripts/verify_cloud.js, scripts/smoke_claude.js) exercised against a real local runtime so that, when
 * they are run against Railway, a result means something. Provider calls and the model are fixtures/stubs, as in every test here.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { modelStub, startReplica, makeKeyPair, tokenFor, uniq, infraSkip, resetInfra, FAKE_ANTHROPIC_KEY } = require("./helpers");
const fx = require("./paperFixtures");

const root = path.resolve(__dirname, "../../..");
const V = require(path.join(root, "scripts/verify_cloud.js"));
const skip = infraSkip();
const keys = makeKeyPair("cs-key");
const ORIGIN = "https://shords.test";
const REAL_IP = "198.51.100.42";

const by = (results) => Object.fromEntries(results.map((r) => [r.check, r]));

test("verify_cloud.js against a real runtime", { skip }, async (t) => {
  await resetInfra();
  const R = await startReplica({ keys, highLimits: false, env: { NETWORK_DIAGNOSTICS: "true", TRUST_PROXY: "true", TRUST_PROXY_HOPS: "1", CORS_ORIGINS: ORIGIN, RATE_LIMIT_READ_USER: "8/60", RATE_LIMIT_GLOBAL_IP: "1000/60" } });
  t.after(() => R.close());
  const token = tokenFor(keys, uniq("owner-"));

  await t.test("a correctly configured deployment: everything PASSes, the token never appears in the output", async () => {
    const lines = [];
    const { results, exitCode } = await V.run({ baseUrl: R.base, origin: ORIGIN, token, probeRateLimit: true, simulateProxyIp: REAL_IP, getPublicIp: async () => REAL_IP, report: (l) => lines.push(l) });
    const r = by(results);
    for (const k of ["health", "ready.database", "ready.redis", "auth.missing_token_is_401", "auth.forged_token_is_401", "cors.allowed_origin", "cors.other_origin_refused", "cors.never_wildcard", "proxy.hops", "proxy.spoofed_prefix_ignored", "auth.projects_with_token", "auth.token_not_echoed", "ratelimit.user_read_limit"]) {
      assert.equal(r[k] && r[k].status, "PASS", `${k}: ${JSON.stringify(r[k])}`);
    }
    assert.equal(r["proxy.hops"].thisMachinePositionFromRight, 1);
    assert.equal(r["ratelimit.user_read_limit"].requestsBeforeFirst429 <= 9, true, "the configured limit (8) answered 429");
    assert.ok(["PASS", "FAIL", "NOT_VERIFIED"].includes(r["ready.auth"].status));
    assert.equal(JSON.stringify(lines).includes(token), false, "the token is never printed");
    assert.equal(exitCode === 0 || exitCode === 2, true);
  });

  await t.test("a wrong hop count is a FAIL with the corrective setting spelled out", async () => {
    const two = await startReplica({ keys, highLimits: false, env: { NETWORK_DIAGNOSTICS: "true", TRUST_PROXY: "true", TRUST_PROXY_HOPS: "2", CORS_ORIGINS: ORIGIN } });
    try {
      // the hosting platform puts exactly one proxy in front: XFF = "<client>" only, so hops=2 would read nothing/the wrong entry
      const { results } = await V.run({ baseUrl: two.base, origin: ORIGIN, simulateProxyIp: REAL_IP, getPublicIp: async () => REAL_IP, report: () => {} });
      const hops = by(results)["proxy.hops"];
      assert.equal(hops.status, "FAIL");
      assert.match(hops.recommendation, /TRUST_PROXY_HOPS=1/);
    } finally {
      await two.close();
    }
  });

  await t.test("diagnostics off => the hop check says NOT_VERIFIED instead of guessing; missing token => NOT_VERIFIED", async () => {
    const off = await startReplica({ keys, highLimits: false, env: { TRUST_PROXY: "true", CORS_ORIGINS: ORIGIN } });
    try {
      const { results, exitCode } = await V.run({ baseUrl: off.base, origin: ORIGIN, report: () => {} });
      const r = by(results);
      assert.equal(r["proxy.hops"].status, "NOT_VERIFIED");
      assert.equal(r["auth.projects_with_token"].status, "NOT_VERIFIED");
      assert.equal(exitCode, 2, "unverified required checks are not a pass");
    } finally {
      await off.close();
    }
  });

  await t.test("a wrong CORS origin is a FAIL; an unreachable host is NOT_VERIFIED (never PASS)", async () => {
    const { results } = await V.run({ baseUrl: R.base, origin: "https://not-allowed.example", report: () => {} });
    assert.equal(by(results)["cors.allowed_origin"].status, "FAIL");
    const dead = await V.run({ baseUrl: "http://127.0.0.1:1", report: () => {} });
    assert.equal(dead.exitCode, 2);
    assert.equal(dead.results[0].status, "NOT_VERIFIED");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
const S = require(path.join(root, "scripts/smoke_claude.js"));

test("smoke_claude.js against a real runtime (the model is a test stub that stands in for Claude)", { skip }, async (t) => {
  await resetInfra();
  const owner = uniq("smoke-owner-");
  const token = tokenFor(keys, owner);
  const paper = `doi:${fx.FIXTURE_DOI}`;
  const mkReplica = async (env, client) => {
    const R = await startReplica({ keys, worker: true, overrides: { client }, env: { CORS_ORIGINS: ORIGIN, JOB_MAINTENANCE_SEC: "1", JOB_HEARTBEAT_SEC: "1", JOB_LEASE_SEC: "30", ...env } });
    await R.start(); // migrations + the job worker
    return R;
  };
  const mkProject = async (R) => (await R.call("POST", "/api/v1/projects", { token, body: { name: "Smoke" } })).json.projectId;

  await t.test("a healthy deployment with a key: every check PASSes and every requested number is captured", async () => {
    const stub = modelStub({ costUsd: null, costStatus: "NOT_AVAILABLE" });
    const R = await mkReplica({ ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }, stub);
    try {
      const projectId = await mkProject(R);
      const lines = [];
      // the readiness probe would hit api.anthropic.com with the fake key; the test stands in for "REACHABLE" at the HTTP layer
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        const u = String(url);
        if (u.endsWith("/ready")) { const r = await realFetch(url, init); const j = await r.json(); j.checks.aiProvider = { status: "REACHABLE", model: "claude-sonnet-5-5" }; return new Response(JSON.stringify(j), { status: 200 }); }
        return realFetch(url, init);
      };
      let out;
      try {
        out = await S.run({ baseUrl: R.base, token, projectId, paper, pollMs: 50, report: (l) => lines.push(l) });
      } finally {
        globalThis.fetch = realFetch;
      }
      const failed = out.checks.filter((c) => c.status !== "PASS");
      assert.deepEqual(failed, [], JSON.stringify(failed));
      assert.equal(out.exitCode, 0);
      const c = out.captured;
      for (const k of ["requestId", "paperId", "contentHash", "model", "inputTokens", "outputTokens", "totalTokens", "latencyMs", "cacheStatus", "fallbackUsed", "verificationStatus", "provider"]) assert.notEqual(c[k], null, `${k} captured`);
      assert.deepEqual([c.model, c.provider, c.fallbackUsed, c.verificationStatus, c.cacheStatus], ["claude-sonnet-5-5", "anthropic", false, "UNVERIFIED", "MISS"]);
      assert.equal(c.costUsd, null, "cost is null (not invented) when the server has no verified price");
      assert.equal(stub.calls.length, 1, "exactly ONE model call: the repeat was served from the cache");
      assert.equal(JSON.stringify(lines).includes(token), false, "the token is never printed");
      assert.doesNotMatch(JSON.stringify(lines), /Sparse Attention Routing introduces|chunk text/i);
    } finally {
      await R.close();
    }
  });

  await t.test("no key on the server: the run STOPS before any model call (exit 2), and a fallback is never reported as Claude", async () => {
    const stub = modelStub();
    const R = await mkReplica({ ANTHROPIC_API_KEY: undefined }, stub);
    try {
      const projectId = await mkProject(R);
      const out = await S.run({ baseUrl: R.base, token, projectId, paper, pollMs: 50, report: () => {} });
      assert.equal(out.exitCode, 2);
      assert.equal(stub.calls.length, 0);
    } finally {
      await R.close();
    }
  });

  await t.test("a labelled fallback that reaches the script (provider failure) is a FAIL, not 'real Claude'", async () => {
    const failing = { callMessages: async () => { const { ClientError } = require("../../llm/anthropicClient"); throw new ClientError("PROVIDER_5XX", "boom", { httpStatus: 503 }); } };
    const R = await mkReplica({ ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }, failing);
    try {
      const projectId = await mkProject(R);
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (String(url).endsWith("/ready")) { const r = await realFetch(url, init); const j = await r.json(); j.checks.aiProvider = { status: "REACHABLE", model: "claude-sonnet-5-5" }; return new Response(JSON.stringify(j), { status: 200 }); }
        return realFetch(url, init);
      };
      let out;
      try {
        out = await S.run({ baseUrl: R.base, token, projectId, paper, pollMs: 50, report: () => {} });
      } finally {
        globalThis.fetch = realFetch;
      }
      assert.equal(out.exitCode, 1);
      const real = out.checks.find((c) => c.check.startsWith("real Claude answered"));
      assert.equal(real && real.status, "FAIL");
      assert.equal(real.fallbackUsed, true);
    } finally {
      await R.close();
    }
  });

  await t.test("a paper without full text stops the run before any spend", async () => {
    const stub = modelStub();
    const R = await mkReplica({ ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }, stub);
    try {
      const projectId = await mkProject(R);
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (String(url).endsWith("/ready")) { const r = await realFetch(url, init); const j = await r.json(); j.checks.aiProvider = { status: "REACHABLE", model: "claude-sonnet-5-5" }; return new Response(JSON.stringify(j), { status: 200 }); }
        return realFetch(url, init);
      };
      let out;
      try {
        out = await S.run({ baseUrl: R.base, token, projectId, paper: `doi:${fx.DOI_ABSTRACT}`, pollMs: 50, report: () => {} });
      } finally {
        globalThis.fetch = realFetch;
      }
      assert.equal(out.exitCode, 2);
      assert.equal(stub.calls.length, 0);
    } finally {
      await R.close();
    }
  });
});
