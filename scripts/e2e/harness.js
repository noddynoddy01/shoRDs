"use strict";
/**
 * Starts the whole local test stack in ONE process: real backend runtime (PostgreSQL + Redis, *_test only), static web server with SPA
 * fallback, and the AI stub. See README.md for exactly what is real and what is mocked.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
process.env.E2E_BACKEND_PORT = process.env.E2E_BACKEND_PORT || "8787";
const H = require("../../backend/tests/node/helpers");
const { createFakeFirebase, uidFor } = require("./fakeFirebase");

const ADMIN_EMAIL = "admin@e2e.test";
const MIME = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".png": "image/png", ".ttf": "font/ttf", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

/** One stub for both users of the model: the Assistant (plain answer) and the Research Copilot (excerpt-citing answer). Every answer says it is a stub. */
function createStub() {
  const copilot = H.modelStub({ requestId: "req_stub_copilot" });
  const stub = {
    calls: [],
    async callMessages(opts) {
      stub.calls.push({ kind: /<excerpt /.test(opts.user || "") ? "copilot" : "assistant", at: Date.now() });
      if (/<excerpt /.test(opts.user || "")) return copilot.callMessages(opts);
      const q = ((opts.user || "").match(/<question>\s*([\s\S]*?)\s*<\/question>/) || [])[1] || "";
      return { text: `[TEST STUB] This answer comes from a test stub, not a real model. Your question was: "${q.slice(0, 120)}". In shoRDs you can browse verified mentors from the **Mentors** tab and read your requests under **Mentorship**.`, usage: { inputTokens: 900, outputTokens: 60, totalTokens: 960 }, stopReason: "end_turn", truncated: false, model: opts.model, latencyMs: 5, attempts: 1, requestId: "req_stub_asst", costUsd: 0.0001, costStatus: "ESTIMATED" };
    }
  };
  return stub;
}

async function startHarness({ webRoot, webPort = 8099, backendPort = 8787 } = {}) {
  const skip = H.infraSkip();
  if (skip) throw new Error(skip);
  await H.resetInfra();
  const keys = H.makeKeyPair("e2e-key");
  const stub = createStub();
  const adminUid = uidFor(ADMIN_EMAIL);
  const R = await H.startReplica({
    keys, worker: true,
    env: { ADMIN_UIDS: adminUid, ANTHROPIC_API_KEY: H.FAKE_ANTHROPIC_KEY, CORS_ORIGINS: `http://127.0.0.1:${webPort}`, TRUST_PROXY: "false" },
    overrides: { client: stub }
  });
  R.start();
  const web = http.createServer((req, res) => {
    const p = decodeURIComponent((req.url || "/").split("?")[0]);
    let f = path.join(webRoot, p);
    if (!f.startsWith(webRoot) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(webRoot, "index.html");
    res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => web.listen(webPort, "127.0.0.1", r));
  const fb = createFakeFirebase({ keys });
  const token = (email) => H.tokenFor(keys, uidFor(email), { email });
  const api = (email, method, p, body) => R.call(method, p, { token: token(email), body, headers: H.ipHeader() });
  return {
    R, stub, fb, keys, adminUid, ADMIN_EMAIL, webBase: `http://127.0.0.1:${webPort}`, apiBase: R.base, token, api, uidFor,
    async close() { await new Promise((r) => web.close(r)); web.closeAllConnections && web.closeAllConnections(); await R.close(); }
  };
}
module.exports = { startHarness, ADMIN_EMAIL };
