"use strict";
/**
 * A stand-in for Google's identity servers, installed with Playwright request interception. The real Firebase web SDK in the page talks
 * to it. ID tokens are real RS256 JWTs signed with the harness test key, so the backend's production verifier validates signature,
 * issuer, audience and expiry exactly as it does for real tokens. This lives under scripts/ and is never part of the app bundle.
 */
const crypto = require("crypto");
const { signJwt, firebasePayload, TEST_PROJECT_ID } = require("../../backend/tests/node/helpers");

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-max-age": "600" };
const uidFor = (email) => "uid-" + crypto.createHash("sha1").update(String(email).toLowerCase()).digest("hex").slice(0, 14);

function createFakeFirebase({ keys, now = Date.now }) {
  const users = new Map(); // email -> { uid, email, password, displayName }
  const refresh = new Map(); // refresh token -> uid
  const log = [];
  const idToken = (u) => signJwt({ privateKey: keys.privateKey, kid: keys.kid, payload: firebasePayload(u.uid, { email: u.email, name: u.displayName || undefined, email_verified: false }, now()) });
  const session = (u) => { const rt = "rt-" + crypto.randomBytes(8).toString("hex"); refresh.set(rt, u.uid); return { idToken: idToken(u), refreshToken: rt, expiresIn: "3600", localId: u.uid, email: u.email, displayName: u.displayName || "", registered: true }; };
  const byUid = (uid) => [...users.values()].find((u) => u.uid === uid);
  const err = (message, code = 400) => ({ status: code, body: { error: { code, message, errors: [{ message, domain: "global", reason: "invalid" }] } } });
  const decode = (t) => { try { return JSON.parse(Buffer.from(String(t).split(".")[1], "base64url").toString()); } catch (_) { return null; } };

  function handle(url, method, bodyText) {
    const u = new URL(url);
    const body = (() => { try { return JSON.parse(bodyText || "{}"); } catch (_) { return Object.fromEntries(new URLSearchParams(bodyText || "")); } })();
    log.push(`${method} ${u.hostname}${u.pathname.split("/").pop()}`);
    if (u.hostname === "securetoken.google.com" || u.hostname === "securetoken.googleapis.com") {
      const uid = refresh.get(body.refresh_token);
      const user = uid && byUid(uid);
      if (!user) return err("INVALID_REFRESH_TOKEN");
      const t = idToken(user);
      return { status: 200, body: { access_token: t, id_token: t, refresh_token: body.refresh_token, expires_in: "3600", token_type: "Bearer", user_id: user.uid, project_id: TEST_PROJECT_ID } };
    }
    const op = u.pathname.split("/").pop();
    if (op === "accounts:signUp") {
      const email = String(body.email || "").toLowerCase();
      if (users.has(email)) return err("EMAIL_EXISTS");
      if (String(body.password || "").length < 6) return err("WEAK_PASSWORD : Password should be at least 6 characters");
      const user = { uid: uidFor(email), email, password: body.password, displayName: "" };
      users.set(email, user);
      return { status: 200, body: session(user) };
    }
    if (op === "accounts:signInWithPassword") {
      const user = users.get(String(body.email || "").toLowerCase());
      if (!user || user.password !== body.password) return err("INVALID_LOGIN_CREDENTIALS");
      return { status: 200, body: session(user) };
    }
    if (op === "accounts:lookup") {
      const claims = decode(body.idToken);
      const user = claims && byUid(claims.sub);
      if (!user) return err("USER_NOT_FOUND");
      return { status: 200, body: { kind: "identitytoolkit#GetAccountInfoResponse", users: [{ localId: user.uid, email: user.email, displayName: user.displayName, emailVerified: false, passwordHash: "x", providerUserInfo: [{ providerId: "password", federatedId: user.email, email: user.email, rawId: user.email }], validSince: "0", lastLoginAt: String(now()), createdAt: String(now()) }] } };
    }
    if (op === "accounts:update") {
      const claims = decode(body.idToken);
      const user = claims && byUid(claims.sub);
      if (!user) return err("INVALID_ID_TOKEN");
      if (typeof body.displayName === "string") user.displayName = body.displayName;
      return { status: 200, body: { localId: user.uid, email: user.email, displayName: user.displayName, providerUserInfo: [{ providerId: "password", federatedId: user.email, email: user.email, rawId: user.email }], passwordHash: "x", emailVerified: false, ...(body.returnSecureToken ? session(user) : {}) } };
    }
    if (op === "accounts:sendOobCode") return { status: 200, body: { email: body.email } };
    return err(`FAKE_FIREBASE_UNSUPPORTED ${op}`, 501);
  }

  async function install(context) {
    const pattern = /^https:\/\/(identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|securetoken\.google\.com)\//;
    await context.route(pattern, async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const r = handle(req.url(), req.method(), req.postData());
      return route.fulfill({ status: r.status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(r.body) });
    });
  }
  return { install, users, uidFor, log, idToken, ensureUser(email, password, displayName = "") { const e = email.toLowerCase(); if (!users.has(e)) users.set(e, { uid: uidFor(e), email: e, password, displayName }); return users.get(e); } };
}

module.exports = { createFakeFirebase, uidFor };
