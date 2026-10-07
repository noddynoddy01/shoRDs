"use strict";
/**
 * P0.3: liveness vs readiness, and safe startup. No Postgres or Redis needed: dependencies are controlled fakes, and the real
 * entrypoint (node backend/start_local_server.js) is run as a child process with deliberately bad configuration.
 *  - /health never touches a dependency: 200 even when everything is down.
 *  - /ready reports the truth: 503 when a required dependency is missing/down/behind, 200 only when all required ones are OK.
 *  - While draining, /ready is 503 DRAINING and /health is still 200.
 *  - Invalid configuration (not merely missing) stops the process with exit code 1 and a message that never contains a value.
 *  - The deployment health check points at /ready, so a replica that is not ready never replaces a working one.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { createRuntime } = require("../../runtime");
const { parsePort, parseHost, BootConfigError } = require("../../bootConfig");
const { MIGRATIONS } = require("../../data/migrations");
const { silentLogger, listen, call } = require("./helpers");

const LATEST = Math.max(...MIGRATIONS.map((m) => m.version));
const ENTRY = path.resolve(__dirname, "../../start_local_server.js");
const okVerifier = { configured: true, status: async () => ({ configured: true, ready: true, keysLoaded: 2, lastError: null }), verify: async () => { throw new Error("unused"); } };
const aiReachable = async () => ({ status: "REACHABLE", detail: "OK", model: "m", probedAt: "t" });
const fakePool = (over = {}) => ({ ping: async () => ({ ok: true, latencyMs: 1 }), query: async () => ({ rows: [{ v: LATEST }] }), end: async () => {}, withClient: async () => { throw new Error("unused"); }, transaction: async () => { throw new Error("unused"); }, ...over });
const fakeRedis = (over = {}) => ({ ping: async () => ({ ok: true, latencyMs: 1 }), close: async () => {}, command: async () => null, eval: async () => null, duplicate() { return fakeRedis(); }, ...over });

async function serve(env, overrides) {
  const rt = createRuntime({ WORKER_ENABLED: "false", ...env }, { verifier: okVerifier, aiCheck: aiReachable, logger: silentLogger, logRequests: false, ...overrides });
  const l = await listen(rt.handler);
  return { rt, base: l.base, close: l.close };
}

test("liveness: /health is 200 even when no dependency is configured, and /ready says exactly what is missing", async () => {
  const s = await serve({}, { verifier: { configured: false, status: async () => ({ configured: false, ready: false, keysLoaded: 0, lastError: null }) } });
  try {
    assert.equal((await call(s.base, "GET", "/health")).status, 200);
    const r = await call(s.base, "GET", "/ready");
    assert.equal(r.status, 503);
    assert.equal(r.json.ready, false);
    assert.deepEqual([r.json.checks.database.status, r.json.checks.redis.status, r.json.checks.auth.status], ["NOT_CONFIGURED", "NOT_CONFIGURED", "NOT_CONFIGURED"]);
  } finally { await s.close(); }
});

test("liveness: /health stays 200 while /ready is 503 for each required dependency failing on its own", async () => {
  const cases = {
    database: { pool: fakePool({ ping: async () => ({ ok: false, latencyMs: 1, error: "PG_CONNECT_FAILED" }) }), redis: fakeRedis(), verifier: okVerifier, expect: "DOWN" },
    schema: { pool: fakePool({ query: async () => ({ rows: [{ v: LATEST - 1 }] }) }), redis: fakeRedis(), verifier: okVerifier, expect: "SCHEMA_NOT_READY" },
    redis: { pool: fakePool(), redis: fakeRedis({ ping: async () => ({ ok: false, latencyMs: 1, error: "REDIS_CONNECT_FAILED" }) }), verifier: okVerifier, expect: "DOWN" },
    auth: { pool: fakePool(), redis: fakeRedis(), verifier: { configured: true, status: async () => ({ configured: true, ready: false, keysLoaded: 0, lastError: { message: "x" } }) }, expect: "KEYS_UNAVAILABLE" }
  };
  for (const [name, c] of Object.entries(cases)) {
    const s = await serve({}, { pool: c.pool, redis: c.redis, verifier: c.verifier });
    try {
      assert.equal((await call(s.base, "GET", "/health")).status, 200, `${name}: alive`);
      const r = await call(s.base, "GET", "/ready");
      assert.equal(r.status, 503, `${name}: not ready`);
      const key = name === "schema" ? "database" : name;
      assert.equal(r.json.checks[key].status, c.expect, name);
    } finally { await s.close(); }
  }
});

test("readiness: 200 only when every required dependency is OK; an unreachable AI provider only degrades", async () => {
  const s = await serve({}, { pool: fakePool(), redis: fakeRedis(), aiCheck: async () => ({ status: "UNREACHABLE", detail: "NETWORK", model: "m", probedAt: null }) });
  try {
    const r = await call(s.base, "GET", "/ready");
    assert.equal(r.status, 200);
    assert.equal(r.json.status, "DEGRADED");
  } finally { await s.close(); }
  const strict = await serve({ REQUIRE_AI_PROVIDER: "true" }, { pool: fakePool(), redis: fakeRedis(), aiCheck: async () => ({ status: "UNREACHABLE", detail: "NETWORK", model: "m", probedAt: null }) });
  try {
    assert.equal((await call(strict.base, "GET", "/ready")).status, 503);
  } finally { await strict.close(); }
});

test("draining: /ready becomes 503 DRAINING (no new traffic) while /health stays 200", async () => {
  const s = await serve({}, { pool: fakePool(), redis: fakeRedis() });
  try {
    assert.equal((await call(s.base, "GET", "/ready")).status, 200);
    s.rt.beginDrain();
    const r = await call(s.base, "GET", "/ready");
    assert.equal(r.status, 503);
    assert.equal(r.json.status, "DRAINING");
    assert.equal((await call(s.base, "GET", "/health")).status, 200);
  } finally { await s.close(); }
});

test("a dependency check that hangs cannot hang /ready", async () => {
  const s = await serve({}, { pool: fakePool({ ping: () => new Promise(() => {}) }), redis: fakeRedis() });
  try {
    const t0 = Date.now();
    const r = await call(s.base, "GET", "/ready");
    assert.equal(r.status, 503);
    assert.equal(r.json.checks.database.error, "CHECK_TIMEOUT");
    assert.ok(Date.now() - t0 < 5000, "bounded by the per-check timeout");
  } finally { await s.close(); }
});

test("no readiness response contains a connection string, host or credential", async () => {
  const secretUrl = "postgresql://svc:s3cr3t-pw@db.internal.example:5432/prod";
  const s = await serve({}, { pool: fakePool({ ping: async () => ({ ok: false, latencyMs: 1, error: "PG_CONNECT_FAILED" }), query: async () => { throw Object.assign(new Error(`connect ECONNREFUSED ${secretUrl}`), { code: "PG_ERROR" }); } }), redis: fakeRedis() });
  try {
    const text = JSON.stringify((await call(s.base, "GET", "/ready")).json);
    assert.ok(!/s3cr3t-pw|db\.internal\.example|postgresql:\/\//.test(text));
  } finally { await s.close(); }
});

// ------------------------------------------------------------------------------------------------ boot configuration
test("parsePort / parseHost accept valid values and refuse anything else", () => {
  assert.equal(parsePort(undefined), 4000);
  assert.equal(parsePort(""), 4000);
  assert.equal(parsePort("8080"), 8080);
  assert.equal(parsePort(" 65535 "), 65535);
  for (const bad of ["0", "-1", "65536", "abc", "80x", "8080.5", "1e3", "http://x", "99999999"]) assert.throws(() => parsePort(bad), BootConfigError, bad);
  assert.equal(parseHost(undefined), "0.0.0.0");
  assert.equal(parseHost("127.0.0.1"), "127.0.0.1");
  assert.equal(parseHost("::"), "::");
  for (const bad of ["http://x", "a b", "host/path", "x;y"]) assert.throws(() => parseHost(bad), BootConfigError, bad);
});

function runEntry(env, ms = 6000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRY], { env: { PATH: process.env.PATH, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve({ code: "timeout", out }); }, ms);
    child.on("exit", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

test("the real entrypoint refuses to start on invalid configuration (exit 1, clear message, no values echoed)", async () => {
  const bad = [
    [{ PORT: "not-a-port" }, /PORT must be an integer/],
    [{ PORT: "70000" }, /PORT must be an integer/],
    [{ PORT: "4999", HOST: "http://bad" }, /HOST must be/],
    [{ PORT: "4999", RATE_LIMIT_READ_USER: "-5" }, /invalid configuration/],
    [{ PORT: "4999", AI_BUDGET_GLOBAL_DAILY_USD: "lots" }, /invalid configuration/],
    [{ PORT: "4999", AI_BUDGET_MODE: "yolo" }, /invalid configuration/]
  ];
  for (const [env, re] of bad) {
    const r = await runEntry(env);
    assert.equal(r.code, 1, JSON.stringify(env) + "\n" + r.out);
    assert.match(r.out, re);
    for (const v of Object.values(env)) if (v.length > 6) assert.ok(!r.out.includes(`"${v}"`), "value is not echoed");
  }
});

test("the real entrypoint exits 1 with a plain message if the port is taken", async () => {
  const port = await freePort();
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(port, "127.0.0.1", r));
  try {
    const r = await runEntry({ PORT: String(port), HOST: "127.0.0.1" });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /cannot listen on 127\.0\.0\.1:\d+ \(EADDRINUSE\)/);
  } finally { blocker.close(); }
});

test("the real entrypoint with no dependencies configured starts, is alive, and is NOT ready", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [ENTRY], { env: { PATH: process.env.PATH, PORT: String(port), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  try {
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      try { up = (await call(base, "GET", "/health")).status === 200; } catch (_) { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.ok(up, "alive: " + out);
    const r = await call(base, "GET", "/ready");
    assert.equal(r.status, 503);
    assert.equal(r.json.checks.database.status, "NOT_CONFIGURED");
    assert.equal(r.json.checks.redis.status, "NOT_CONFIGURED");
  } finally {
    const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
    child.kill("SIGTERM");
    assert.equal(await exited, 0, "clean exit on SIGTERM");
  }
});

test("the deployment health check is /ready (a replica that is not ready must not replace a working one)", () => {
  const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../railway.json"), "utf8"));
  assert.equal(cfg.deploy.healthcheckPath, "/ready");
  assert.equal(cfg.deploy.startCommand, "node backend/start_local_server.js");
});
