"use strict";
const { check, report } = require("./lib");
const { signUpViaUi, onboardViaUi, fillIfPresent } = require("./steps");

const PW = "test-pass-1";
const APP = { "Institution or organisation": "Test Institute of Technology", Designation: "Postdoctoral researcher", "Professional biography": "Researcher in machine learning with a focus on helping students design their first experiments.", "Research background": "Postdoctoral researcher working on deep learning and optimisation.", "Mentoring or supervision experience": "Supervised several undergraduate theses and reviewed for workshops.", "Research expertise": "Machine learning, Statistics", "Areas you can mentor in": "Deep learning, Research methods", "Professional profile links": "https://example.org/people/mira", "ORCID (optional)": "0000-0002-1825-0097", "Google Scholar profile (optional)": "https://scholar.google.com/citations?user=abc123", "Notes for the reviewer (optional)": "My staff page is linked above.", "How many mentees can you take at once?": "2" };

async function step(s, name, fn) {
  try { const r = await fn(); return r === undefined ? true : r; }
  catch (e) { check(`${name}`, false, String(e.message).split("\n")[0].slice(0, 200)); try { await s.shot(`FAIL-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 50)}`); } catch (_) { /* ignore */ } return false; }
}
async function loginViaUi(s, email, shot) {
  await s.goto("/auth");
  await s.fill("Email", email); await s.fill("Password", PW);
  if (shot) await s.shot(shot);
  await s.click("button", "Sign in", { exact: true });
  await s.page.waitForURL((u) => !/\/auth/.test(u.pathname), { timeout: 15000 }).catch(() => undefined);
  await s.settle(900);
}
async function apiOnboard(h, email, over = {}) {
  const r = await h.api(email, "PUT", "/api/v1/profiles/me", { displayName: email.split("@")[0], persona: "STUDENT", researchInterests: ["machine learning"], completeOnboarding: true, institution: "Seed University", ...over });
  if (r.status > 201) throw new Error(`seed onboard ${email}: ${r.status} ${r.text}`);
}
const APP_BODY = { institution: "Seed Institute", designation: "Researcher", professionalBio: "Seeded researcher biography used only by the test harness for mentors.", background: "Seeded background for the harness mentor application.", expertise: ["Machine learning"], mentoringAreas: ["Deep learning"], experience: "Seeded mentoring experience for the harness application.", portfolioLinks: ["https://example.org/seed"], availability: "AVAILABLE", capacity: 2 };

module.exports = { PW, APP, step, loginViaUi, apiOnboard, APP_BODY };
