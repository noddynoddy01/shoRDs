#!/usr/bin/env node
"use strict";
/**
 * Cloud verification of a DEPLOYED shoRDs backend (Railway) from outside. Zero dependencies (Node 18+). It never prints or
 * stores a token and never sends an Anthropic key; it needs no secrets except an optional Firebase ID token.
 *
 *   SHORDS_API_URL=https://<railway-backend>   SHORDS_ORIGIN=https://<vercel-site>   [SHORDS_ID_TOKEN=<token>]
 *   node scripts/verify_cloud.js [--probe-rate-limit] [--expect-ai]
 * (--expect-ai: use after the Anthropic key is set; requires the provider probe to be REACHABLE)
 *
 * Getting a token (never paste it into a chat or a file): sign in on the Vercel site, open DevTools -> Network, click the
 * request to /api/v1/projects, and copy the part of the `Authorization` request header after "Bearer ". Put it in your shell
 * environment for this one command (e.g. PowerShell: $env:SHORDS_ID_TOKEN = Read-Host; bash: read -s SHORDS_ID_TOKEN; export
 * SHORDS_ID_TOKEN). It expires within an hour.
 *
 * Each check prints one JSON line: PASS | FAIL | NOT_VERIFIED | SKIPPED. Exit 0 only if nothing FAILed AND nothing needed was
 * NOT_VERIFIED; 1 on any FAIL; 2 if there were no FAILs but a required check could not be verified.
 *
 * For the proxy hop-count check, set NETWORK_DIAGNOSTICS=true on Railway while you run this, then REMOVE it.
 */
const crypto = require("crypto");

const tag = (ip) => crypto.createHash("sha256").update(String(ip)).digest("hex").slice(0, 12);

function normalizeBase(u) {
  const url = new URL(u);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("SHORDS_API_URL must be https (http only for localhost)");
  return url.origin;
}

/**
 * @param {object} o
 * @param {string} o.baseUrl @param {string} [o.origin] @param {string} [o.token]
 * @param {boolean} [o.expectAi] require aiProvider REACHABLE (after the Anthropic key is set)
 * @param {boolean} [o.probeRateLimit] @param {(url:string)=>Promise<string>} [o.getPublicIp]
 * @param {string} [o.simulateProxyIp] testing seam: act like a trusted proxy that appends this client IP to X-Forwarded-For
 * @param {(line:object)=>void} [o.report]
 */
