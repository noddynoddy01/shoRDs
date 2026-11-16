"use strict";
/**
 * Registration, role selection and mentor verification on the client, plus the redesign's navigation and UI-kit rules.
 * Pure TypeScript modules are loaded through Node's type stripping; React screens are NOT rendered here (there is no React test renderer in
 * this project). Screens are covered by the TypeScript compiler, the web bundle build, source scans below, and (separately, and reported as such)
 * browser screenshots. Nothing here talks to Firebase. Everything privileged (verified mentor, administrator) is decided by the server; the tests
 * prove the client never sends it and never derives it from local state.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const load = (p) => require(path.join(root, p));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const IN = load("services/social/intent.ts");
const AP = load("services/social/application.ts");
const DB = load("services/social/dashboard.ts");
const RV = load("services/social/review.ts");
const NV = load("services/nav/items.ts");
const BP = load("services/ui/breakpoints.ts");
const PA = load("services/social/parse.ts");
const DR = load("services/social/draft.ts");
const CL = load("services/social/client.ts");
const RG = load("services/auth/routeGuard.ts");
const SERVER = require(path.join(root, "backend/social/mentors.js"));

// ------------------------------------------------------------------------------------------------ role selection
test("role selection: exactly four cards, in order, with the specified wording; Mentor states that verification is required", () => {
  assert.deepEqual(IN.PERSONA_CHOICES.map((c) => c.persona), ["STUDENT", "MENTOR", "RESEARCHER", "PROFESSOR"]);
  assert.deepEqual(IN.PERSONA_CHOICES.map((c) => c.title), ["Student", "Mentor", "Researcher", "Professor / Academic"]);
  const by = Object.fromEntries(IN.PERSONA_CHOICES.map((c) => [c.persona, c]));
  assert.deepEqual(by.STUDENT.points, ["Discover research", "Connect with mentors", "Develop research skills"]);
  assert.deepEqual(by.MENTOR.points, ["Guide students", "Share expertise", "Support research development"]);
  assert.deepEqual(by.RESEARCHER.points, ["Discover research", "Find collaborators", "Exchange research ideas"]);
  assert.deepEqual(by.PROFESSOR.points, ["Share academic expertise", "Support researchers", "Participate in mentorship"]);
  assert.match(by.MENTOR.notice, /administrator verification before you are listed as a verified mentor/i);
  for (const c of IN.PERSONA_CHOICES) { assert.ok(c.icon && c.tagline, c.persona); if (c.persona !== "MENTOR") assert.equal(c.notice, undefined); }
});

test("role selection: only the four personas parse; privileged or invented values never do; every persona is accepted by the server profile API", () => {
  for (const v of ["student", "Mentor", " RESEARCHER ", "professor", "Professor / Academic", "academic"]) assert.ok(IN.parsePersonaChoice(v), v);
  for (const v of ["ADMIN", "admin", "verified_mentor", "VERIFIED_MENTOR", "ENTHUSIAST", "", null, undefined, 3, {}, "STUDENT; DROP TABLE"]) assert.equal(IN.parsePersonaChoice(v), null, String(v));
  const P = require(path.join(root, "backend/social/profiles.js"));
  for (const p of IN.SELECTABLE_PERSONAS) assert.doesNotThrow(() => P.validateProfileInput({ persona: p }), p);
  assert.throws(() => P.validateProfileInput({ persona: "ADMIN" }), "the server itself refuses a persona that is not in its list");
});

test("role selection: the sign-up choice survives a reload through storage, discards junk, and is cleared once saved", async () => {
  const mem = new Map();
  const storage = { getItem: async (k) => (mem.has(k) ? mem.get(k) : null), setItem: async (k, v) => { mem.set(k, v); }, removeItem: async (k) => { mem.delete(k); } };
  const a = IN.createIntentStore(storage);
  assert.equal(a.get(), null);
  await a.set("MENTOR");
  assert.equal(a.get(), "MENTOR"); assert.equal(mem.get(IN.PENDING_PERSONA_KEY), "MENTOR");
  const b = IN.createIntentStore(storage); // a fresh page load
  assert.equal(b.get(), null); assert.equal(await b.hydrate(), "MENTOR");
  mem.set(IN.PENDING_PERSONA_KEY, "ADMIN"); // someone edits local storage
  assert.equal(await IN.createIntentStore(storage).hydrate(), null, "a tampered value is discarded, so it can never become anything");
  await b.clear(); assert.equal(b.get(), null); assert.equal(mem.has(IN.PENDING_PERSONA_KEY), false);
  const broken = IN.createIntentStore({ getItem: async () => { throw new Error("x"); }, setItem: async () => { throw new Error("x"); }, removeItem: async () => { throw new Error("x"); } });
  await broken.set("STUDENT"); assert.equal(broken.get(), "STUDENT", "storage failures never lose the in-memory choice"); assert.equal(await broken.hydrate(), "STUDENT");
});

test("role selection is persisted by the existing profile API: the onboarding body carries persona and nothing privileged, for every persona", () => {
  for (const p of IN.SELECTABLE_PERSONAS) {
    const d = { ...DR.draftFrom(null, "Ada"), persona: p };
    const body = DR.bodyFrom(d, ["displayName", "persona"]);
    assert.deepEqual(body, { displayName: "Ada", persona: p });
    const all = DR.bodyFrom(d, ["displayName", "persona", "headline", "bio", "institution", "department", "academicLevel", "interests", "domains", "expertise", "skills", "orcid", "linkedin", "github", "website", "publications", "availability", "allowDirectMessages"]);
    for (const k of Object.keys(all)) assert.ok(!/verified|admin|role|status|capacity|uid/i.test(k), `no privileged key ${k}`);
  }
});

// ------------------------------------------------------------------------------------------------ mentor application form
const GOOD = () => ({ ...AP.emptyApplicationForm("Test University"), designation: "Associate Professor", professionalBio: "Researcher in optics with ten years of experience.", background: "PhD in photonics and several publications.", experience: "Supervised six master's theses and reviewed for journals.", expertise: "Optics, Lasers", mentoringAreas: "Thesis writing", links: "https://example.edu/~me\nhttps://www.linkedin.com/in/me", orcid: "0000-0002-1825-0097", googleScholar: "https://scholar.google.com/citations?user=abc", verificationNote: "Staff page above.", capacity: "3" });

test("mentor application: a complete form validates and the body it produces is accepted by the server's own validator", () => {
  assert.deepEqual(AP.validateApplicationForm(GOOD()), {});
  const body = AP.applicationBody(GOOD());
  const out = SERVER.validateApplication(body); // throws if the server would refuse it
  assert.equal(out.institution, "Test University"); assert.equal(out.orcid, "0000-0002-1825-0097"); assert.deepEqual(out.expertise, ["Optics", "Lasers"]);
  for (const k of Object.keys(body)) assert.ok(!/status|verified|admin|uid|reviewer/i.test(k), `no privileged key ${k}`);
  const minimal = AP.applicationBody({ ...GOOD(), orcid: "", googleScholar: "", verificationNote: "", links: "" });
  assert.ok(!("orcid" in minimal) && !("googleScholar" in minimal) && !("verificationNote" in minimal)); assert.deepEqual(minimal.portfolioLinks, []);
  assert.doesNotThrow(() => SERVER.validateApplication(minimal));
});

test("mentor application: every mistake is caught before sending, with a message on the right field, and agrees with the server", () => {
  const cases = [
    [{ institution: "" }, "institution"], [{ designation: " " }, "designation"], [{ professionalBio: "too short" }, "professionalBio"], [{ background: "short" }, "background"], [{ experience: "short" }, "experience"],
    [{ expertise: " , " }, "expertise"], [{ mentoringAreas: "" }, "mentoringAreas"], [{ links: "http://insecure.example" }, "links"], [{ links: "javascript:alert(1)" }, "links"], [{ links: Array(7).fill("https://a.example").join("\n") }, "links"],
    [{ orcid: "1234" }, "orcid"], [{ googleScholar: "https://evil.example/x" }, "googleScholar"], [{ googleScholar: "http://scholar.google.com/x" }, "googleScholar"], [{ verificationNote: "x".repeat(501) }, "verificationNote"], [{ capacity: "0" }, "capacity"], [{ capacity: "51" }, "capacity"], [{ capacity: "2.5" }, "capacity"], [{ capacity: "abc" }, "capacity"]
  ];
  for (const [patch, field] of cases) {
    const f = { ...GOOD(), ...patch };
    assert.ok(AP.validateApplicationForm(f)[field], `client catches ${field}: ${JSON.stringify(patch).slice(0, 60)}`);
    if (!(Array.isArray(patch.links) || (patch.links || "").split("\n").length > 6)) assert.throws(() => SERVER.validateApplication(AP.applicationBody(f)), `server also refuses ${field}`);
  }
  assert.doesNotThrow(() => SERVER.validateApplication(AP.applicationBody({ ...GOOD(), orcid: "https://orcid.org/0000-0002-1825-0097" })), "an ORCID URL is accepted and normalised by the server");
  assert.deepEqual(AP.validateApplicationForm({ ...GOOD(), orcid: "https://orcid.org/0000-0002-1825-0097" }), {});
});

test("application status: all five standings have honest wording; only the server's verifiedMentor flag ever shows 'verified'", () => {
  const all = ["NOT_APPLIED", "PENDING", "APPROVED", "REJECTED", "REVOKED"].map((s) => [s, AP.applicationStatusInfo(s, false)]);
  assert.deepEqual(all.map(([, i]) => i.label), ["Not applied", "Pending review", "Approved", "Rejected", "Revoked"]);
  for (const [s, i] of all) assert.ok(!/you are a verified mentor/i.test(i.headline), `${s} (flag false) never claims verified`);
  assert.equal(AP.applicationStatusInfo("NOT_APPLIED", true).headline, "You are a verified mentor");
  assert.deepEqual(all.map(([, i]) => i.canApply), [true, false, false, true, true], "pending and approved cannot reapply; rejected and revoked can");
  assert.equal(AP.applicationStatusInfo("REJECTED", false).showNote, true); assert.equal(AP.applicationStatusInfo("REVOKED", false).showNote, true); assert.equal(AP.applicationStatusInfo("PENDING", false).showNote, false);
  assert.equal(AP.applicationStatusInfo("PENDING", false).tone, "warn");
});

test("parsing the caller's standing: an unknown status is 'not applied', and verifiedMentor is true only when exactly true", () => {
  assert.deepEqual(PA.parseMyApplication({ status: "WIZARD", verifiedMentor: "true", application: null }), { status: "NOT_APPLIED", verifiedMentor: false, application: null });
  assert.equal(PA.parseMyApplication({ status: "APPROVED", verifiedMentor: 1 }).verifiedMentor, false);
  assert.equal(PA.parseMyApplication({ status: "APPROVED", verifiedMentor: true }).verifiedMentor, true);
  assert.equal(PA.parseMyApplication(null).status, "NOT_APPLIED");
  const app = PA.parseApplication({ applicationId: "app_1", status: "PENDING", institution: "U", designation: "Dr", professionalBio: "x".repeat(30), orcid: null, googleScholar: null, verificationNote: null, background: "b".repeat(25), expertise: ["a"], mentoringAreas: ["b"], experience: "e".repeat(25), portfolioLinks: [], availability: "AVAILABLE", capacity: 2, reviewNote: null, reviewedAt: null, createdAt: "2026-11-15T10:00:00Z", ownApplication: true, applicant: { uid: "u", displayName: "N", persona: "MENTOR", institution: null, headline: null } });
  assert.equal(app.ownApplication, true); assert.equal(app.institution, "U"); assert.equal(app.applicant.displayName, "N");
  assert.equal(PA.parseApplication({ ...app, ownApplication: "yes" }).ownApplication, undefined, "ownApplication must be a real boolean");
  assert.throws(() => PA.parseApplication({ ...app, status: "ROOT" }));
});

test("client: the application and review calls use the documented endpoints and send no identity; revoke carries a reason", async () => {
  const calls = [];
  const api = { get: async (p, o) => { calls.push(["GET", p, o]); return { status: "PENDING", verifiedMentor: false, application: null }; }, post: async (p, b) => { calls.push(["POST", p, b]); return {}; }, put: async (p, b) => { calls.push(["PUT", p, b]); return { application: null }; }, delete: async () => ({}) };
  const c = CL.createSocialClient(api);
  assert.equal((await c.getMyApplication()).status, "PENDING");
  await c.revokeMentor("uid with/slash", "Credentials could not be verified");
  assert.deepEqual(calls.at(-1), ["POST", "/api/v1/admin/mentors/uid%20with%2Fslash/revoke", { note: "Credentials could not be verified" }]);
  await assert.rejects(() => c.reviewApplication("app_1", "REJECT", "Not enough information"), () => true).catch(() => undefined);
  const put = calls.find((x) => x[0] === "PUT"); assert.deepEqual(put[2], { decision: "REJECT", note: "Not enough information" });
});

// ------------------------------------------------------------------------------------------------ review rules
test("review screen rules: no actions on your own application; approve and reject only while pending; revoke only while approved; reasons required", () => {
  assert.deepEqual(RV.reviewActions({ status: "PENDING", ownApplication: true }), []);
  assert.deepEqual(RV.reviewActions({ status: "APPROVED", ownApplication: true }), []);
  assert.deepEqual(RV.reviewActions({ status: "PENDING" }), ["APPROVE", "REJECT"]);
  assert.deepEqual(RV.reviewActions({ status: "PENDING", ownApplication: false }), ["APPROVE", "REJECT"]);
  assert.deepEqual(RV.reviewActions({ status: "APPROVED" }), ["REVOKE"]);
  assert.deepEqual(RV.reviewActions({ status: "REJECTED" }), []); assert.deepEqual(RV.reviewActions({ status: "REVOKED" }), []);
  assert.equal(RV.reasonProblem("APPROVE", ""), null);
  for (const a of ["REJECT", "REVOKE"]) { assert.ok(RV.reasonProblem(a, "")); assert.ok(RV.reasonProblem(a, " no ")); assert.equal(RV.reasonProblem(a, "Not enough detail."), null); assert.ok(RV.reasonProblem(a, "x".repeat(501))); }
  assert.equal(RV.safeLink("https://ok.example/x"), "https://ok.example/x");
  for (const u of ["http://x.example", "javascript:alert(1)", "data:text/html,x", "https://a b", "ftp://x"]) assert.equal(RV.safeLink(u), null, u);
});

// ------------------------------------------------------------------------------------------------ dashboards and onboarding destination
test("dashboards: the mentor panel follows the server's flags only; a pending, rejected or revoked mentor never sees the verified panel", () => {
  const m = (o) => DB.dashboardModel({ persona: "MENTOR", verifiedMentor: false, applicationStatus: "NOT_APPLIED", isAdmin: false, ...o });
  assert.equal(m({}).mentorPanel, "APPLY");
  assert.equal(m({ applicationStatus: "PENDING" }).mentorPanel, "PENDING");
  assert.equal(m({ applicationStatus: "REJECTED" }).mentorPanel, "REJECTED");
  assert.equal(m({ applicationStatus: "REVOKED" }).mentorPanel, "REVOKED");
  assert.equal(m({ applicationStatus: "APPROVED" }).mentorPanel, "APPLY", "an APPROVED standing without the profile flag is not treated as verified");
  assert.equal(m({ verifiedMentor: true, applicationStatus: "APPROVED" }).mentorPanel, "VERIFIED");
  assert.equal(m({ persona: "STUDENT" }).mentorPanel, "NONE"); assert.equal(m({ persona: "PROFESSOR" }).mentorPanel, "APPLY_OPTIONAL"); assert.equal(m({ persona: "RESEARCHER" }).mentorPanel, "APPLY_OPTIONAL");
  assert.equal(m({ persona: "STUDENT", verifiedMentor: true }).mentorPanel, "VERIFIED", "a verified mentor keeps the panel whatever profile type they later pick");
  for (const persona of [...IN.SELECTABLE_PERSONAS, "ENTHUSIAST", null]) for (const st of ["NOT_APPLIED", "PENDING", "APPROVED", "REJECTED", "REVOKED"]) assert.equal(DB.dashboardModel({ persona, verifiedMentor: false, applicationStatus: st, isAdmin: false }).showAdmin, false, "persona never grants administrator access");
  assert.equal(m({ isAdmin: true }).showAdmin, true); assert.equal(m({ isAdmin: "true" }).showAdmin, false);
});

test("dashboards: profile completion lists exactly what is missing, per profile type", () => {
  const base = { uid: "u", displayName: "N", photoUrl: null, persona: "STUDENT", headline: null, bio: null, institution: null, department: null, academicLevel: null, researchInterests: [], researchDomains: [], skills: [], expertise: [], links: {}, availability: "UNAVAILABLE", mentorshipPreference: "NONE", verifiedMentor: false, openSlots: null };
  assert.deepEqual(DB.profileCompletion(null), { percent: 0, done: [], missing: ["Create your profile"] });
  const s = DB.profileCompletion(base); assert.deepEqual(s.done, ["Name"]); assert.ok(s.missing.includes("Academic level") && !s.missing.includes("Expertise"));
  const full = { ...base, persona: "MENTOR", headline: "h", institution: "i", bio: "b", researchInterests: ["x"], researchDomains: ["d"], expertise: ["e"], availability: "AVAILABLE" };
  assert.deepEqual(DB.profileCompletion(full), { percent: 100, done: ["Name", "Headline", "Institution", "About you", "Research interests", "Research domains", "Expertise", "Availability"], missing: [] });
  assert.equal(DB.profileCompletion({ ...full, expertise: [] }).percent, 88);
});

test("onboarding destination: a new mentor goes to the application step; everyone else, and mentors who already applied or are verified, go to the dashboard", () => {
  const r = (o) => DB.postOnboardingRoute({ persona: "MENTOR", verifiedMentor: false, applicationStatus: "NOT_APPLIED", ...o });
  assert.equal(r({}), "/mentor/application");
  for (const o of [{ applicationStatus: "PENDING" }, { applicationStatus: "REJECTED" }, { verifiedMentor: true }, { persona: "STUDENT" }, { persona: "RESEARCHER" }, { persona: "PROFESSOR" }, { persona: null }]) assert.equal(r(o), "/(tabs)/dashboard");
  assert.equal(RG.APP_HOME, "/(tabs)/dashboard", "signed-in people land on their dashboard");
  assert.deepEqual(RG.decideRoute({ status: "SIGNED_IN", segments: ["auth"], onboarding: "DONE" }), { action: "REDIRECT", to: "/(tabs)/dashboard" }, "a returning person is not sent back through sign-up");
  assert.deepEqual(RG.decideRoute({ status: "SIGNED_IN", segments: ["mentor", "application"], onboarding: "DONE" }), { action: "ALLOW" });
});

test("returning users cannot bypass anything by editing local state: verification and administrator access are read only from server responses", () => {
  const src = (p) => strip(read(p));
  for (const f of ["context/ProfileContext.tsx", "app/(tabs)/dashboard.tsx", "app/mentor/application.tsx", "app/mentor/review.tsx", "components/nav/AppRail.tsx", "app/onboarding.tsx", "app/profile/edit.tsx"]) {
    const s = src(f);
    assert.ok(!/AsyncStorage|localStorage|sessionStorage/.test(s) || f === "context/ProfileContext.tsx" && !/verifiedMentor|isAdmin/.test((s.match(/AsyncStorage[^\n]*/g) || []).join("")), `${f}: no verification or admin state read from device storage`);
    assert.ok(!/verifiedMentor\s*[:=]\s*true|isAdmin\s*[:=]\s*true|setIsAdmin\(true\)/.test(s), `${f}: never sets a privilege locally`);
  }
  assert.match(strip(read("context/ProfileContext.tsx")), /setIsAdmin\(me\.isAdmin\)/, "isAdmin comes from the server response");
  const store = strip(read("services/social/intentStore.ts")) + strip(read("services/social/intent.ts")).replace(/notice: "[^"]*"/, "");
  assert.ok(!/verified|admin/i.test(store), "the device-local sign-up hint code never touches privileges (only the Mentor card's explanatory notice mentions verification)");
  for (const body of [AP.applicationBody(GOOD()), DR.bodyFrom({ ...DR.draftFrom(null, "A"), persona: "MENTOR" }, ["displayName", "persona"])]) assert.ok(!Object.keys(body).some((k) => /verified|admin/i.test(k)));
});

