"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCorsConfig, evaluateCors, normalizeOrigin } = require("../../security/cors");

const prod = (origins) => loadCorsConfig({ NODE_ENV: "production", CORS_ORIGINS: origins });

test("production: a listed origin is allowed and echoed back exactly (never '*')", () => {
  const cfg = prod("https://shords.vercel.app,https://app.example.com");
  const r = evaluateCors(cfg, "https://shords.vercel.app");
  assert.equal(r.allowed, true);
  assert.equal(r.headers["Access-Control-Allow-Origin"], "https://shords.vercel.app");
  assert.equal(r.headers.Vary, "Origin");
  assert.match(r.headers["Access-Control-Allow-Headers"], /Authorization/);
  assert.ok(!Object.values(r.headers).includes("*"));
  assert.equal(evaluateCors(cfg, "https://app.example.com").allowed, true);
});

test("production: an origin that is not listed is rejected and gets no allow-origin header", () => {
  const cfg = prod("https://shords.vercel.app");
  for (const bad of ["https://evil.example", "http://shords.vercel.app", "https://shords.vercel.app.evil.example", "https://shords.vercel.app:8443", "null"]) {
    const r = evaluateCors(cfg, bad);
    assert.equal(r.allowed, false, bad);
    assert.equal(r.headers["Access-Control-Allow-Origin"], undefined, bad);
  }
});

test("production: localhost is NOT allowed unless it is listed", () => {
  const cfg = prod("https://shords.vercel.app");
  assert.equal(evaluateCors(cfg, "http://localhost:8081").allowed, false);
  assert.equal(evaluateCors(prod("https://shords.vercel.app,http://localhost:8081"), "http://localhost:8081").allowed, true);
});

test("missing Origin (curl, server-to-server, health probes): no CORS headers, not blocked by this layer", () => {
  const r = evaluateCors(prod("https://shords.vercel.app"), undefined);
  assert.deepEqual({ present: r.present, allowed: r.allowed, headers: r.headers }, { present: false, allowed: true, headers: {} });
  assert.equal(evaluateCors(prod("https://x.example"), "").present, false);
});

test("development with CORS_ORIGINS unset: localhost / 127.0.0.1 on any port are allowed, other origins are not", () => {
  const cfg = loadCorsConfig({ NODE_ENV: "development" });
  for (const ok of ["http://localhost:8081", "http://localhost:19006", "http://127.0.0.1:3000", "https://localhost"]) {
    assert.equal(evaluateCors(cfg, ok).allowed, true, ok);
  }
  for (const bad of ["https://evil.example", "http://localhost.evil.example", "http://evil.example:8081", "http://localhostx:8081"]) {
    assert.equal(evaluateCors(cfg, bad).allowed, false, bad);
  }
  assert.equal(loadCorsConfig({}).allowLocalhost, true, "default (no NODE_ENV) is the development behaviour");
});

test("development with an explicit CORS_ORIGINS uses exactly that list", () => {
  const cfg = loadCorsConfig({ NODE_ENV: "development", CORS_ORIGINS: "http://localhost:8081" });
  assert.equal(evaluateCors(cfg, "http://localhost:8081").allowed, true);
  assert.equal(evaluateCors(cfg, "http://localhost:9999").allowed, false);
});

test("a wildcard is never honoured (the API takes Authorization headers) and is reported", () => {
  const cfg = prod("*");
  assert.equal(evaluateCors(cfg, "https://anything.example").allowed, false);
  assert.ok(cfg.warnings.some((w) => /'\*'/.test(w)));
  const mixed = prod("*,https://shords.vercel.app");
  assert.equal(evaluateCors(mixed, "https://shords.vercel.app").allowed, true);
  assert.equal(evaluateCors(mixed, "https://other.example").allowed, false);
});

test("production with CORS_ORIGINS unset allows no browser origin and warns", () => {
  const cfg = loadCorsConfig({ NODE_ENV: "production" });
  assert.equal(evaluateCors(cfg, "https://shords.vercel.app").allowed, false);
  assert.ok(cfg.warnings.some((w) => /No browser origin is allowed/.test(w)));
});

test("entries are normalised: case, trailing slash, whitespace; invalid entries are dropped with a warning", () => {
  const cfg = prod(" HTTPS://Shords.Vercel.App/ , not a url, ftp://x.example, https://a.example/path ");
  assert.equal(evaluateCors(cfg, "https://shords.vercel.app").allowed, true);
  assert.equal(cfg.origins.size, 1);
  assert.equal(cfg.warnings.length, 3);
  assert.equal(normalizeOrigin("https://a.example/path"), null);
  assert.equal(normalizeOrigin("https://A.example:443"), "https://a.example"); // default port is dropped by URL parsing
});

test("the custom domain can be added later by configuration only", () => {
  const before = prod("https://shords.vercel.app");
  const after = prod("https://shords.vercel.app,https://www.shords.example");
  assert.equal(evaluateCors(before, "https://www.shords.example").allowed, false);
  assert.equal(evaluateCors(after, "https://www.shords.example").allowed, true);
});
