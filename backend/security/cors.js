"use strict";
/**
 * Environment-driven CORS allow-list.
 *
 *   CORS_ORIGINS=https://shords.vercel.app,https://app.example.com     exact origins, comma separated
 *
 * - Production (NODE_ENV=production): only the listed origins. `*` is ignored (and reported), never honoured, because the
 *   API is called with an Authorization header. An empty list means no browser origin is allowed.
 * - Development (anything else): when CORS_ORIGINS is unset, localhost / 127.0.0.1 origins on any port are allowed so
 *   Expo web (8081, 19006) and local tooling work without configuration. When it is set, it is used as written.
 * - Requests without an Origin header (curl, server-to-server, health probes) get no CORS headers and are not blocked by
 *   this layer; they still have to authenticate.
 * - A request that carries a disallowed Origin is rejected (403) rather than served without CORS headers, so a hostile
 *   page cannot cause a state-changing request to execute even though it could not read the reply.
 */

const ALLOWED_METHODS = "GET, POST, DELETE, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization, Idempotency-Key";
const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

function normalizeOrigin(value) {
  const v = String(value || "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.pathname !== "/" && u.pathname !== "") return null; // an origin has no path
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch (_) {
    return null;
  }
}

function loadCorsConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const raw = env.CORS_ORIGINS;
  const warnings = [];
  const origins = new Set();
  let explicit = false;

  if (typeof raw === "string" && raw.trim() !== "") {
    explicit = true;
    for (const part of raw.split(",")) {
      const p = part.trim();
      if (!p) continue;
      if (p === "*") {
        warnings.push("CORS_ORIGINS contains '*', which is ignored (the API uses Authorization headers)");
        continue;
      }
      const n = normalizeOrigin(p);
      if (!n) {
        warnings.push(`CORS_ORIGINS entry is not a valid origin and was ignored: ${p.slice(0, 80)}`);
        continue;
      }
      origins.add(n);
    }
  }

  const allowLocalhost = !production && !explicit;
  if (production && origins.size === 0) warnings.push("No browser origin is allowed: set CORS_ORIGINS to the web app origin(s)");
  return { production, origins, allowLocalhost, warnings };
}

/**
 * @returns {{ present:boolean, allowed:boolean, headers:object, reason?:string }}
 */
function evaluateCors(config, originHeader) {
  if (originHeader === undefined || originHeader === null || originHeader === "") {
    return { present: false, allowed: true, headers: {} };
  }
  const origin = normalizeOrigin(originHeader);
  const allowed = Boolean(origin) && (config.origins.has(origin) || (config.allowLocalhost && LOCALHOST_RE.test(origin)));
  if (!allowed) return { present: true, allowed: false, headers: { Vary: "Origin" }, reason: "ORIGIN_NOT_ALLOWED" };
  return {
    present: true,
    allowed: true,
    headers: {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Access-Control-Allow-Methods": ALLOWED_METHODS,
      "Access-Control-Allow-Headers": ALLOWED_HEADERS,
      "Access-Control-Max-Age": "600"
    }
  };
}

module.exports = { loadCorsConfig, evaluateCors, normalizeOrigin, ALLOWED_METHODS, ALLOWED_HEADERS };
