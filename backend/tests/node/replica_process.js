"use strict";
/**
 * TEST HELPER (not production code): one replica as a separate OS process, built with the production runtime assembly
 * (backend/runtime.js). It differs from backend/start_local_server.js only in two test seams: the token verifier is fed
 * a test public key (TEST_JWK) instead of Google's JWKS, and the model client is a stub (no network, no key).
 */
const http = require("http");
const { createRuntime } = require("../../runtime");
const { createFirebaseVerifier } = require("../../security/auth");

const env = { ...process.env };
const jwk = JSON.parse(env.TEST_JWK);
const verifier = createFirebaseVerifier({ projectId: env.FIREBASE_PROJECT_ID, fetchJwks: async () => ({ keys: [jwk], maxAgeSec: 3600 }) });
const delay = Number(env.TEST_MODEL_DELAY_MS || 0);
// Stand-ins for the two network dependencies: a well-behaved model stub and the fictional provider fixtures.
// (The model's provider request id carries this process's pid, so tests can see which OS process made the call.)
const { modelStub } = require("./helpers");
const { createFixtureHttp } = require("./paperFixtures");
const client = modelStub({ requestId: `stub-pid-${process.pid}`, delayMs: delay });
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const runtime = createRuntime(env, { verifier, client, http: createFixtureHttp(), logger: quiet, logRequests: false });
const server = http.createServer(runtime.handler);
server.listen(Number(env.PORT), "127.0.0.1", () => {
  runtime.startBackground();
  process.stdout.write(`LISTENING ${env.PORT} pid=${process.pid}\n`);
});
process.on("SIGTERM", async () => { server.close(); await runtime.shutdown(2000); process.exit(0); });
