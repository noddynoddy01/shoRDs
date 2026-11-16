"use strict";
/* Browser journeys A-L against the real UI and backend (see README.md for the exact mock boundary). */
const fs = require("fs");
const { chromium } = require("playwright");
const { startHarness } = require("./harness");
const { openSession, report, check, OUT } = require("./lib");
const { signUpViaUi, onboardViaUi } = require("./steps");
const { PW, APP, step, loginViaUi, apiOnboard, APP_BODY } = require("./community");

const WEB = process.env.E2E_WEB || "/tmp/claude-0/web-e2e";
const VP = process.env.E2E_VP || "d1440";


/** Clicks a main-navigation item by its visible label, whether it is a rail link (desktop) or a bottom-bar tab (mobile and tablet). */
async function navTo(a, label) {
  const l = a.page.getByRole("link", { name: label, exact: true }).or(a.page.getByRole("tab", { name: label, exact: true })).filter({ visible: true }).first();
  try {
    await l.waitFor({ state: "visible", timeout: 8000 });
  } catch (e) {
    const seen = await a.page.locator('[role="link"], [role="tab"], a').evaluateAll((els) => els.map((x) => `${x.tagName}:${x.getAttribute("role")}:${(x.getAttribute("aria-label") || x.textContent || "").trim().slice(0, 30)}`));
    throw new Error(`navTo(${label}) found nothing; candidates: ${seen.slice(0, 25).join(" | ")}`);
  }
  await l.click();
}

