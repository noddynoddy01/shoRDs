"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { createFirebaseVerifier, createUnconfiguredVerifier, createVerifierFromEnv, extractBearer, authenticateRequest, AuthError } = require("../../security/auth");
const { makeKeyPair, signJwt, firebasePayload, tokenFor, TEST_PROJECT_ID } = require("./helpers");

const keys = makeKeyPair("kid-A");
const otherKeys = makeKeyPair("kid-A"); // same kid, different key material: a forged signature
const jwksFetch = (ks) => async () => ({ keys: ks.map((k) => k.jwk), maxAgeSec: 3600 });
const mkVerifier = (over = {}) => createFirebaseVerifier({ projectId: TEST_PROJECT_ID, fetchJwks: jwksFetch([keys]), ...over });
const rejects = (p, code) => assert.rejects(p, (e) => e instanceof AuthError && e.code === code, `expected ${code}`);

test("a valid Firebase ID token authenticates and yields the uid", async () => {
  const v = mkVerifier();
  const p = await v.verify(tokenFor(keys, "uid-alice"));
  assert.equal(p.uid, "uid-alice");
  assert.equal(p.email, "uid-alice@example.test");
  assert.equal(p.emailVerified, true);
  assert.equal(p.signInProvider, "password");
});

test("Authorization header: missing / bare string / wrong scheme / empty bearer all fail, nothing authenticates", async () => {
  const v = mkVerifier();
  await rejects(authenticateRequest({}, v), "AUTH_MISSING");
  await rejects(authenticateRequest({ authorization: "" }, v), "AUTH_MISSING");
  await rejects(authenticateRequest({ authorization: "something" }, v), "AUTH_MALFORMED");
  await rejects(authenticateRequest({ authorization: "test_token_usr_A" }, v), "AUTH_MALFORMED");
  await rejects(authenticateRequest({ authorization: "Basic dXNlcjpwYXNz" }, v), "AUTH_MALFORMED");
  await rejects(authenticateRequest({ authorization: "Bearer " }, v), "AUTH_MALFORMED");
  await rejects(authenticateRequest({ authorization: "Bearer test_token_usr_A" }, v), "AUTH_MALFORMED"); // not a JWT
  await rejects(authenticateRequest({ authorization: "Bearer a.b.c" }, v), "AUTH_MALFORMED");
  await rejects(authenticateRequest({ authorization: "Bearer " + "x".repeat(5000) }, v), "AUTH_MALFORMED");
});

