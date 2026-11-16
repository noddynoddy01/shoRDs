"use strict";
/** Reusable UI steps. Every step drives the real screens through accessible roles and labels; none calls the backend directly. */
const { check } = require("./lib");

const PERSONA_FIELDS = {
  STUDENT: [["Institution", "Example University"], ["Research interests", "machine learning, signal processing"], ["Skills", "Python, MATLAB"]],
  MENTOR: [["Institution", "Test Institute of Technology"], ["Research interests", "deep learning, optimisation"], ["Research domains", "Deep learning"], ["Expertise", "Statistics, Experimental design"], ["About you", "Postdoctoral researcher who enjoys helping early-career researchers design their first experiments."]],
  RESEARCHER: [["Institution", "Example Research Lab"], ["Research interests", "computational neuroscience"], ["Research domains", "Neuroscience"], ["Skills", "Python, R"]],
  PROFESSOR: [["Institution", "Example University"], ["Department", "Electrical Engineering"], ["Research interests", "wireless communications"], ["Research domains", "Signal processing"], ["Expertise", "Information theory"]]
};
const RADIO = { STUDENT: "Student", MENTOR: "Mentor", RESEARCHER: "Researcher", PROFESSOR: "Professor" };

async function fillIfPresent(s, label, value) {
  const l = s.page.getByLabel(label, { exact: true });
  if (await l.count()) { const f = l.first(); if (await f.isVisible().catch(() => false)) { await f.fill(value); return true; } }
  return false;
}

async function signUpViaUi(s, { persona, name, email, password = "test-pass-1", shotPrefix }) {
  await s.goto("/");
  if (shotPrefix) await s.shot(`${shotPrefix}-01-landing`);
  await s.page.getByRole("radio", { name: new RegExp("^" + RADIO[persona]) }).first().click();
  if (shotPrefix) await s.shot(`${shotPrefix}-02-persona-selected`);
  await s.click("button", "Continue");
  await s.fill("Full name", name); await s.fill("Email", email); await s.fill("Password", password);
  if (shotPrefix) await s.shot(`${shotPrefix}-03-signup-form`);
  await s.click("button", "Create account");
  await s.page.waitForURL(/onboarding/, { timeout: 15000 }).catch(() => undefined);
  await s.settle(600);
}

async function onboardViaUi(s, persona, { shotPrefix, name } = {}) {
  // stage 0: name + persona
  if (name) await fillIfPresent(s, "Your name", name);
  const picked = await s.page.getByRole("radio", { checked: true }).first().getAttribute("aria-label").catch(() => "");
  check(`${s.who}: sign-up choice pre-selected in onboarding (${persona})`, new RegExp("^" + RADIO[persona]).test(picked || ""), picked ? picked.slice(0, 30) : "none");
  if (shotPrefix) await s.shot(`${shotPrefix}-onb-1`);
  await s.click("button", "Save and continue"); await s.settle(500);
  // stage 1 and 2 hold different fields; fill what is there, advance
  for (let i = 0; i < 2; i++) {
    for (const [label, value] of PERSONA_FIELDS[persona]) await fillIfPresent(s, label, value);
    if (shotPrefix) await s.shot(`${shotPrefix}-onb-${i + 2}`);
    await s.click("button", "Save and continue"); await s.settle(500);
  }
  // final stage: Finish
  if (shotPrefix) await s.shot(`${shotPrefix}-onb-4`);
  const finish = s.page.getByRole("button", { name: /^Finish/ }).first();
  await finish.click(); await s.settle(1200);
}

module.exports = { signUpViaUi, onboardViaUi, fillIfPresent, PERSONA_FIELDS, RADIO };
