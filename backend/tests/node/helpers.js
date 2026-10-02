"use strict";
/** Shared test helpers: real RS256 token signing, a fake JWKS endpoint, and a real-HTTP test server around the real app. */

const crypto = require("crypto");
const http = require("http");

const TEST_PROJECT_ID = "shords-test-project";
// A syntactically valid fake credential. It is never sent anywhere: model calls go to an injected stub client.
const FAKE_ANTHROPIC_KEY = "TESTKEY-not-a-real-credential-0001";

function makeKeyPair(kid = "test-key-1") {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
  return { kid, privateKey, publicKey, jwk };
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");

function signJwt({ header, payload, privateKey, kid, alg = "RS256", secret }) {
  const h = b64u(JSON.stringify({ alg, typ: "JWT", kid, ...header }));
  const p = b64u(JSON.stringify(payload));
  const input = `${h}.${p}`;
  let sig;
  if (alg === "RS256") sig = crypto.sign("RSA-SHA256", Buffer.from(input), privateKey);
  else if (alg === "HS256") sig = crypto.createHmac("sha256", secret).update(input).digest();
  else sig = Buffer.alloc(0); // alg none
  return `${input}.${b64u(sig)}`;
}

function firebasePayload(uid, over = {}, nowMs = Date.now(), projectId = TEST_PROJECT_ID) {
  const now = Math.floor(nowMs / 1000);
  return {
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
    sub: uid,
    auth_time: now - 10,
    iat: now - 5,
    exp: now + 3600,
    email: `${uid}@example.test`,
    email_verified: true,
    firebase: { sign_in_provider: "password" },
    ...over
  };
}

function tokenFor(keys, uid, over = {}, nowMs) {
  return signJwt({ privateKey: keys.privateKey, kid: keys.kid, payload: firebasePayload(uid, over, nowMs) });
}

const uniq = (p) => `${p}${crypto.randomBytes(5).toString("hex")}`;

/** Start a real HTTP server around a handler on an ephemeral port. */
function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => r()); })
      });
    });
  });
}

/** fetch wrapper returning { status, headers, json } (json null when the body is empty / not JSON). */
async function call(base, method, path, { token, body, headers = {}, rawBody } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (rawBody !== undefined) payload = rawBody;
  else if (body !== undefined) {
    payload = JSON.stringify(body);
    h["content-type"] = h["content-type"] || "application/json";
  }
  const res = await fetch(base + path, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), json, text };
}

const silentLogger = { log() {}, warn() {}, error() {}, info() {}, debug() {} };

/** Integration infra comes from the environment (see scratchpad/infra.sh / docker-compose.yml). */
const INFRA = {
  databaseUrl: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || null,
  redisUrl: process.env.TEST_REDIS_URL || process.env.REDIS_URL || null
};
const infraSkip = () => {
  if (!INFRA.databaseUrl || !INFRA.redisUrl) return "integration infra not configured (set TEST_DATABASE_URL and TEST_REDIS_URL)";
  const dbName = decodeURIComponent(new URL(INFRA.databaseUrl).pathname.slice(1));
  const hosts = [new URL(INFRA.databaseUrl).hostname, new URL(INFRA.redisUrl).hostname];
  if (!dbName.endsWith("_test") || !hosts.every((h) => h === "127.0.0.1" || h === "localhost")) {
    return "refusing to run destructive integration tests: database must be named *_test and both services must be on localhost";
  }
  return false;
};

/** Reset the (verified local, *_test) database and Redis to a known state. */
async function resetInfra() {
  const { PgPool } = require("../../data/pgClient");
  const { RedisClient } = require("../../data/redisClient");
  const { runMigrations } = require("../../data/migrations");
  const pool = new PgPool({ url: INFRA.databaseUrl, max: 2 });
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await runMigrations(pool);
  await pool.end();
  const r = new RedisClient({ url: INFRA.redisUrl });
  await r.command("FLUSHDB");
  await r.close();
}

const HIGH_LIMITS = (() => {
  const { DEFAULT_POLICIES } = require("../../security/rateLimit");
  return Object.fromEntries(Object.keys(DEFAULT_POLICIES).map((k) => [`RATE_LIMIT_${k}`, "1000000/60"]));
})();

/**
 * Start one real replica: the real runtime (PostgreSQL pool, Redis client, rate limiter, cache, job store, optional
 * worker) behind a real HTTP listener. Token verification is the real RS256 verifier fed by a fake JWKS endpoint.
 */
async function startReplica({ env = {}, overrides = {}, keys = null, replicaId = uniq("replica-"), worker = false, highLimits = true } = {}) {
  const { createRuntime } = require("../../runtime");
  const { createFirebaseVerifier } = require("../../security/auth");
  const fullEnv = {
    NODE_ENV: "production",
    DATABASE_URL: INFRA.databaseUrl,
    REDIS_URL: INFRA.redisUrl,
    FIREBASE_PROJECT_ID: TEST_PROJECT_ID,
    CORS_ORIGINS: "https://shords.test",
    TRUST_PROXY: "true",
    WORKER_ENABLED: worker ? "true" : "false",
    JOB_BLOCK_SEC: "1",
    ...(highLimits ? HIGH_LIMITS : {}),
    ...env
  };
  for (const [k, v] of Object.entries(fullEnv)) if (v === undefined) delete fullEnv[k];
  const verifier = keys ? createFirebaseVerifier({ projectId: TEST_PROJECT_ID, fetchJwks: async () => ({ keys: [keys.jwk], maxAgeSec: 3600 }) }) : undefined;
  const runtime = createRuntime(fullEnv, { verifier, logger: silentLogger, logRequests: false, replicaId, ...overrides });
  const srv = await listen(runtime.handler);
  return {
    runtime,
    base: srv.base,
    replicaId,
    call: (method, path, opts) => call(srv.base, method, path, opts),
    start: () => runtime.startBackground(),
    async close() {
      await srv.close();
      await runtime.shutdown(2000);
    }
  };
}

/** X-Forwarded-For as a trusted single proxy appends it: "<spoofed by client>, <real client ip>". Default: a fresh random IP. */
const ipHeader = (ip = `198.51.100.${1 + Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 1e6)}`) => ({ "x-forwarded-for": `6.6.6.6, ${ip}` });

module.exports = { HIGH_LIMITS, startReplica, ipHeader, TEST_PROJECT_ID, FAKE_ANTHROPIC_KEY, makeKeyPair, signJwt, firebasePayload, tokenFor, uniq, listen, call, silentLogger, INFRA, infraSkip, resetInfra };
