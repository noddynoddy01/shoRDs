"use strict";
/**
 * Authentication: verification of Firebase Auth ID tokens (RS256 JWTs).
 *
 * Why Firebase: it is the only identity provider already present in this project (services/firebase.ts signs users up
 * and in on the client). Firebase issues the ID token; this module is the missing server half that verifies it. No
 * parallel token system is introduced.
 *
 * What is checked, following Firebase's "verify ID tokens" rules (done by hand because no dependency can be installed):
 *   - header: alg == RS256, kid present and published in Google's securetoken JWKS
 *   - signature: RSA-SHA256 over `header.payload` with that key
 *   - exp in the future, iat not in the future, auth_time not in the future (60 s clock skew allowed)
 *   - aud == FIREBASE_PROJECT_ID, iss == https://securetoken.google.com/<FIREBASE_PROJECT_ID>
 *   - sub is a non-empty string (<= 128 chars): this is the user id
 *   - optionally email_verified == true (AUTH_REQUIRE_VERIFIED_EMAIL=true)
 *
 * Known limit: revocation is not checked (that needs the Admin API); a revoked token stays valid until it expires (<= 1 h).
 * Fail closed: with no FIREBASE_PROJECT_ID every protected route answers 503 AUTH_NOT_CONFIGURED; nothing is let through.
 */

const crypto = require("crypto");
const https = require("https");

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const MAX_TOKEN_CHARS = 4096;
const CLOCK_SKEW_SEC = 60;
const MIN_JWKS_REFETCH_MS = 30_000; // unknown-kid lookups cannot be used to hammer Google

class AuthError extends Error {
  /** code: AUTH_MISSING | AUTH_MALFORMED | AUTH_INVALID_SIGNATURE | AUTH_EXPIRED | AUTH_INVALID_CLAIMS | AUTH_UNKNOWN_KEY |
   *        AUTH_NOT_CONFIGURED | AUTH_KEYS_UNAVAILABLE */
  constructor(code, message) {
    super(message || code);
    this.name = "AuthError";
    this.code = code;
    this.httpStatus = code === "AUTH_NOT_CONFIGURED" || code === "AUTH_KEYS_UNAVAILABLE" ? 503 : 401;
  }
}

/** `Authorization: Bearer <token>` only. A bare string, another scheme or an oversized value never authenticates. */
function extractBearer(headerValue) {
  if (typeof headerValue !== "string" || headerValue.trim() === "") throw new AuthError("AUTH_MISSING", "Authorization header is required");
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(headerValue.trim());
  if (!m) throw new AuthError("AUTH_MALFORMED", "Authorization must be 'Bearer <token>'");
  if (m[1].length > MAX_TOKEN_CHARS) throw new AuthError("AUTH_MALFORMED", "token too large");
  return m[1];
}

function b64urlDecode(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new AuthError("AUTH_MALFORMED", "token is not base64url");
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function parseJson(buf) {
  try {
    const v = JSON.parse(buf.toString("utf8"));
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v;
  } catch (_) {
    throw new AuthError("AUTH_MALFORMED", "token segment is not a JSON object");
  }
}

/** Default JWKS download: HTTPS GET with a deadline and a size cap. Resolves { keys, maxAgeSec }. */
function defaultFetchJwks({ url = JWKS_URL, timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { accept: "application/json" } }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > 65536) {
          req.destroy();
          reject(new Error("JWKS response too large"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`JWKS HTTP ${res.statusCode}`));
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const m = /max-age=(\d+)/.exec(String(res.headers["cache-control"] || ""));
          resolve({ keys: json.keys, maxAgeSec: m ? Number(m[1]) : 3600 });
        } catch (e) {
          reject(new Error("JWKS response is not valid JSON"));
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("JWKS fetch timed out")));
    req.on("error", reject);
  });
}

/**
 * @param {object} opts
 * @param {string} opts.projectId                  Firebase project id (audience)
 * @param {Function} [opts.fetchJwks]              async () => ({ keys:[JWK], maxAgeSec })
 * @param {Function} [opts.now]                    () => ms
 * @param {boolean} [opts.requireVerifiedEmail]
 */