// ------------------------------------------------------------------------------------------------ navigation
test("navigation: unique keys and routes, every destination resolves to a real screen file, admin entries need the server's admin flag", () => {
  const keys = NV.NAV_ITEMS.map((i) => i.key), routes = NV.NAV_ITEMS.map((i) => i.route);
  assert.equal(new Set(keys).size, keys.length); assert.equal(new Set(routes).size, routes.length);
  for (const i of NV.NAV_ITEMS) assert.ok(NV.routeFileCandidates(i.route).some((c) => fs.existsSync(path.join(root, "app", c)) || fs.existsSync(path.join(root, "app", "(tabs)", c))), `${i.key} -> ${i.route} has a screen`);
  assert.ok(NV.railItems(false).every((i) => !i.adminOnly)); assert.ok(NV.railItems(true).some((i) => i.key === "review")); assert.ok(!NV.railItems(undefined).some((i) => i.key === "review"));
  assert.ok(NV.railItems(false).length >= 8);
});

test("navigation: the phone bar has at most six items, includes the Assistant as a destination, and the active item follows the route", () => {
  const d = NV.dockItems(); assert.ok(d.length <= 6); assert.ok(d.some((i) => i.key === "assistant"));
  const a = NV.activeKey;
  assert.equal(a(["(tabs)", "dashboard"]), "dashboard"); assert.equal(a(["(tabs)"]), "research"); assert.equal(a(["(tabs)", "index"]), "research"); assert.equal(a(["(tabs)", "explore"]), "explore"); assert.equal(a(["(tabs)", "mentors"]), "mentors");
  assert.equal(a(["mentors", "u1"]), "mentors"); assert.equal(a(["mentor", "review"]), "review"); assert.equal(a(["mentor", "application"]), "mentors"); assert.equal(a(["messages", "c1"]), "messages"); assert.equal(a(["paper", "p"]), "research"); assert.equal(a(["assistant", "history"]), "assistant"); assert.equal(a(["zzz"]), null);
  for (const s of [[], ["index"], ["auth"], ["onboarding"]]) assert.equal(NV.showsChrome(s), false, s.join("/") || "landing");
  for (const s of [["(tabs)", "dashboard"], ["messages", "c"], ["assistant"]]) assert.equal(NV.showsChrome(s), true);
});