test("extractBearer accepts only the Bearer scheme", () => {
  assert.equal(extractBearer("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(extractBearer("bearer abc.def.ghi"), "abc.def.ghi");
  assert.throws(() => extractBearer("Token abc"), AuthError);
});

test("signature: a token signed with a different private key (same kid) is rejected", async () => {
  const v = mkVerifier();
  await rejects(v.verify(tokenFor(otherKeys, "uid-mallory")), "AUTH_INVALID_SIGNATURE");
});

test("tampering with the payload invalidates the signature", async () => {
  const v = mkVerifier();
  const [h, , s] = tokenFor(keys, "uid-alice").split(".");
  const forged = Buffer.from(JSON.stringify(firebasePayload("uid-admin"))).toString("base64url");
  await rejects(v.verify(`${h}.${forged}.${s}`), "AUTH_INVALID_SIGNATURE");
});

test("alg=none and HS256 key-confusion tokens are rejected", async () => {
  const v = mkVerifier();
  const none = signJwt({ alg: "none", kid: "kid-A", payload: firebasePayload("uid-alice") });
  await rejects(v.verify(none), "AUTH_INVALID_SIGNATURE");
  // classic confusion: HMAC the token using the RSA public key text as the secret
  const hs = signJwt({ alg: "HS256", kid: "kid-A", payload: firebasePayload("uid-alice"), secret: keys.publicKey.export({ type: "spki", format: "pem" }) });
  await rejects(v.verify(hs), "AUTH_INVALID_SIGNATURE");
});

test("claims: expired, issued in the future, wrong audience, wrong issuer, empty/oversized subject", async () => {
  const now = Date.now();
  const v = mkVerifier({ now: () => now });
  const sec = Math.floor(now / 1000);
  await rejects(v.verify(tokenFor(keys, "u", { exp: sec - 3600 }, now)), "AUTH_EXPIRED");
  await rejects(v.verify(tokenFor(keys, "u", { iat: sec + 3600, exp: sec + 7200 }, now)), "AUTH_INVALID_CLAIMS");
  await rejects(v.verify(tokenFor(keys, "u", { auth_time: sec + 3600 }, now)), "AUTH_INVALID_CLAIMS");
  await rejects(v.verify(tokenFor(keys, "u", { aud: "another-project" }, now)), "AUTH_INVALID_CLAIMS");
  await rejects(v.verify(tokenFor(keys, "u", { iss: "https://securetoken.google.com/another-project" }, now)), "AUTH_INVALID_CLAIMS");
  await rejects(v.verify(tokenFor(keys, "u", { iss: "https://evil.example/" + TEST_PROJECT_ID }, now)), "AUTH_INVALID_CLAIMS");
  await rejects(v.verify(tokenFor(keys, "", {}, now)), "AUTH_INVALID_CLAIMS");
  await rejects(v.verify(tokenFor(keys, "x".repeat(129), {}, now)), "AUTH_INVALID_CLAIMS");
  await rejects(v.verify(tokenFor(keys, "u", { sub: 12345 }, now)), "AUTH_INVALID_CLAIMS");
  // a token that expired 30 s ago is inside the 60 s skew allowance; 61+ s is not
  await v.verify(tokenFor(keys, "u", { exp: sec - 30 }, now));
  await rejects(v.verify(tokenFor(keys, "u", { exp: sec - 61 }, now)), "AUTH_EXPIRED");
});

test("AUTH_REQUIRE_VERIFIED_EMAIL rejects unverified addresses", async () => {
  const v = mkVerifier({ requireVerifiedEmail: true });
  await rejects(v.verify(tokenFor(keys, "u", { email_verified: false })), "AUTH_INVALID_CLAIMS");
  await v.verify(tokenFor(keys, "u", { email_verified: true }));
});

test("unknown kid triggers one JWKS refetch (key rotation), but refetches are throttled", async () => {
  let fetches = 0;
  let current = [keys];
  let clock = 1_000_000;
  const v = createFirebaseVerifier({ projectId: TEST_PROJECT_ID, now: () => clock, fetchJwks: async () => { fetches++; return { keys: current.map((k) => k.jwk), maxAgeSec: 3600 }; } });
  await v.verify(tokenFor(keys, "u", {}, clock));
  assert.equal(fetches, 1);
  const rotated = makeKeyPair("kid-B");
  const t = tokenFor(rotated, "u", {}, clock);
  clock += 31_000; // beyond the 30 s throttle
  current = [keys, rotated];
  await v.verify(t);
  assert.equal(fetches, 2, "rotation fetched the new key set");
  // a flood of unknown kids must not hammer Google
  const stranger = makeKeyPair("kid-unknown");
  for (let i = 0; i < 20; i++) await rejects(v.verify(tokenFor(stranger, "u", {}, clock)), "AUTH_UNKNOWN_KEY");
  assert.ok(fetches <= 3, `at most one extra refetch for 20 unknown-kid tokens (fetches=${fetches})`);
});

test("JWKS unavailable: 503 AUTH_KEYS_UNAVAILABLE; once keys are cached, a failing refresh keeps serving the stale set", async () => {
  const down = createFirebaseVerifier({ projectId: TEST_PROJECT_ID, fetchJwks: async () => { throw new Error("ECONNREFUSED secret-host.internal"); } });
  await assert.rejects(down.verify(tokenFor(keys, "u")), (e) => e.code === "AUTH_KEYS_UNAVAILABLE" && e.httpStatus === 503 && !/secret-host/.test(e.message));
  const st = await down.status();
  assert.equal(st.ready, false);

  let clock = 5_000_000;
  let fail = false;
  const v = createFirebaseVerifier({ projectId: TEST_PROJECT_ID, now: () => clock, fetchJwks: async () => { if (fail) throw new Error("boom"); return { keys: [keys.jwk], maxAgeSec: 60 }; } });
  await v.verify(tokenFor(keys, "u", {}, clock));
  fail = true;
  clock += 120_000; // cache expired, refresh fails
  const p = await v.verify(tokenFor(keys, "u", {}, clock));
  assert.equal(p.uid, "u");
});

test("without FIREBASE_PROJECT_ID the verifier fails closed with 503", async () => {
  const v = createVerifierFromEnv({});
  assert.equal(v.kind, "none");
  await assert.rejects(v.verify("anything"), (e) => e.code === "AUTH_NOT_CONFIGURED" && e.httpStatus === 503);
  assert.deepEqual(await createUnconfiguredVerifier().status(), { configured: false, ready: false, keysLoaded: 0, lastError: null });
  assert.equal(createVerifierFromEnv({ FIREBASE_PROJECT_ID: "p" }).kind, "firebase");
});

test("a random 3-part base64url string is not a token", async () => {
  const v = mkVerifier();
  const junk = [0, 1, 2].map(() => crypto.randomBytes(20).toString("base64url")).join(".");
  await assert.rejects(v.verify(junk), (e) => e instanceof AuthError);
});
