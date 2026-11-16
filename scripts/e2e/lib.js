"use strict";
const fs = require("fs");
const path = require("path");
const openalex = require("./openalexFixture");

const VIEWPORTS = { m375: { width: 375, height: 800 }, m390: { width: 390, height: 844 }, t768: { width: 768, height: 1024 }, l1024: { width: 1024, height: 768 }, d1440: { width: 1440, height: 900 } };
const OUT = process.env.E2E_OUT || "/tmp/claude-0/e2e-out";
const report = { steps: [], consoleErrors: [], pageErrors: [], failedRequests: [], apiErrors: [], blockedExternal: [], overflows: [], shots: [], checks: [] };

function check(name, ok, detail = "") { report.checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); return !!ok; }

async function openSession(h, browser, { who = "anon", viewport = "d1440", identityEmail } = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[viewport], deviceScaleFactor: 1, locale: "en-GB", reducedMotion: "no-preference", ...(process.env.E2E_VIDEO_DIR ? { recordVideo: { dir: process.env.E2E_VIDEO_DIR, size: VIEWPORTS[viewport] } } : {}) });
  await h.fb.install(ctx);
  await ctx.route(/^https:\/\/api\.openalex\.org\//, (route) => {
    const u = new URL(route.request().url());
    const m = /\/works\/(?:doi:)?(.+)$/.exec(u.pathname);
    let body = openalex.response(route.request().url());
    if (m) { const w = openalex.WORKS.find((x) => (x.doi || "").endsWith(decodeURIComponent(m[1])) || x.id.endsWith(m[1])); body = w || { error: "not found" }; return route.fulfill({ status: w ? 200 : 404, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify(body) }); }
    return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify(body) });
  });
  // Every other external origin is refused and recorded: the harness never reaches the internet.
  await ctx.route((url) => !/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(url.href) && !/^https:\/\/(identitytoolkit|securetoken)\.google|^https:\/\/api\.openalex\.org/.test(url.href), (route) => { report.blockedExternal.push(`${who}: ${route.request().url().slice(0, 140)}`); return route.abort(); });
  const page = await ctx.newPage();
  const tag = () => `${who}@${viewport}`;
  page.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(`${tag()} ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => report.pageErrors.push(`${tag()} ${String(e).slice(0, 300)}`));
  page.on("requestfailed", (r) => { const u = r.url(); if (/^http:\/\/127\.0\.0\.1/.test(u)) report.failedRequests.push(`${tag()} ${r.method()} ${u.slice(0, 120)} ${r.failure()?.errorText}`); });
  page.on("response", (r) => { const u = r.url(); if (/^http:\/\/127\.0\.0\.1:8787\//.test(u) && r.status() >= 400) report.apiErrors.push(`${tag()} ${r.request().method()} ${new URL(u).pathname} → ${r.status()}`); });
  const s = {
    ctx, page, who, viewport, tag,
    async goto(p) { await page.goto(`${h.webBase}${p}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(300); },
    async settle(ms = 700) { await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined); await page.waitForTimeout(ms); },
    async shot(name, { full = false } = {}) {
      const dir = path.join(OUT, viewport); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${name}.png`);
      await page.screenshot({ path: file, fullPage: full });
      const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      if (over.sw > over.cw + 1) report.overflows.push(`${tag()} ${name}: scrollWidth ${over.sw} > ${over.cw}`);
      report.shots.push(`${viewport}/${name}.png`);
      return file;
    },
    async text() { return page.evaluate(() => document.body.innerText); },
    async has(txt, timeout = 6000) { return page.getByText(txt, { exact: false }).filter({ visible: true }).first().waitFor({ state: "visible", timeout }).then(() => true).catch(() => false); },
    async click(role, name, opts = {}) { const l = page.getByRole(role, { name, exact: opts.exact ?? false }).first(); await l.waitFor({ state: "visible", timeout: opts.timeout ?? 8000 }); await l.click(); },
    async fill(label, value) { const l = page.getByLabel(label, { exact: true }).first(); await l.waitFor({ state: "visible", timeout: 8000 }); await l.fill(value); },
    path() { return new URL(page.url()).pathname + new URL(page.url()).search; },
    async close() { await ctx.close(); }
  };
  return s;
}
module.exports = { VIEWPORTS, OUT, report, check, openSession };