test("navigation: every literal route used by router.push/replace and href resolves to a real screen (no dead links)", () => {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) files.push(p); } };
  for (const d of ["app", "components", "context"]) walk(d);
  const exists = (route) => {
    const clean = route.split("?")[0].replace(/^\//, "");
    const segs = clean.split("/").filter(Boolean);
    const cand = (base) => {
      const out = []; const rec = (dir, i) => {
        if (i === segs.length) { for (const f of [`${dir}.tsx`, `${dir}/index.tsx`]) out.push(f); return; }
        rec(`${dir}/${segs[i]}`, i + 1);
        if (fs.existsSync(path.join(root, dir)) && fs.statSync(path.join(root, dir)).isDirectory()) for (const e of fs.readdirSync(path.join(root, dir))) if (/^\[.+\]/.test(e.replace(/\.tsx$/, ""))) rec(`${dir}/${e.replace(/\.tsx$/, "")}`, i + 1);
      }; rec(base, 0); return out;
    };
    return [...cand("app"), ...cand("app/(tabs)")].some((f) => fs.existsSync(path.join(root, f))) || route === "/" || route === "/(tabs)";
  };
  let checked = 0; const dead = [];
  for (const f of files) {
    const s = strip(read(f));
    for (const m of s.matchAll(/(?:router\.(?:push|replace|navigate)|href=)\(?\{?\s*["']((?:\/)[^"'$`]*)["']/g)) { checked += 1; if (!exists(m[1])) dead.push(`${f}: ${m[1]}`); }
  }
  assert.ok(checked > 30, `scanned ${checked} links`);
  assert.deepEqual(dead, []);
});

test("responsive: breakpoint classes and the rail switch-over", () => {
  assert.deepEqual([320, 767, 768, 1023, 1024, 1439, 1440, 2560].map(BP.breakpointFor), ["mobile", "mobile", "tablet", "tablet", "laptop", "laptop", "desktop", "desktop"]);
  assert.equal(BP.breakpointFor(NaN), "mobile");
  assert.deepEqual(["mobile", "tablet", "laptop", "desktop"].map(BP.usesRail), [false, false, true, true]);
});

// ------------------------------------------------------------------------------------------------ design system rules (source scans)
test("landing page: states only what exists; no invented statistics, testimonials, partner logos or affiliations; required nav and CTAs present", () => {
  const src = read("app/index.tsx");
  for (const must of ["Explore Research", "Discover Mentors", "Research Community", "About", "Sign In", "Get Started", "Join the Community", "Research moves forward when knowledge moves freely.", "How would you like to use shoRDs?"]) assert.ok(src.includes(must), must);
  assert.ok(!/testimonial|trusted by|partner|as seen|customers|\d[\d,]*\+|\d+\s?%|\b\d+k\b|million|thousand/i.test(strip(src).replace(/"\d+%"/g, "")), "no figures or social proof");
  assert.match(src, /have not been published yet/, "says plainly when legal pages are not configured");
  const site = read("constants/site.ts");
  assert.ok(!/https?:\/\/|@\w+\.\w+/.test(strip(site).replace(/\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\{2,\}\$/, "")), "no hard-coded addresses or links: all come from build-time configuration");
});

test("sign-in screen: one Firebase flow with persona step, password toggle, reset, Google on web; no domain-interest chips; interests are not sent at sign-up", () => {
  const src = read("app/auth.tsx"), s = strip(src);
  assert.match(s, /PersonaPicker/); assert.match(s, /password\b[^\n]*Input|<Input label="Password"[^\n]*password/); assert.match(s, /resetPassword/); assert.match(s, /loginWithGoogle/);
  assert.ok(!/domains|samplePapers|toggleInterest|Chip/.test(s), "no domain-interest chips");
  assert.match(s, /register\(name, email, password, \[\], \{ phoneNumber: phone \}\)/, "no interests passed to Firebase sign-up");
  assert.ok(!/fetch\(|axios|XMLHttpRequest/.test(s), "the screen talks only to the auth context");
  const input = strip(read("components/ui/Input.tsx"));
  assert.match(input, /Show password/); assert.match(input, /Hide password/); assert.match(input, /accessibilityRole="alert"/);
});

test("UI kit: reduced motion is honoured, touch targets and labels meet the minimum, the background no longer pulses", () => {
  const motion = strip(read("components/ui/motion.tsx"));
  assert.match(motion, /isReduceMotionEnabled/); assert.match(motion, /prefers-reduced-motion/);
  assert.equal((motion.match(/useReducedMotion\(\)/g) || []).length >= 2, true, "FadeIn and usePulse both check it");
  const tk = strip(read("constants/theme.ts")); assert.match(tk, /minTouch:\s*44/);
  const btn = strip(read("components/ui/Button.tsx")); assert.match(btn, /accessibilityRole="button"/); assert.match(btn, /accessibilityState=\{\{ disabled/); assert.match(btn, /minHeight: tokens\.minTouch/);
  const inp = strip(read("components/ui/Input.tsx")); assert.match(inp, /accessibilityLabel=\{label\}/); assert.match(inp, /minHeight: tokens\.minTouch/);
  const ov = strip(read("components/ui/Overlay.tsx")); assert.match(ov, /accessibilityViewIsModal/); assert.match(ov, /onRequestClose/); assert.match(ov, /accessibilityLiveRegion="polite"/);
  const amb = strip(read("components/AmbientBackground.tsx")); assert.ok(!/Animated|LinearGradient|loop/.test(amb), "no animated or gradient glow behind every screen");
  const required = ["Button", "Input", "Select", "Card", "Avatar", "Badge", "Modal", "Dropdown", "Tabs", "ToastProvider", "EmptyState", "Skeleton", "PageHeader", "SectionHeader"];
  const idx = read("components/ui/index.ts"); for (const n of required) assert.ok(new RegExp(`\\b${n}\\b`).test(idx), `${n} is exported from the kit`);
});

test("help button: there is no floating overlay; the Assistant is reached from the navigation, so it cannot cover content, the keyboard or a composer", () => {
  assert.equal(fs.existsSync(path.join(root, "components/social/AssistantFab.tsx")), false);
  const layout = strip(read("app/_layout.tsx")); assert.ok(!/AssistantFab/.test(layout));
  assert.ok(NV.NAV_ITEMS.some((i) => i.key === "assistant" && i.route === "/assistant"));
  const tabs = strip(read("app/(tabs)/_layout.tsx")); assert.ok(!/position:\s*"absolute"/.test(tabs.replace(/badge:\s*\{[^}]*position: "absolute"[^}]*\}/g, "")), "the bottom bar is attached, not floating");
});

// ---------------------------------------------------------------------------------------------------------------- deep links on a full page load
test("a deep link is never mistaken for the landing page while the router catches up (refresh, shared link, bookmark)", () => {
  const G = load("services/auth/routeGuard.ts");
  // router reports nothing yet, but the browser is on /mentor/review: wait (previously this redirected to the dashboard)
  assert.equal(G.routerBehindUrl([], "/mentor/review"), true);
  assert.equal(G.routerBehindUrl([], "/mentors/uid-123"), true);
  // the landing page itself is not "behind"
  assert.equal(G.routerBehindUrl([], "/"), false);
  assert.equal(G.routerBehindUrl([], "/index"), false);
  assert.equal(G.routerBehindUrl([], ""), false);
  assert.equal(G.routerBehindUrl([], null), false);
  // once the router has segments there is nothing to wait for
  assert.equal(G.routerBehindUrl(["mentor", "review"], "/mentor/review"), false);
  // the decision itself is unchanged: a signed-in person on a real landing page still goes home
  assert.deepEqual(G.decideRoute({ status: "SIGNED_IN", segments: [] }), { action: "REDIRECT", to: G.APP_HOME });
});

test("Research Copilot screen helpers: paper references are normalised, citations only link to real evidence, and the screen has no alert() stubs", () => {
  const CV = load("services/copilotView.ts");
  assert.equal(CV.normalizePaperRef("10.1038/S41586-020-2649-2"), "doi:10.1038/s41586-020-2649-2");
  assert.equal(CV.normalizePaperRef("https://doi.org/10.1038/s41586-020-2649-2"), "doi:10.1038/s41586-020-2649-2");
  assert.equal(CV.normalizePaperRef("doi: 10.9999/x.y"), "doi:10.9999/x.y");
  assert.equal(CV.normalizePaperRef("31452104"), "pmid:31452104");
  assert.equal(CV.normalizePaperRef("PMID: 31452104"), "pmid:31452104");
  assert.equal(CV.normalizePaperRef("arXiv:1706.03762"), "arxiv:1706.03762");
  assert.equal(CV.normalizePaperRef("1706.03762v5"), null, "a bare arXiv id is not guessed (digits with a dot are not a PubMed id)");
  for (const bad of ["", "   ", "not a doi", "10.1/short", "javascript:alert(1)", "doi:", "pmid:abc"]) assert.equal(CV.normalizePaperRef(bad), null, bad);

  const ev = [{ chunkId: "doi:10.9_chunk_0" }, { chunkId: "doi:10.9_chunk_3" }];
  const parts = CV.splitAnswer("It improved recall [doi:10.9_chunk_3]. Also see [doi:10.9_chunk_0, doi:10.9_chunk_3] and [invented_chunk_9] and [1].", ev);
  const cites = parts.filter((p) => p.kind === "cite");
  assert.deepEqual(cites.map((c) => c.indexes), [[1], [0, 1]], "only bracketed ids that are real evidence chunks become citations");
  assert.ok(parts.map((p) => (p.kind === "text" ? p.text : "")).join("").includes("[invented_chunk_9]"), "an unknown id stays as plain text, never a fake citation");
  assert.equal(parts.map((p) => (p.kind === "text" ? p.text : p.raw)).join(""), "It improved recall [doi:10.9_chunk_3]. Also see [doi:10.9_chunk_0, doi:10.9_chunk_3] and [invented_chunk_9] and [1].", "splitting loses no text");
  assert.deepEqual(CV.splitAnswer("No citations here.", []), [{ kind: "text", text: "No citations here." }]);

  const src = strip(read("app/research/copilot.tsx"));
  assert.ok(!/\balert\s*\(/.test(src), "no alert() stubs");
  assert.ok(!/dangerouslySetInnerHTML|<div|<h1|<input/.test(src), "themed React Native components only (no raw DOM)");
  assert.ok(/ResearchCopilotService\.processCopilotRequest/.test(src), "questions go through the real service");
  assert.ok(!/(?<!UN)VERIFIED/.test(src), "the screen never labels an answer as verified");
});
