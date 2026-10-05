"use strict";
/**
 * "Never log" guard (docs/architecture/OBSERVABILITY_STRATEGY.md): drive the real handler with logging ON and prove that nothing
 * sensitive reaches any log line: bearer tokens, the model API key, question text, paper text, user ids or e-mail addresses.
 * Every level (log/info/warn/error/debug) is captured. Local infrastructure only; the model is a stub.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fx = require("./paperFixtures");
const { startReplica, makeKeyPair, tokenFor, uniq, ipHeader, infraSkip, resetInfra, modelStub, FAKE_ANTHROPIC_KEY } = require("./helpers");

const skip = infraSkip();
const keys = makeKeyPair("log-key");
const PAPER = `doi:${fx.FIXTURE_DOI}`;

test("log safety: no secret, token, question, paper text or raw user id in any log line", { skip }, async () => {
  await resetInfra();
  const lines = [];
  const cap = (...a) => lines.push(a.map(String).join(" "));
  const logger = { log: cap, info: cap, warn: cap, error: cap, debug: cap };
  const R = await startReplica({ keys, overrides: { logger, logRequests: true, client: modelStub() }, env: { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY } });
  const uid = uniq("canary-uid-");
  const token = tokenFor(keys, uid);
  const QUESTION = "CANARY-QUESTION-7f3b which accuracy was reached";
  try {
    const p = (await R.call("POST", "/api/v1/projects", { token, body: { name: "CANARY-PROJECT-NAME" }, headers: ipHeader() })).json;
    await R.call("POST", "/api/v1/copilot/query", { token, body: { projectId: p.projectId, paperId: PAPER, query: QUESTION }, headers: ipHeader() });
    await R.call("POST", "/api/v1/analysis", { token, body: { projectId: p.projectId, paperId: PAPER }, headers: ipHeader() });
    await R.call("GET", "/api/v1/projects", { token: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.sig", headers: ipHeader() }); // forged token
    await R.call("GET", "/api/v1/projects", { headers: { authorization: "Bearer " + token + "x", ...ipHeader() } }); // tampered token
    await R.call("POST", "/api/v1/copilot/query", { token, rawBody: "{not json", headers: ipHeader() });
    // a provider failure whose message contains the key must not be logged
    const failing = await startReplica({ keys, overrides: { logger, logRequests: true, client: { async callMessages() { throw Object.assign(new Error(`upstream said key ${FAKE_ANTHROPIC_KEY} is bad`), { category: "INVALID_CREDENTIAL", httpStatus: 401 }); } } }, env: { ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY } });
    try {
      const p2 = (await failing.call("POST", "/api/v1/projects", { token, body: { name: "x" }, headers: ipHeader() })).json;
      await failing.call("POST", "/api/v1/copilot/query", { token, body: { projectId: p2.projectId, paperId: PAPER, query: QUESTION }, headers: ipHeader() });
    } finally { await failing.close(); }
  } finally { await R.close(); }

  const all = lines.join("\n");
  assert.ok(lines.length > 5, `expected request log lines, got ${lines.length} (logging must have been on for this test to mean anything)`);
  assert.ok(lines.some((l) => l.includes('"evt":"http"')), "structured http log lines are present");
  const forbidden = {
    "bearer token": token,
    "token payload segment": token.split(".")[1],
    "token signature": token.split(".")[2],
    "model API key": FAKE_ANTHROPIC_KEY,
    "question text": "CANARY-QUESTION",
    "project name": "CANARY-PROJECT-NAME",
    "raw user id": uid,
    "e-mail address": `${uid}@example.test`,
    "paper abstract": "lose recall on distant evidence",
    "paper body": "routes tokens to a small set of learned memory slots"
  };
  for (const [what, needle] of Object.entries(forbidden)) assert.equal(all.includes(needle), false, `${what} appeared in a log line`);
  assert.equal(/Bearer\s+[A-Za-z0-9._-]{20,}/.test(all), false, "a bearer credential shape appeared in the logs");
  assert.equal(/\beyJ[A-Za-z0-9_-]{10,}\./.test(all), false, "a JWT-shaped string appeared in the logs");
});
