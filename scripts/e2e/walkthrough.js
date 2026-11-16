"use strict";
/* Records one phone-sized walkthrough of the final app against the test harness (fictional data, stubbed AI model, intercepted sign-in).
   Output: a .webm in E2E_VIDEO_DIR. This is a recording of the test build, not of a deployed service. */
const { chromium } = require("playwright");
const { startHarness } = require("./harness");
const { openSession } = require("./lib");
const { signUpViaUi, onboardViaUi } = require("./steps");
const { PW, apiOnboard, APP_BODY } = require("./community");

const WEB = process.env.E2E_WEB || "/tmp/claude-0/web-e2e";
const BANNER = "TEST BUILD · fictional people and papers · AI answers are a test stub";

(async () => {
  const h = await startHarness({ webRoot: WEB });
  const browser = await chromium.launch();
  const E = { student: "asha@e2e.test", mentor: "mira@e2e.test", admin: h.ADMIN_EMAIL };
  try {
    // seed (API only, before recording starts): an administrator and one approved mentor
    h.fb.ensureUser(E.admin, PW, "Ada Admin"); await apiOnboard(h, E.admin, { displayName: "Ada Admin", persona: "PROFESSOR" });
    h.fb.ensureUser(E.mentor, PW, "Mira Mentor"); await apiOnboard(h, E.mentor, { displayName: "Mira Mentor", persona: "MENTOR", researchDomains: ["Deep learning"] });
    const app = await h.api(E.mentor, "POST", "/api/v1/mentor-applications", { ...APP_BODY, institution: "Test Institute of Technology", designation: "Postdoctoral researcher" });
    const ok = await h.api(E.admin, "PUT", `/api/v1/admin/mentor-applications/${app.json.applicationId || (app.json.application && app.json.application.applicationId)}`, { decision: "APPROVE" });
    if (ok.status !== 200) throw new Error("seed approve " + ok.status + " " + ok.text);

    const a = await openSession(h, browser, { who: "student", viewport: "m390" });
    await a.ctx.addInitScript((txt) => {
      const add = () => { if (document.getElementById("__tb")) return; const d = document.createElement("div"); d.id = "__tb"; d.textContent = txt; d.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:2147483647;pointer-events:none;background:#b45309;color:#fff;font:600 10px/16px system-ui,sans-serif;text-align:center;letter-spacing:.2px"; document.body.appendChild(d); };
      document.addEventListener("DOMContentLoaded", add); setInterval(add, 800);
    }, BANNER);
    const p = a.page; const pause = (ms) => p.waitForTimeout(ms);
    const scroll = async (n = 3, dy = 380) => { for (let i = 0; i < n; i++) { await p.mouse.wheel(0, dy); await pause(450); } };

    // 1 landing, persona, sign up, onboarding
    await a.goto("/"); await a.settle(1500); await pause(1800); await scroll(3, 420); await pause(600);
    await p.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" })); await pause(900);
    await signUpViaUi(a, { persona: "STUDENT", name: "Asha Student", email: E.student });
    await onboardViaUi(a, "STUDENT", { name: "Asha Student" });
    await a.settle(1500); await pause(2000); await scroll(2, 360); await pause(800);

    // 2 mentors: directory, profile, request
    await a.goto("/mentors"); await a.settle(1500); await pause(1800);
    await p.getByText("Mira Mentor").first().click(); await a.settle(1500); await pause(1800); await scroll(2, 360);
    await a.click("button", "Request mentorship"); await a.settle(600); await pause(800);
    await a.fill("Research area", "Deep learning");
    await a.fill("Your interests", "I want to learn how to read papers and design a first experiment.");
    await a.fill("What guidance do you need?", "How to turn a research question into a small first experiment.");
    await pause(900); await a.click("button", "Send request"); await a.settle(1500); await pause(1800);

    // 3 research: search, paper
    await a.goto("/search"); await a.settle(1200); await pause(900);
    const box = p.locator("input").first(); await box.fill("sparse"); await box.press("Enter"); await a.settle(2500); await pause(1500);
    await p.getByText("Sparse Attention Routing for Long-Context Retrieval").first().click(); await a.settle(3000); await pause(1500); await scroll(4, 380); await pause(800);

    // 4 Research Copilot with evidence
    const DOI = "10.9999/fixture.sparse.2021";
    await a.goto(`/research/copilot?ref=${encodeURIComponent("doi:" + DOI)}&title=${encodeURIComponent("Sparse Attention Routing for Long-Context Retrieval")}`); await a.settle(1500); await pause(1800);
    await a.click("button", "What are the main results?"); await pause(900);
    await a.click("button", "Ask the Copilot");
    await p.getByText("ANSWER", { exact: false }).first().waitFor({ state: "visible", timeout: 20000 }); await a.settle(800); await pause(1800); await scroll(3, 320);
    await a.click("button", "Open evidence 1"); await a.settle(900); await pause(2800);
    await p.keyboard.press("Escape").catch(() => undefined);
    const close = p.getByRole("button", { name: /close/i }).first(); if (await close.count()) await close.click().catch(() => undefined);
    await pause(900);

    // 5 Assistant
    await a.goto("/assistant"); await a.settle(1200); await pause(1500);
    await p.getByLabel("Ask the shoRDs Assistant").fill("How do I find a mentor?"); await pause(700);
    await a.click("button", "Send question");
    await p.getByText("TEST STUB", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 }); await a.settle(600); await pause(2500);

    // 6 back to the dashboard
    await a.goto("/dashboard"); await a.settle(1500); await pause(2200);
    const vpath = await p.video().path();
    await a.close();
    console.log("VIDEO " + vpath);
  } finally { await browser.close(); await h.close(); }
})().catch((e) => { console.error("WALKTHROUGH FAILED", e); process.exit(1); });