function createFirebaseVerifier(opts) {
  const { projectId, fetchJwks = defaultFetchJwks, now = Date.now, requireVerifiedEmail = false } = opts;
  if (!projectId) throw new Error("projectId is required");
  const issuer = `https://securetoken.google.com/${projectId}`;

  let keys = new Map(); // kid -> KeyObject
  let expiresAt = 0;
  let lastFetchAt = 0;
  let lastError = null;
  let inflight = null;

  async function refresh() {
    if (inflight) return inflight;
    inflight = (async () => {
      lastFetchAt = now();
      try {
        const { keys: jwks, maxAgeSec } = await fetchJwks();
        if (!Array.isArray(jwks) || jwks.length === 0) throw new Error("JWKS contained no keys");
        const next = new Map();
        for (const jwk of jwks) {
          if (!jwk || jwk.kty !== "RSA" || !jwk.kid) continue;
          next.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" }));
        }
        if (next.size === 0) throw new Error("JWKS contained no usable RSA keys");
        keys = next;
        expiresAt = now() + Math.min(Math.max(Number(maxAgeSec) || 3600, 60), 86400) * 1000;
        lastError = null;
      } catch (e) {
        lastError = { at: new Date(now()).toISOString(), message: String(e && e.message ? e.message : e).slice(0, 120) };
        throw new AuthError("AUTH_KEYS_UNAVAILABLE", "signing keys could not be loaded");
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  /** Make sure keys are loaded and fresh. Stale keys are kept if a refresh fails (Google rotates with overlap). */
  async function ensureKeys() {
    if (keys.size > 0 && now() < expiresAt) return;
    try {
      await refresh();
    } catch (e) {
      if (keys.size > 0) return; // serve with the last good set rather than lock everyone out
      throw e;
    }
  }

  async function keyFor(kid) {
    await ensureKeys();
    let key = keys.get(kid);
    if (!key && now() - lastFetchAt > MIN_JWKS_REFETCH_MS) {
      try {
        await refresh(); // keys may have rotated
      } catch (_) {
        /* fall through to unknown key */
      }
      key = keys.get(kid);
    }
    if (!key) throw new AuthError("AUTH_UNKNOWN_KEY", "token signing key is not recognised");
    return key;
  }

  async function verify(token) {
    const parts = token.split(".");
    if (parts.length !== 3) throw new AuthError("AUTH_MALFORMED", "token is not a JWT");
    const header = parseJson(b64urlDecode(parts[0]));
    const payload = parseJson(b64urlDecode(parts[1]));
    if (header.alg !== "RS256") throw new AuthError("AUTH_INVALID_SIGNATURE", "unsupported algorithm"); // rejects alg=none / HS256 confusion
    if (typeof header.kid !== "string" || !header.kid) throw new AuthError("AUTH_MALFORMED", "token has no key id");

    const key = await keyFor(header.kid);
    const ok = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, b64urlDecode(parts[2]));
    if (!ok) throw new AuthError("AUTH_INVALID_SIGNATURE", "signature verification failed");

    const nowSec = Math.floor(now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SEC < nowSec) throw new AuthError("AUTH_EXPIRED", "token expired");
    if (typeof payload.iat !== "number" || payload.iat - CLOCK_SKEW_SEC > nowSec) throw new AuthError("AUTH_INVALID_CLAIMS", "token issued in the future");
    if (payload.auth_time !== undefined && (typeof payload.auth_time !== "number" || payload.auth_time - CLOCK_SKEW_SEC > nowSec)) {
      throw new AuthError("AUTH_INVALID_CLAIMS", "auth_time is in the future");
    }
    if (payload.aud !== projectId) throw new AuthError("AUTH_INVALID_CLAIMS", "wrong audience");
    if (payload.iss !== issuer) throw new AuthError("AUTH_INVALID_CLAIMS", "wrong issuer");
    if (typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 128) throw new AuthError("AUTH_INVALID_CLAIMS", "invalid subject");
    if (requireVerifiedEmail && payload.email_verified !== true) throw new AuthError("AUTH_INVALID_CLAIMS", "email address is not verified");

    return {
      uid: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
      emailVerified: payload.email_verified === true,
      signInProvider: payload.firebase && typeof payload.firebase.sign_in_provider === "string" ? payload.firebase.sign_in_provider : null,
      tokenExpiresAt: new Date(payload.exp * 1000).toISOString()
    };
  }

  return {
    kind: "firebase",
    projectId,
    verify,
    /** Readiness: configured, and signing keys loaded (or loadable). Never throws, never exposes key material. */
    async status() {
      try {
        await ensureKeys();
        return { configured: true, ready: true, keysLoaded: keys.size, lastError };
      } catch (_) {
        return { configured: true, ready: false, keysLoaded: keys.size, lastError };
      }
    }
  };
}

/** Verifier used when nothing is configured: every call fails closed. */
function createUnconfiguredVerifier() {
  return {
    kind: "none",
    async verify() {
      throw new AuthError("AUTH_NOT_CONFIGURED", "authentication is not configured on this server");
    },
    async status() {
      return { configured: false, ready: false, keysLoaded: 0, lastError: null };
    }
  };
}

function createVerifierFromEnv(env = process.env, overrides = {}) {
  const projectId = (env.FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) return createUnconfiguredVerifier();
  return createFirebaseVerifier({ projectId, requireVerifiedEmail: env.AUTH_REQUIRE_VERIFIED_EMAIL === "true", ...overrides });
}

/** Authentication only: header -> principal. Authorization (what the principal may touch) is a separate step. */
async function authenticateRequest(headers, verifier) {
  const token = extractBearer(headers["authorization"]);
  return verifier.verify(token);
}

module.exports = {
  AuthError,
  extractBearer,
  authenticateRequest,
  createFirebaseVerifier,
  createUnconfiguredVerifier,
  createVerifierFromEnv,
  defaultFetchJwks,
  JWKS_URL
};