async function run(o) {
  const base = normalizeBase(o.baseUrl);
  const report = o.report || ((l) => console.log(JSON.stringify(l)));
  const results = [];
  const rec = (name, status, detail = {}) => {
    const line = { check: name, ...detail, status }; // `status` is always the verdict, whatever the detail carries
    results.push(line);
    report(line);
    return status;
  };
  const call = async (method, path, { token, origin, headers = {}, body } = {}) => {
    const h = { accept: "application/json", ...headers };
    if (o.simulateProxyIp) h["x-forwarded-for"] = (h["x-forwarded-for"] ? `${h["x-forwarded-for"]}, ` : "") + o.simulateProxyIp;
    if (token) h.authorization = `Bearer ${token}`;
    if (origin) h.origin = origin;
    if (body !== undefined) h["content-type"] = "application/json";
    const t0 = Date.now();
    try {
      const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(20000) });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) { /* not json */ }
      return { status: r.status, headers: r.headers, text, json, ms: Date.now() - t0 };
    } catch (e) {
      return { status: 0, error: String((e && e.cause && e.cause.code) || (e && e.name) || e).slice(0, 80), ms: Date.now() - t0 };
    }
  };

  // 1. reachable + liveness
  const health = await call("GET", "/health");
  if (health.status !== 200) {
    rec("health", health.status === 0 ? "NOT_VERIFIED" : "FAIL", { httpStatus: health.status, error: health.error });
    if (health.status === 0) return { results, exitCode: 2 }; // nothing else can be checked
  } else rec("health", "PASS", { ms: health.ms });

  // 2. readiness: database, redis, auth (Google keys reachable from the server), AI provider
  const ready = await call("GET", "/ready");
  const c = ready.json && ready.json.checks;
  if (!c) rec("ready", "FAIL", { httpStatus: ready.status, note: "no checks in the response" });
  else {
    rec("ready.database", c.database && c.database.status === "OK" ? "PASS" : "FAIL", { reported: c.database && c.database.status, schema: c.database && c.database.schema });
    rec("ready.redis", c.redis && c.redis.status === "OK" ? "PASS" : "FAIL", { reported: c.redis && c.redis.status, detail: c.redis && c.redis.error });
    const a = c.auth || {};
    rec("ready.auth", a.status === "OK" ? "PASS" : "FAIL", {
      reported: a.status,
      keysLoaded: a.keysLoaded,
      hint: a.status === "KEYS_UNAVAILABLE" ? "the server could not download Google's signing keys (www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com): check Railway egress/DNS" : a.status === "NOT_CONFIGURED" ? "FIREBASE_PROJECT_ID is not set on Railway" : undefined
    });
    const ai = c.aiProvider || {};
    const aiOk = o.expectAi ? ai.status === "REACHABLE" : ai.status === "NOT_CONFIGURED" || ai.status === "REACHABLE";
    rec("ready.aiProvider", aiOk ? "PASS" : "FAIL", { reported: ai.status, detail: ai.detail, model: ai.model, expected: o.expectAi ? "REACHABLE (the key is set)" : "NOT_CONFIGURED (before the key) or REACHABLE" });
    rec("ready.overall", ready.status === 200 && ready.json.ready === true ? "PASS" : "NOT_VERIFIED", { httpStatus: ready.status, ready: ready.json.ready, note: "overall readiness reflects actual configuration; it is false while auth or a required dependency is down" });
  }

  // 3. unauthenticated / forged requests are refused
  const noTok = await call("GET", "/api/v1/projects");
  rec("auth.missing_token_is_401", noTok.status === 401 ? "PASS" : "FAIL", { httpStatus: noTok.status, code: noTok.json && noTok.json.error });
  const forged = await call("GET", "/api/v1/projects", { token: "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0." });
  rec("auth.forged_token_is_401", forged.status === 401 ? "PASS" : "FAIL", { httpStatus: forged.status, code: forged.json && forged.json.error });

  // 4. CORS
  if (!o.origin) rec("cors", "SKIPPED", { note: "set SHORDS_ORIGIN to the Vercel site origin" });
  else {
    const pre = await call("OPTIONS", "/api/v1/copilot/query", { origin: o.origin, headers: { "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
    const acao = pre.headers && pre.headers.get("access-control-allow-origin");
    rec("cors.allowed_origin", pre.status >= 200 && pre.status < 300 && acao === o.origin ? "PASS" : "FAIL", { httpStatus: pre.status, allowOrigin: acao });
    const evil = await call("OPTIONS", "/api/v1/copilot/query", { origin: "https://evil.example", headers: { "access-control-request-method": "POST" } });
    const eAcao = evil.headers && evil.headers.get("access-control-allow-origin");
    rec("cors.other_origin_refused", !eAcao && evil.status !== 200 && evil.status !== 204 ? "PASS" : "FAIL", { httpStatus: evil.status, allowOrigin: eAcao || null });
    rec("cors.never_wildcard", acao !== "*" && eAcao !== "*" ? "PASS" : "FAIL", {});
  }

  // 5. proxy hop count: which client IP does the server see?
  const diag = await call("GET", "/api/v1/replica");
  const net = diag.json && diag.json.network;
  if (!net) rec("proxy.hops", "NOT_VERIFIED", { note: "set NETWORK_DIAGNOSTICS=true on Railway while running this check, then remove it" });
  else {
    let myIp = null;
    try {
      myIp = (o.getPublicIp ? await o.getPublicIp() : await (await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(8000) })).text()).trim();
    } catch (_) { /* reported below */ }
    if (!myIp) rec("proxy.hops", "NOT_VERIFIED", { note: "could not determine this machine's public IP (api.ipify.org unreachable)", forwardedForEntries: net.forwardedForEntries, configuredHops: net.trustProxyHops });
    else {
      const mine = tag(myIp);
      const match = (net.fromRightTags || []).find((e) => e.tag === mine);
      const resolvedIsMe = net.resolvedClientIpTag === mine;
      rec("proxy.hops", net.trustProxy && resolvedIsMe ? "PASS" : "FAIL", {
        trustProxy: net.trustProxy, configuredHops: net.trustProxyHops, forwardedForEntries: net.forwardedForEntries,
        resolvedIsThisMachine: resolvedIsMe, thisMachinePositionFromRight: match ? match.fromRight : null,
        recommendation: resolvedIsMe ? "configured hop count is correct" : match ? `set TRUST_PROXY=true and TRUST_PROXY_HOPS=${match.fromRight}` : "this machine's IP is not in X-Forwarded-For (a VPN or another proxy may differ from api.ipify.org): re-run without a VPN"
      });
      // a client-supplied X-Forwarded-For prefix must not change which IP is used
      const spoofed = await call("GET", "/api/v1/replica", { headers: { "x-forwarded-for": "203.0.113.200, 203.0.113.201" } });
      const sn = spoofed.json && spoofed.json.network;
      rec("proxy.spoofed_prefix_ignored", sn && sn.resolvedClientIpTag !== tag("203.0.113.200") && sn.resolvedClientIpTag !== tag("203.0.113.201") ? "PASS" : "FAIL", { resolvedIsAnyForgedEntry: !sn ? null : [tag("203.0.113.200"), tag("203.0.113.201")].includes(sn.resolvedClientIpTag) });
    }
  }

  // 6. authenticated request (what the frontend does)
  if (!o.token) rec("auth.projects_with_token", "NOT_VERIFIED", { note: "set SHORDS_ID_TOKEN to a fresh Firebase ID token" });
  else {
    const r = await call("GET", "/api/v1/projects", { token: o.token, origin: o.origin });
    const listed = r.json && Array.isArray(r.json.projects);
    rec("auth.projects_with_token", r.status === 200 && listed ? "PASS" : "FAIL", { httpStatus: r.status, code: r.json && r.json.error, projects: listed ? r.json.projects.length : null });
    rec("auth.token_not_echoed", r.text && !r.text.includes(o.token) && !JSON.stringify([...(r.headers ? r.headers.entries() : [])]).includes(o.token) ? "PASS" : "FAIL", {});
    if (o.probeRateLimit) {
      let first = null; let info = null; let n = 0;
      for (; n < 400; n++) {
        const x = await call("GET", "/api/v1/projects", { token: o.token });
        if (x.status === 429) { first = n + 1; info = { retryAfter: x.headers.get("retry-after"), limit: x.headers.get("ratelimit-limit"), code: x.json && x.json.error }; break; }
        if (x.status !== 200) { info = { unexpectedStatus: x.status }; break; }
      }
      rec("ratelimit.user_read_limit", first ? "PASS" : "FAIL", { requestsBeforeFirst429: first, ...info, note: "default READ_USER is 240 per 60 s; this uses up your own budget for about a minute" });
    } else rec("ratelimit.user_read_limit", "SKIPPED", { note: "pass --probe-rate-limit to send requests until the limit answers 429 (uses your own per-user budget for ~1 minute)" });
  }

  const fails = results.filter((r) => r.status === "FAIL").length;
  const unverified = results.filter((r) => r.status === "NOT_VERIFIED").length;
  report({ summary: { pass: results.filter((r) => r.status === "PASS").length, fail: fails, notVerified: unverified, skipped: results.filter((r) => r.status === "SKIPPED").length } });
  return { results, exitCode: fails ? 1 : unverified ? 2 : 0 };
}

module.exports = { run, tag };

if (require.main === module) {
  const baseUrl = process.env.SHORDS_API_URL;
  if (!baseUrl) {
    console.error("SHORDS_API_URL is required, e.g. https://your-backend.up.railway.app");
    process.exit(1);
  }
  run({ baseUrl, origin: process.env.SHORDS_ORIGIN, token: process.env.SHORDS_ID_TOKEN, probeRateLimit: process.argv.includes("--probe-rate-limit"), expectAi: process.argv.includes("--expect-ai") })
    .then((r) => process.exit(r.exitCode))
    .catch((e) => { console.error("verify_cloud failed:", String(e && e.message).slice(0, 200)); process.exit(1); });
}