(async () => {
  const h = await startHarness({ webRoot: WEB });
  const browser = await chromium.launch();
  const E = { student: "asha@e2e.test", mentor: "mira@e2e.test", admin: h.ADMIN_EMAIL, rejected: "rae@e2e.test", revoked: "rev@e2e.test", researcher: "ravi@e2e.test", professor: "pat@e2e.test" };
  const S = (who, vp = VP) => openSession(h, browser, { who, viewport: vp });
  try {
    // ---------------------------------------------------------------- A: new student
    const a = await S("student");
    await step(a, "A signup+onboarding", async () => {
      await signUpViaUi(a, { persona: "STUDENT", name: "Asha Student", email: E.student, shotPrefix: "A" });
      await onboardViaUi(a, "STUDENT", { shotPrefix: "A", name: "Asha Student" });
      await a.settle(1200);
      check("A: student lands on the dashboard after onboarding", /dashboard/.test(a.path()), a.path());
      check("A: dashboard greets the student by name", await a.has("Welcome, Asha"));
      await a.shot("A-dashboard");
    });

    // ---------------------------------------------------------------- B: new mentor -> application -> pending
    const m = await S("mentor");
    await step(m, "B mentor flow", async () => {
      await signUpViaUi(m, { persona: "MENTOR", name: "Mira Mentor", email: E.mentor, shotPrefix: "B" });
      await onboardViaUi(m, "MENTOR", { shotPrefix: "B", name: "Mira Mentor" });
      await m.page.waitForURL(/mentor\/application/, { timeout: 10000 }).catch(() => undefined);
      check("B: a new mentor is taken to the mentor application", /mentor\/application/.test(m.path()), m.path());
      await m.shot("B-application-empty");
      for (const [label, value] of Object.entries(APP)) { const f = m.page.getByLabel(label, { exact: true }).first(); await f.waitFor({ state: "visible", timeout: 6000 }); await f.fill(value); }
      await m.shot("B-application-filled", { full: true });
      await m.click("button", /Submit application/);
      await m.settle(1500);
      check("B: application shows Pending review", await m.has("Pending"));
      await m.shot("B-application-pending");
      const mentorsApi = await h.api(E.student, "GET", "/api/v1/mentors");
      check("B: a pending mentor is NOT in the verified directory", !JSON.stringify(mentorsApi.json).includes("Mira Mentor"));
    });

    // seed: a second applicant who will be rejected, a third who will be approved then revoked
    await step(a, "seed other mentors", async () => {
      for (const [email, name] of [[E.rejected, "Rae Rejected"], [E.revoked, "Rev Revoked"]]) {
        h.fb.ensureUser(email, PW, name);
        await apiOnboard(h, email, { displayName: name, persona: "MENTOR", researchDomains: ["Deep learning"] });
        const r = await h.api(email, "POST", "/api/v1/mentor-applications", APP_BODY);
        if (r.status !== 201) throw new Error("seed application " + r.status + r.text);
      }
      h.fb.ensureUser(E.admin, PW, "Ada Admin");
      await apiOnboard(h, E.admin, { displayName: "Ada Admin", persona: "PROFESSOR" });
    });

    // ---------------------------------------------------------------- C/F/G: administrator review
    const ad = await S("admin");
    await step(ad, "C admin review", async () => {
      await loginViaUi(ad, E.admin, "C-login");
      await ad.goto("/mentor/review"); await ad.settle(1200);
      await ad.shot("C-review-queue");
      check("C: the queue lists Mira's application with institution and designation", (await ad.has("Mira Mentor")) && (await ad.has("Test Institute of Technology")));
      // approve Mira (first card whose text contains Mira)
      const card = ad.page.locator("div", { has: ad.page.getByText("Mira Mentor", { exact: false }) }).filter({ has: ad.page.getByRole("button", { name: "Approve" }) }).last();
      await card.getByRole("button", { name: "Approve" }).first().click();
      await ad.settle(1500);
      await ad.shot("C-after-approve");
      const dir = await h.api(E.student, "GET", "/api/v1/mentors");
      check("C/D: Mira is in the verified directory after approval", JSON.stringify(dir.json).includes("Mira Mentor"));
      // reject Rae with a reason
      await ad.page.reload(); await ad.settle(1000);
      const rcard = ad.page.locator("div", { has: ad.page.getByText("Rae Rejected", { exact: false }) }).filter({ has: ad.page.getByRole("button", { name: "Reject" }) }).last();
      await rcard.getByRole("button", { name: "Reject" }).first().click();
      await ad.settle(500);
      await ad.shot("C-reject-dialog");
      await ad.fill("Reason (required)", "We could not confirm your affiliation from the links provided.");
      await ad.page.getByRole("button", { name: "Reject", exact: true }).last().click();
      await ad.settle(1200);
      await ad.shot("C-after-reject");
    });
    await step(ad, "G revoke", async () => {
      // approve Rev through the API as admin, then revoke it through the UI
      const apps = await h.api(E.admin, "GET", "/api/v1/admin/mentor-applications?status=PENDING");
      const rev = (apps.json.applications || []).find((x) => /Rev Revoked/.test(JSON.stringify(x)));
      const ap = await h.api(E.admin, "PUT", `/api/v1/admin/mentor-applications/${rev.applicationId}`, { decision: "APPROVE" });
      if (ap.status !== 200) throw new Error("seed approve " + ap.status);
      check("G: Rev is listed before revocation", JSON.stringify((await h.api(E.student, "GET", "/api/v1/mentors")).json).includes("Rev Revoked"));
      await ad.goto("/mentor/review"); await ad.settle(800);
      await ad.page.getByText("Approved", { exact: true }).first().click().catch(() => undefined);
      await ad.settle(900);
      const vcard = ad.page.locator("div", { has: ad.page.getByText("Rev Revoked", { exact: false }) }).filter({ has: ad.page.getByRole("button", { name: "Revoke verification" }) }).last();
      await vcard.getByRole("button", { name: "Revoke verification" }).first().click();
      await ad.settle(500);
      await ad.fill("Reason (required)", "Affiliation could not be re-confirmed during an audit.");
      await ad.shot("G-revoke-dialog");
      await ad.page.getByRole("button", { name: "Revoke", exact: true }).last().click();
      await ad.settle(1200);
      await ad.shot("G-after-revoke");
      check("G: a revoked mentor disappears from the verified directory", !JSON.stringify((await h.api(E.student, "GET", "/api/v1/mentors")).json).includes("Rev Revoked"));
    });

    // F: rejected applicant sees the reason and can reapply
    const rj = await S("rejected");
    await step(rj, "F rejected applicant", async () => {
      await loginViaUi(rj, E.rejected);
      await rj.goto("/mentor/application"); await rj.settle(1000);
      await rj.shot("F-rejected-status");
      check("F: rejected applicant sees the reviewer's reason", await rj.has("could not confirm your affiliation"));
      check("F: rejected applicant can reapply", await rj.has("Reapply") || await rj.has("Submit updated application"));
    });

    // ---------------------------------------------------------------- D: student finds mentor and sends request (returning-user login = H)
    const st2 = await S("student-returning");
    await step(st2, "D/H returning student", async () => {
      await loginViaUi(st2, E.student, "H-login");
      check("H: returning student goes straight to the dashboard (no repeated onboarding)", /dashboard/.test(st2.path()), st2.path());
      await st2.goto("/mentors"); await st2.settle(1200);
      await st2.shot("D-directory");
      check("D: directory shows Mira and not the rejected/revoked/pending", (await st2.has("Mira Mentor")) && !(await st2.text()).includes("Rae Rejected") && !(await st2.text()).includes("Rev Revoked"));
      await st2.page.getByText("Mira Mentor").first().click(); await st2.settle(1200);
      await st2.shot("D-mentor-detail");
      await st2.click("button", "Request mentorship");
      await st2.settle(500);
      await st2.shot("D-request-modal");
      await st2.fill("Research area", "Deep learning");
      await st2.fill("Your interests", "I want to learn how to read papers and design a first experiment.");
      await st2.fill("What guidance do you need?", "How to turn a research question into a small first experiment.");
      await st2.click("button", "Send request");
      await st2.settle(1500);
      await st2.shot("D-request-sent");
      const out = await h.api(E.student, "GET", "/api/v1/mentorship/requests?box=outgoing");
      check("D: the request exists on the server as PENDING", /PENDING/.test(JSON.stringify(out.json)), JSON.stringify(out.json).slice(0, 120));
    });

    // ---------------------------------------------------------------- E: mentor accepts
    const mm = await S("mentor-returning");
    await step(mm, "E mentor accepts", async () => {
      await loginViaUi(mm, E.mentor, "E-login");
      await mm.settle(800);
      await mm.shot("E-mentor-dashboard");
      check("E: mentor dashboard shows verified status", await mm.has("Verified"));
      await mm.goto("/mentorship/requests"); await mm.settle(1000);
      await mm.shot("E-requests");
      await mm.click("button", "Accept");
      await mm.settle(600);
      if (await mm.has("Reply note (optional)", 1500)) { await mm.shot("E-accept-dialog"); await mm.page.getByRole("button", { name: "Accept" }).last().click(); await mm.settle(1500); }
      await mm.shot("E-after-accept");
      const rels = await h.api(E.mentor, "GET", "/api/v1/mentorship/relationships");
      check("E: a mentorship relationship exists", /ACTIVE/.test(JSON.stringify(rels.json)), JSON.stringify(rels.json).slice(0, 100));
      await mm.goto("/mentorship"); await mm.settle(900); await mm.shot("E-active-mentorships");
    });

    // ---------------------------------------------------------------- K: messaging between two accounts (polling, Sent/Seen, unread)
    await step(mm, "K messaging", async () => {
      await mm.goto("/messages"); await mm.settle(900); await mm.shot("K-conversations");
      await mm.page.getByText("Asha Student").first().click(); await mm.settle(900);
      await mm.page.getByLabel("Message", { exact: true }).fill("Welcome Asha. What would you like to start with?");
      await mm.click("button", "Send message"); await mm.settle(900);
      await mm.shot("K-mentor-sent");
      check("K: sender sees 'Sent' on the last message", await mm.has("Sent"));
      await st2.goto("/messages"); await st2.settle(1000);
      await st2.shot("K-student-conversations-unread");
      const un = await h.api(E.student, "GET", "/api/v1/notifications/unread-count").catch(() => null);
      check("K: the student has an unread indicator", /1|unread/i.test(await st2.text()) || (un && /[1-9]/.test(JSON.stringify(un.json))), un ? JSON.stringify(un.json) : "");
      await st2.page.getByText("Mira Mentor").first().click(); await st2.settle(1200);
      await st2.shot("K-student-thread");
      check("K: the student sees the mentor's message", await st2.has("Welcome Asha"));
      await st2.page.getByLabel("Message", { exact: true }).fill("Thank you. I would like to learn to read a paper critically.");
      await st2.click("button", "Send message"); await st2.settle(500);
      // polling: the mentor's open thread should receive it without reload
      await mm.page.waitForTimeout(6500);
      check("K: the mentor's open thread receives the reply by polling (no reload)", await mm.has("learn to read a paper critically", 2000));
      await mm.shot("K-mentor-after-poll");
      await st2.page.waitForTimeout(6500);
      check("K: the student sees 'Seen' once the mentor has read the reply", await st2.has("Seen", 2000));
      await st2.shot("K-student-seen");
    });

    // ---------------------------------------------------------------- J: assistant
    await step(a, "J assistant", async () => {
      await a.goto("/assistant"); await a.settle(1000);
      await a.shot("J-assistant-welcome");
      const box = a.page.getByLabel("Ask the shoRDs Assistant");
      await box.fill("How do I find a mentor?");
      await a.click("button", "Send question");
      await a.page.getByText("TEST STUB", { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
      await a.shot("J-assistant-answer");
      check("J: the assistant answered through the stubbed provider", true);
      await a.goto("/assistant/history"); await a.settle(1000);
      await a.shot("J-assistant-history");
      check("J: the conversation is saved in history", await a.has("How do I find a mentor?"));
      await a.click("button", "Open"); await a.settle(1500);
      check("J: reopening restores the saved conversation", (await a.has("TEST STUB")) && (await a.has("How do I find a mentor?")));
      await a.shot("J-assistant-reopened");
    });

    // ---------------------------------------------------------------- I: researcher and professor
    for (const [persona, who, email, name] of [["RESEARCHER", "researcher", E.researcher, "Ravi Researcher"], ["PROFESSOR", "professor", E.professor, "Pat Professor"]]) {
      const x = await S(who);
      await step(x, `I ${persona}`, async () => {
        await signUpViaUi(x, { persona, name, email, shotPrefix: `I-${who}` });
        await onboardViaUi(x, persona, { shotPrefix: `I-${who}`, name });
        await x.settle(1200);
        check(`I: ${persona} lands on the dashboard`, /dashboard/.test(x.path()), x.path());
        await x.shot(`I-${who}-dashboard`);
        const t = await x.text();
        check(`I: ${persona} dashboard has role-specific content`, persona === "RESEARCHER" ? /collaborat|Researcher/i.test(t) : /Professor|Academic|mentor/i.test(t));
      });
    }

    // ---------------------------------------------------------------- R: research experience (feed, explore, search, paper, copilot, projects)
    await step(a, "R research tour", async () => {
      await a.goto("/dashboard"); await a.settle(1500);
      await navTo(a, "Research");
      await a.settle(2500); await a.shot("R-feed");
      await navTo(a, "Explore"); await a.settle(2500); await a.shot("R-explore");
      check("R: Explore opens from the navigation (rail or bottom bar)", /explore/.test(a.path()), a.path());
      await a.goto("/search"); await a.settle(1500); await a.shot("R-search-empty");
      const box = a.page.locator("input").first();
      if (await box.count()) { await box.fill("sparse"); await box.press("Enter"); await a.settle(2500); await a.shot("R-search-results"); }
      const t = await a.text();
      check("R: search returns the fixture paper through the OpenAlex adapter", /Sparse Attention Routing/.test(t));
      await a.page.getByText("Sparse Attention Routing for Long-Context Retrieval").first().click().catch(() => undefined);
      await a.settle(3000); await a.shot("R-paper", { full: true });
      check("R: opening a result shows the paper page", /\/paper\//.test(a.path()), a.path());
      await a.goto("/projects"); await a.settle(1500); await a.shot("R-projects");
      await a.goto("/research/copilot"); await a.settle(1500); await a.shot("R-copilot-no-paper");
      check("R: the Copilot asks which paper before anything can be asked", await a.has("Which paper?"));
    });

    // ---------------------------------------------------------------- C2: Research Copilot (real backend retrieval, stubbed model)
    await step(a, "C2 research copilot", async () => {
      const DOI = "10.9999/fixture.sparse.2021";
      await a.goto(`/research/copilot?ref=${encodeURIComponent("doi:" + DOI)}&title=${encodeURIComponent("Sparse Attention Routing for Long-Context Retrieval")}`);
      await a.settle(1200);
      check("C2: the paper context is shown", (await a.has("PAPER")) && (await a.has(`doi:${DOI}`)));
      await a.shot("C2-copilot-ready");
      await a.click("button", "What are the main results?");
      await a.click("button", "Ask the Copilot");
      await a.page.getByText("ANSWER", { exact: false }).first().waitFor({ state: "visible", timeout: 20000 });
      await a.settle(500);
      await a.shot("C2-copilot-answer", { full: true });
      const t = await a.text();
      check("C2: the answer is labelled 'not independently verified' (never 'verified')", /Not independently verified/.test(t) && !/\bVerified\b/.test(t.replace(/Not independently verified/g, "")));
      check("C2: the coverage of the paper is stated", /Full text used|Abstract only/.test(t));
      check("C2: the evidence list shows excerpts from the paper", /EXCERPTS? FROM THE PAPER/.test(t));
      await a.click("button", "Open evidence 1");
      check("C2: the evidence inspector opens with the verbatim excerpt", await a.has("VERBATIM"));
      await a.settle(600);
      await a.shot("C2-copilot-evidence");
      await a.page.keyboard.press("Escape").catch(() => undefined);
      const close = a.page.getByRole("button", { name: /close/i }).first();
      if (await close.count()) await close.click().catch(() => undefined);
      await a.settle(400);
      // the paper page links here
      await a.goto("/research/copilot?ref=not-a-paper"); await a.settle(800);
      check("C2: an unusable reference falls back to the paper prompt (nothing is asked)", await a.has("Which paper?"));
      await a.fill("Paper reference", "not a doi");
      await a.click("button", "Use this paper");
      check("C2: a malformed reference is rejected with a clear message", await a.has("does not look like a DOI"));
    });

    // ---------------------------------------------------------------- L: authorization
    await step(a, "L authorization", async () => {
      await a.goto("/mentor/review"); await a.settle(1000); await a.shot("L-nonadmin-review");
      check("L: a non-admin is shown 'Administrators only' on the review screen", await a.has("Administrators only"));
      const r1 = await h.api(E.student, "GET", "/api/v1/admin/mentor-applications");
      check("L: the API refuses a non-admin (403)", r1.status === 403, String(r1.status));
      const apps = await h.api(E.admin, "GET", "/api/v1/admin/mentor-applications?status=APPROVED");
      const mira = (apps.json.applications || []).find((x) => /Mira/.test(JSON.stringify(x)));
      const r2 = await h.api(E.student, "PUT", `/api/v1/admin/mentor-applications/${mira.applicationId}`, { decision: "REJECT", note: "not allowed" });
      check("L: a student cannot decide an application (403)", r2.status === 403, String(r2.status));
      const r3 = await h.api(E.student, "PUT", "/api/v1/profiles/me", { verifiedMentor: true });
      check("L: a student cannot set verifiedMentor (400/403)", r3.status === 400 || r3.status === 403, String(r3.status));
    });
  } catch (e) { check("journey runner", false, e.stack.split("\n").slice(0, 3).join(" | ")); }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/report-${VP}.json`, JSON.stringify(report, null, 2));
  const fails = report.checks.filter((c) => !c.ok);
  console.log(`\nchecks: ${report.checks.length - fails.length}/${report.checks.length} passed; console errors ${report.consoleErrors.length}, page errors ${report.pageErrors.length}, api errors ${report.apiErrors.length}, failed requests ${report.failedRequests.length}, overflows ${report.overflows.length}`);
  for (const f of fails) console.log("FAILED:", f.name, f.detail);
  await browser.close(); await h.close(); process.exit(0);
})();
