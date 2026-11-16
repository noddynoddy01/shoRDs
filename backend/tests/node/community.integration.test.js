"use strict";
/**
 * Community layer over real HTTP, real PostgreSQL and real Redis: profiles, mentor applications and approval, mentor discovery,
 * mentorship requests, messaging, notifications. The eight security cases required for this feature are marked [SEC-n].
 * No model is involved here (the assistant has its own file), so no AI call can happen.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { startReplica, makeKeyPair, tokenFor, uniq, ipHeader, infraSkip, resetInfra } = require("./helpers");

const skip = infraSkip();
const keys = makeKeyPair("community-key");
const ADMIN = "admin-" + uniq("");
const ADMIN2 = "admin2-" + uniq("");

const long = (s) => (s + " ").repeat(5).trim();
const APPLICATION = { institution: "Test University", designation: "Postdoctoral researcher", professionalBio: long("Researcher in machine learning with a focus on mentoring."), orcid: "0000-0002-1825-0097", googleScholar: "https://scholar.google.com/citations?user=abc", verificationNote: "My staff page is linked above.", background: long("Postdoctoral researcher in machine learning."), expertise: ["Machine learning", "Statistics"], mentoringAreas: ["Deep learning", "Research methods"], experience: long("Supervised several theses and reviewed for journals."), portfolioLinks: ["https://example.org/me"], availability: "AVAILABLE", capacity: 2 };

test("community layer (real PostgreSQL + Redis)", { skip }, async (t) => {
  await resetInfra();
  const R = await startReplica({ keys, env: { ADMIN_UIDS: `${ADMIN},${ADMIN2}`, ANTHROPIC_API_KEY: undefined } });
  t.after(() => R.close());
  const pool = R.runtime.pool;
  const api = (uid, method, path, body, extra = {}) => R.call(method, path, { token: tokenFor(keys, uid), body, headers: ipHeader(), ...extra });
  const onboard = async (uid, over = {}) => {
    const r = await api(uid, "PUT", "/api/v1/profiles/me", { displayName: `Person ${uid.slice(0, 6)}`, persona: "STUDENT", researchInterests: ["machine learning"], completeOnboarding: true, ...over });
    assert.ok(r.status === 200 || r.status === 201, `onboard ${uid}: ${r.status} ${r.text}`);
    return r.json.profile;
  };
  const approve = async (uid, appOver = {}) => {
    const a = await api(uid, "POST", "/api/v1/mentor-applications", { ...APPLICATION, ...appOver });
    assert.equal(a.status, 201, a.text);
    const r = await api(ADMIN, "PUT", `/api/v1/admin/mentor-applications/${a.json.application.applicationId}`, { decision: "APPROVE" });
    assert.equal(r.status, 200, r.text);
  };
  const makeMentor = async (uid, over = {}, appOver = {}) => { await onboard(uid, { persona: "MENTOR", researchDomains: ["Deep learning"], ...over }); await approve(uid, appOver); };
  const request = (mentee, mentor, over = {}) => api(mentee, "POST", "/api/v1/mentorship/requests", { mentorUid: mentor, domain: "Deep learning", interests: "I want to learn how to read papers", guidanceNeeded: "How to design a first experiment", ...over });
  const notes = async (uid, qs = "") => (await api(uid, "GET", `/api/v1/notifications${qs}`)).json;

  // ------------------------------------------------------------------------------------------------ profiles
  await t.test("authentication is required on every community route", async () => {
    for (const [m, p] of [["GET", "/api/v1/profiles/me"], ["GET", "/api/v1/mentors"], ["GET", "/api/v1/conversations"], ["GET", "/api/v1/notifications"], ["POST", "/api/v1/mentorship/requests"], ["GET", "/api/v1/admin/mentor-applications"]]) {
      const r = await R.call(m, p, { headers: ipHeader(), body: m === "POST" ? {} : undefined });
      assert.equal(r.status, 401, `${m} ${p}`);
    }
  });

  await t.test("a new person has no profile and is told to onboard; onboarding is staged and the profile lives in PostgreSQL", async () => {
    const uid = uniq("a1-");
    const me = await api(uid, "GET", "/api/v1/profiles/me");
    assert.equal(me.status, 200);
    assert.equal(me.json.profile, null);
    assert.equal(me.json.onboardingRequired, true);
    assert.equal(me.json.isAdmin, false);
    const s1 = await api(uid, "PUT", "/api/v1/profiles/me", { displayName: "Asha", persona: "STUDENT" });
    assert.equal(s1.status, 201);
    assert.equal(s1.json.profile.onboardingCompleted, false);
    const early = await api(uid, "PUT", "/api/v1/profiles/me", { completeOnboarding: true });
    assert.equal(early.status, 422);
    assert.equal(early.json.error, "ONBOARDING_INCOMPLETE");
    const s2 = await api(uid, "PUT", "/api/v1/profiles/me", { researchInterests: ["signal processing"], institution: "Example University", academicLevel: "UNDERGRADUATE", skills: ["Python"], github: "https://github.com/asha", completeOnboarding: true });
    assert.equal(s2.status, 200);
    assert.equal(s2.json.profile.onboardingCompleted, true);
    assert.equal(s2.json.profile.links.github, "https://github.com/asha");
    assert.equal((await api(uid, "GET", "/api/v1/profiles/me")).json.onboardingRequired, false);
    const row = (await pool.query("SELECT persona, institution, research_interests FROM user_profiles WHERE uid=$1", [uid])).rows[0];
    assert.equal(row.persona, "STUDENT");
    assert.deepEqual(row.research_interests, ["signal processing"]);
  });

  await t.test("all five personas are accepted; anything else and malformed fields are refused with a clear code", async () => {
    for (const persona of ["STUDENT", "MENTOR", "RESEARCHER", "PROFESSOR", "ENTHUSIAST"]) assert.equal((await api(uniq("a2-"), "PUT", "/api/v1/profiles/me", { displayName: "X", persona })).status, 201, persona);
    const uid = uniq("a2b-");
    const bad = async (body, code) => { const r = await api(uid, "PUT", "/api/v1/profiles/me", { displayName: "X", persona: "STUDENT", ...body }); assert.equal(r.status, 400, JSON.stringify(body) + r.text); assert.equal(r.json.error, code, r.text); };
    await bad({ persona: "WIZARD" }, "INVALID_PERSONA");
    await bad({ website: "javascript:alert(1)" }, "INVALID_WEBSITE");
    await bad({ github: "https://evil.example/x" }, "INVALID_GITHUB");
    await bad({ bio: "x".repeat(1501) }, "INVALID_BIO");
    await bad({ researchInterests: "not a list" }, "INVALID_RESEARCH_INTERESTS");
    await bad({ orcid: "1234" }, "INVALID_ORCID");
    await bad({ surprise: 1 }, "UNKNOWN_FIELD");
    const missing = await api(uniq("a2c-"), "PUT", "/api/v1/profiles/me", { persona: "STUDENT" });
    assert.equal(missing.status, 400);
  });

  await t.test("[SEC-8] a malicious client cannot grant itself admin, verified-mentor status, a role or capacity", async () => {
    const uid = uniq("s8-");
    await onboard(uid);
    for (const forged of [{ isAdmin: true }, { admin: true }, { role: "ADMIN" }, { verifiedMentor: true }, { verified_mentor: true }, { mentorStatus: "APPROVED" }, { uid: "someone-else" }, { email: "x@y.z" }]) {
      const r = await api(uid, "PUT", "/api/v1/profiles/me", forged);
      assert.equal(r.status, 400, JSON.stringify(forged));
      assert.equal(r.json.error, "FIELD_NOT_ALLOWED", JSON.stringify(forged));
    }
    const cap = await api(uid, "PUT", "/api/v1/profiles/me", { mentorCapacity: 40 });
    assert.equal(cap.status, 403);
    assert.equal(cap.json.error, "NOT_VERIFIED_MENTOR");
    const persona = await api(uid, "PUT", "/api/v1/profiles/me", { persona: "MENTOR" });
    assert.equal(persona.status, 200, "choosing the MENTOR persona is allowed ...");
    assert.equal(persona.json.profile.verifiedMentor, false, "... and grants nothing");
    const me = await api(uid, "GET", "/api/v1/profiles/me");
    assert.equal(me.json.isAdmin, false);
    assert.equal((await pool.query("SELECT verified_mentor FROM user_profiles WHERE uid=$1", [uid])).rows[0].verified_mentor, false);
    // a forged token claim does not make anyone an administrator either: only the server's ADMIN_UIDS list does
    const claim = await R.call("GET", "/api/v1/admin/mentor-applications", { token: tokenFor(keys, uid, { admin: true, role: "admin", isAdmin: true }), headers: ipHeader() });
    assert.equal(claim.status, 403);
    assert.equal((await api(ADMIN, "GET", "/api/v1/profiles/me")).json.isAdmin, true);
  });

  await t.test("[SEC-2] user A cannot modify user B's profile", async () => {
    const [a, b] = [uniq("s2a-"), uniq("s2b-")];
    await onboard(a);
    const before = await onboard(b, { headline: "B's headline" });
    const viaPath = await api(a, "PUT", `/api/v1/profiles/${b}`, { headline: "hacked" });
    assert.ok(viaPath.status === 404 || viaPath.status === 405, `no such route: ${viaPath.status}`);
    const viaBody = await api(a, "PUT", "/api/v1/profiles/me", { uid: b, headline: "hacked" });
    assert.equal(viaBody.status, 400);
    const after = (await pool.query("SELECT headline, display_name FROM user_profiles WHERE uid=$1", [b])).rows[0];
    assert.equal(after.headline, "B's headline");
    assert.equal(after.display_name, before.displayName);
    // and A's own write did not touch B
    await api(a, "PUT", "/api/v1/profiles/me", { headline: "A's headline" });
    assert.equal((await pool.query("SELECT headline FROM user_profiles WHERE uid=$1", [b])).rows[0].headline, "B's headline");
  });

  await t.test("a public profile never contains the e-mail address; an unfinished profile is invisible to others", async () => {
    const [a, b, c] = [uniq("pp-"), uniq("pp-"), uniq("pp-")];
    await onboard(a);
    await onboard(b);
    await api(c, "PUT", "/api/v1/profiles/me", { displayName: "Half", persona: "STUDENT" });
    const seen = await api(a, "GET", `/api/v1/profiles/${b}`);
    assert.equal(seen.status, 200);
    assert.equal(seen.json.profile.uid, b);
    assert.ok(!("email" in seen.json.profile) && !("isAdmin" in seen.json.profile));
    assert.ok(!seen.text.includes(`${b}@example.test`), "the e-mail address appears nowhere in the response");
    const own = await api(b, "GET", "/api/v1/profiles/me");
    assert.equal(own.json.profile.email, `${b}@example.test`, "the owner sees their own e-mail");
    assert.equal((await api(a, "GET", `/api/v1/profiles/${c}`)).status, 404);
    assert.equal((await api(a, "GET", "/api/v1/profiles/does-not-exist")).status, 404);
    assert.equal((await api(a, "GET", "/api/v1/profiles/bad%20uid")).status, 404);
  });

  // ------------------------------------------------------------------------------------------------ mentor applications and directory
  await t.test("[SEC-3] a student cannot self-approve as a mentor, and every admin route refuses a non-admin", async () => {
    const stu = uniq("s3-");
    await onboard(stu);
    const app = await api(stu, "POST", "/api/v1/mentor-applications", APPLICATION);
    assert.equal(app.status, 201);
    assert.equal(app.json.application.status, "PENDING");
    const id = app.json.application.applicationId;
    const self = await api(stu, "PUT", `/api/v1/admin/mentor-applications/${id}`, { decision: "APPROVE" });
    assert.equal(self.status, 403);
    assert.equal((await api(stu, "POST", `/api/v1/admin/mentors/${stu}/revoke`, {})).status, 403);
    assert.equal((await api(stu, "GET", "/api/v1/admin/mentor-applications")).status, 403);
    assert.equal((await api(stu, "GET", "/api/v1/admin/reports")).status, 403);
    assert.equal((await api(stu, "PUT", "/api/v1/profiles/me", { verifiedMentor: true })).status, 400);
    const row = (await pool.query("SELECT verified_mentor FROM user_profiles WHERE uid=$1", [stu])).rows[0];
    assert.equal(row.verified_mentor, false);
    assert.equal((await pool.query("SELECT status FROM mentor_applications WHERE application_id=$1", [id])).rows[0].status, "PENDING");
    const mine = await api(stu, "GET", "/api/v1/mentor-applications/me");
    assert.equal(mine.json.application.status, "PENDING");
  });

  await t.test("applying needs a finished profile; one open application at a time; the body is validated", async () => {
    const nobody = uniq("ap1-");
    assert.equal((await api(nobody, "POST", "/api/v1/mentor-applications", APPLICATION)).json.error, "PROFILE_REQUIRED");
    const uid = uniq("ap2-");
    await onboard(uid);
    const bad = await api(uid, "POST", "/api/v1/mentor-applications", { ...APPLICATION, capacity: 0 });
    assert.equal(bad.status, 400);
    assert.equal((await api(uid, "POST", "/api/v1/mentor-applications", { ...APPLICATION, expertise: [] })).status, 400);
    assert.equal((await api(uid, "POST", "/api/v1/mentor-applications", { ...APPLICATION, verified: true })).status, 400);
    assert.equal((await api(uid, "POST", "/api/v1/mentor-applications", APPLICATION)).status, 201);
    const dup = await api(uid, "POST", "/api/v1/mentor-applications", APPLICATION);
    assert.equal(dup.status, 409);
  });

  await t.test("[SEC-4] an unapproved mentor does not appear in the verified directory; an approved one does, without an e-mail", async () => {
    const [pending, approved, viewer] = [uniq("d1-"), uniq("d1-"), uniq("d1-")];
    await onboard(viewer);
    await onboard(pending, { persona: "MENTOR", displayName: "Pending Pat", researchDomains: ["Quantum computing"] });
    await api(pending, "POST", "/api/v1/mentor-applications", APPLICATION);
    await makeMentor(approved, { displayName: "Approved Alex", researchDomains: ["Quantum computing"] });
    const dir = await api(viewer, "GET", "/api/v1/mentors?q=quantum");
    assert.equal(dir.status, 200);
    const uids = dir.json.mentors.map((m) => m.uid);
    assert.ok(uids.includes(approved));
    assert.ok(!uids.includes(pending), "a pending applicant is not listed");
    assert.equal((await api(viewer, "GET", `/api/v1/mentors/${pending}`)).status, 404);
    assert.equal((await api(viewer, "GET", `/api/v1/mentors/${approved}`)).status, 200);
    assert.ok(!dir.text.includes("@example.test"), "no e-mail address in the directory");
    const card = dir.json.mentors.find((m) => m.uid === approved);
    assert.equal(card.verifiedMentor, true);
    assert.equal(card.openSlots, 2);
    // a MENTOR persona without approval is not listed either
    const persona = uniq("d1p-");
    await onboard(persona, { persona: "MENTOR", researchDomains: ["Quantum computing"] });
    assert.ok(!(await api(viewer, "GET", "/api/v1/mentors?q=quantum&limit=50")).json.mentors.some((m) => m.uid === persona));
  });

  await t.test("directory: search, filters, sorting and pagination; hostile search text is treated as text", async () => {
    const viewer = uniq("d2v-");
    await onboard(viewer);
    const tag = uniq("zq").toLowerCase();
    const mentorsList = [uniq("d2a-"), uniq("d2b-"), uniq("d2c-")];
    await makeMentor(mentorsList[0], { displayName: `Alice ${tag}`, institution: "North Uni", researchDomains: ["Genomics"], skills: ["R"] });
    await makeMentor(mentorsList[1], { displayName: `Bob ${tag}`, institution: "South Uni", researchDomains: ["Genomics", "Ecology"], skills: ["Python"] }, { availability: "LIMITED" });
    await makeMentor(mentorsList[2], { displayName: `Cara ${tag}`, institution: "North Uni", researchDomains: ["Ecology"], skills: ["Python"] });
    const q = async (qs) => (await api(viewer, "GET", `/api/v1/mentors?${qs}`));
    assert.equal((await q(`q=${tag}`)).json.total, 3);
    assert.equal((await q(`q=${tag}&domain=genomics`)).json.total, 2);
    assert.equal((await q(`q=${tag}&institution=north`)).json.total, 2);
    assert.equal((await q(`q=${tag}&skill=python`)).json.total, 2);
    assert.equal((await q(`q=${tag}&availability=LIMITED`)).json.mentors[0].displayName, `Bob ${tag}`);
    const byName = (await q(`q=${tag}&sort=name`)).json.mentors.map((m) => m.displayName);
    assert.deepEqual(byName, [`Alice ${tag}`, `Bob ${tag}`, `Cara ${tag}`]);
    const p1 = (await q(`q=${tag}&sort=name&limit=2`)).json;
    assert.equal(p1.mentors.length, 2);
    assert.equal(p1.hasMore, true);
    const p2 = (await q(`q=${tag}&sort=name&limit=2&offset=2`)).json;
    assert.equal(p2.mentors.length, 1);
    assert.equal(p2.hasMore, false);
    assert.equal((await q("q=%25")).json.total, 0, "a literal % does not match everything");
    assert.equal((await q("q=%27%3B%20DROP%20TABLE%20user_profiles%3B--")).status, 200);
    assert.equal((await q("sort=drop")).status, 400);
    assert.equal((await q("limit=1000")).status, 400);
    assert.equal((await q("limit=abc")).status, 400);
    assert.equal((await q("level=KING")).status, 400);
    assert.ok((await pool.query("SELECT count(*)::int AS n FROM user_profiles")).rows[0].n > 5, "the table still exists");
    assert.ok(!(await q(`q=${tag}&limit=50`)).json.mentors.some((m) => m.uid === viewer));
  });

  await t.test("admin: review queue, reject then re-apply, notifications to the applicant, revoke removes the listing", async () => {
    const uid = uniq("ad1-");
    await onboard(uid, { persona: "MENTOR", researchDomains: ["Optics"] });
    const a1 = (await api(uid, "POST", "/api/v1/mentor-applications", APPLICATION)).json.application;
    const queue = await api(ADMIN, "GET", "/api/v1/admin/mentor-applications?status=PENDING");
    assert.equal(queue.status, 200);
    assert.ok(queue.json.applications.some((x) => x.applicationId === a1.applicationId));
    assert.ok(!queue.text.includes("@example.test"), "reviewers do not see e-mail addresses");
    assert.equal((await api(ADMIN, "PUT", `/api/v1/admin/mentor-applications/${a1.applicationId}`, { decision: "MAYBE" })).status, 400);
    assert.equal((await api(ADMIN, "PUT", "/api/v1/admin/mentor-applications/mapp_000000000000000000", { decision: "REJECT", note: "Not found anyway." })).status, 404);
    const rej = await api(ADMIN, "PUT", `/api/v1/admin/mentor-applications/${a1.applicationId}`, { decision: "REJECT", note: "Please add more detail." });
    assert.equal(rej.json.application.status, "REJECTED");
    assert.equal((await api(ADMIN, "PUT", `/api/v1/admin/mentor-applications/${a1.applicationId}`, { decision: "APPROVE" })).status, 409, "a decided application cannot be flipped");
    assert.equal((await notes(uid)).notifications[0].type, "MENTOR_APPLICATION_REJECTED");
    assert.equal((await api(uid, "GET", "/api/v1/mentors/" + uid)).status, 404);
    await approve(uid); // re-apply after rejection
    assert.equal((await notes(uid)).notifications[0].type, "MENTOR_APPLICATION_APPROVED");
    const viewer = uniq("ad1v-");
    await onboard(viewer);
    assert.equal((await api(viewer, "GET", `/api/v1/mentors/${uid}`)).status, 200);
    assert.equal((await api(ADMIN, "POST", `/api/v1/admin/mentors/${uid}/revoke`, { note: "test revoke" })).status, 200);
    assert.equal((await api(viewer, "GET", `/api/v1/mentors/${uid}`)).status, 404);
    assert.equal((await api(ADMIN, "POST", `/api/v1/admin/mentors/${uid}/revoke`, { note: "already revoked" })).status, 409);
    assert.equal((await notes(uid)).notifications[0].type, "MENTOR_STATUS_REVOKED");
  });


  // ------------------------------------------------------------------------------------------------ verification journey (brief: registration to verification)
  await t.test("[SEC-9] separation of duties: an administrator cannot approve, reject or revoke their OWN application; another administrator can", async () => {
    // ADMIN is an administrator who also applies to become a mentor.
    await onboard(ADMIN, { persona: "MENTOR", researchDomains: ["Optics"] });
    const mine = (await api(ADMIN, "POST", "/api/v1/mentor-applications", APPLICATION)).json.application;
    const before = await notes(ADMIN);
    const approve = await api(ADMIN, "PUT", `/api/v1/admin/mentor-applications/${mine.applicationId}`, { decision: "APPROVE" });
    assert.equal(approve.status, 403); assert.equal(approve.json.error, "SELF_REVIEW_FORBIDDEN");
    const reject = await api(ADMIN, "PUT", `/api/v1/admin/mentor-applications/${mine.applicationId}`, { decision: "REJECT", note: "I would like to reject myself" });
    assert.equal(reject.status, 403); assert.equal(reject.json.error, "SELF_REVIEW_FORBIDDEN");
    // nothing changed: still pending, not verified, no notification, not listed
    assert.equal((await api(ADMIN, "GET", "/api/v1/mentor-applications/me")).json.status, "PENDING");
    assert.equal((await api(ADMIN, "GET", "/api/v1/profiles/me")).json.profile.verifiedMentor, false);
    assert.equal((await notes(ADMIN)).notifications.length, before.notifications.length);
    assert.equal((await pool.query("SELECT verified_mentor FROM user_profiles WHERE uid=$1", [ADMIN])).rows[0].verified_mentor, false);
    // the queue tells the UI which row is the reviewer's own
    const queue = (await api(ADMIN, "GET", "/api/v1/admin/mentor-applications?status=PENDING&limit=50")).json.applications;
    assert.equal(queue.find((x) => x.applicationId === mine.applicationId).ownApplication, true);
    // a second administrator can decide it
    const ok = await api(ADMIN2, "PUT", `/api/v1/admin/mentor-applications/${mine.applicationId}`, { decision: "APPROVE" });
    assert.equal(ok.status, 200); assert.equal(ok.json.application.status, "APPROVED");
    // and now that ADMIN is a verified mentor, ADMIN cannot revoke themselves either, while ADMIN2 can
    const selfRevoke = await api(ADMIN, "POST", `/api/v1/admin/mentors/${ADMIN}/revoke`, { note: "revoking myself" });
    assert.equal(selfRevoke.status, 403); assert.equal(selfRevoke.json.error, "SELF_REVIEW_FORBIDDEN");
    assert.equal((await api(ADMIN, "GET", "/api/v1/profiles/me")).json.profile.verifiedMentor, true);
    assert.equal((await api(ADMIN2, "POST", `/api/v1/admin/mentors/${ADMIN}/revoke`, { note: "end of term" })).status, 200);
    // a client-sent uid or flag cannot disguise whose application it is
    const x = uniq("sod-");
    await onboard(x, { persona: "MENTOR", researchDomains: ["Optics"] });
    const xa = (await api(x, "POST", "/api/v1/mentor-applications", APPLICATION)).json.application;
    assert.equal((await api(ADMIN2, "PUT", `/api/v1/admin/mentor-applications/${xa.applicationId}`, { decision: "APPROVE", adminUid: x, reviewerUid: x })).status, 400, "unknown keys are refused");
  });

  await t.test("a rejection or a revocation must carry a reason, and the application stays untouched without one", async () => {
    const uid = uniq("why-");
    await onboard(uid, { persona: "MENTOR", researchDomains: ["Optics"] });
    const a = (await api(uid, "POST", "/api/v1/mentor-applications", APPLICATION)).json.application;
    for (const body of [{ decision: "REJECT" }, { decision: "REJECT", note: "" }, { decision: "REJECT", note: "no" }]) {
      const r = await api(ADMIN, "PUT", `/api/v1/admin/mentor-applications/${a.applicationId}`, body);
      assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(r.json.error, "REASON_REQUIRED");
    }
    assert.equal((await api(uid, "GET", "/api/v1/mentor-applications/me")).json.status, "PENDING");
    assert.equal((await api(ADMIN, "PUT", `/api/v1/admin/mentor-applications/${a.applicationId}`, { decision: "APPROVE" })).status, 200, "approving needs no reason");
    const r = await api(ADMIN, "POST", `/api/v1/admin/mentors/${uid}/revoke`, {});
    assert.equal(r.status, 400); assert.equal(r.json.error, "REASON_REQUIRED");
    assert.equal((await api(uid, "GET", "/api/v1/profiles/me")).json.profile.verifiedMentor, true, "still verified: the revoke was refused");
  });

  await t.test("the mentor application collects institution, designation, biography, ORCID and Google Scholar, validates them, and shows them to the reviewer", async () => {
    const uid = uniq("det-");
    await onboard(uid, { persona: "MENTOR", researchDomains: ["Optics"] });
    for (const [bad, field] of [[{ institution: "" }, "institution"], [{ designation: undefined }, "designation"], [{ professionalBio: "too short" }, "professionalBio"],
      [{ orcid: "1234" }, "orcid"], [{ googleScholar: "https://evil.example/citations" }, "googleScholar"], [{ googleScholar: "http://scholar.google.com/x" }, "googleScholar"],
      [{ verificationNote: "x".repeat(501) }, "verificationNote"], [{ portfolioLinks: ["javascript:alert(1)"] }, "portfolioLinks"]]) {
      const r = await api(uid, "POST", "/api/v1/mentor-applications", { ...APPLICATION, ...bad });
      assert.equal(r.status, 400, `${field}: ${r.text}`);
    }
    assert.equal((await api(uid, "POST", "/api/v1/mentor-applications", { ...APPLICATION, orcid: undefined, googleScholar: undefined, verificationNote: undefined })).status, 201, "ORCID, Scholar and the note are optional");
    const mine = (await api(uid, "GET", "/api/v1/mentor-applications/me")).json.application;
    assert.equal(mine.institution, "Test University"); assert.equal(mine.designation, "Postdoctoral researcher"); assert.equal(mine.orcid, null); assert.equal(mine.googleScholar, null);
    const row = (await api(ADMIN, "GET", "/api/v1/admin/mentor-applications?status=PENDING&limit=50")).json.applications.find((x) => x.applicationId === mine.applicationId);
    for (const k of ["institution", "designation", "professionalBio", "expertise", "portfolioLinks", "createdAt", "status"]) assert.ok(row[k] !== undefined && row[k] !== null, k);
    assert.equal(row.applicant.displayName.startsWith("Person"), true);
    assert.ok(!JSON.stringify(row).includes("@"), "no e-mail in the review queue");
  });

  await t.test("journeys B-H: mentor applies (pending, not listed) -> admin approves -> listed -> student requests -> mentor accepts; a rejected and a revoked mentor are never listed", async () => {
    const [mentor, student, rejected, revoked] = [uniq("jb-"), uniq("jb-"), uniq("jb-"), uniq("jb-")];
    const listed = async (viewer, uid) => (await api(viewer, "GET", `/api/v1/mentors?limit=50&q=${encodeURIComponent("Person " + uid.slice(0, 6))}`)).json.mentors.some((m) => m.uid === uid);
    await onboard(student);
    // B: pending applicant
    await onboard(mentor, { persona: "MENTOR", researchDomains: ["Deep learning"] });
    const app = (await api(mentor, "POST", "/api/v1/mentor-applications", APPLICATION)).json.application;
    assert.equal((await api(mentor, "GET", "/api/v1/mentor-applications/me")).json.status, "PENDING");
    assert.equal(await listed(student, mentor), false, "PENDING mentor is not in the verified directory");
    assert.equal((await api(student, "GET", `/api/v1/mentors/${mentor}`)).status, 404);
    assert.equal((await api(student, "POST", "/api/v1/mentorship/requests", { mentorUid: mentor, domain: "d", interests: "I want to learn how to read", guidanceNeeded: "How to design an experiment" })).status, 404, "an unverified mentor cannot be requested (not found, like the directory)");
    // C + D: approved and listed
    assert.equal((await api(ADMIN, "PUT", `/api/v1/admin/mentor-applications/${app.applicationId}`, { decision: "APPROVE" })).status, 200);
    assert.equal((await api(mentor, "GET", "/api/v1/mentor-applications/me")).json.status, "APPROVED");
    assert.equal(await listed(student, mentor), true);
    // E + F: request and accept
    const rq = await request(student, mentor);
    assert.equal(rq.status, 201, rq.text);
    const acc = await api(mentor, "PUT", `/api/v1/mentorship/requests/${rq.json.request.requestId}`, { action: "ACCEPT" });
    assert.equal(acc.status, 200); assert.equal(acc.json.request.status, "ACCEPTED"); assert.ok(acc.json.conversationId);
    assert.equal((await api(student, "GET", "/api/v1/mentorship/relationships?status=ACTIVE")).json.relationships.length, 1);
    // G: rejected mentor sees the note, is not listed, and may reapply
    await onboard(rejected, { persona: "MENTOR", researchDomains: ["Deep learning"] });
    const ra = (await api(rejected, "POST", "/api/v1/mentor-applications", APPLICATION)).json.application;
    assert.equal((await api(ADMIN, "PUT", `/api/v1/admin/mentor-applications/${ra.applicationId}`, { decision: "REJECT", note: "Please add a verifiable link." })).status, 200);
    const rs = (await api(rejected, "GET", "/api/v1/mentor-applications/me")).json;
    assert.equal(rs.status, "REJECTED"); assert.equal(rs.application.reviewNote, "Please add a verifiable link."); assert.equal(rs.verifiedMentor, false);
    assert.equal(await listed(student, rejected), false);
    assert.equal((await api(rejected, "POST", "/api/v1/mentor-applications", APPLICATION)).status, 201, "a rejected applicant may reapply");
    // H: revoked mentor disappears and may reapply
    await onboard(revoked, { persona: "MENTOR", researchDomains: ["Deep learning"] });
    const va = (await api(revoked, "POST", "/api/v1/mentor-applications", APPLICATION)).json.application;
    await api(ADMIN, "PUT", `/api/v1/admin/mentor-applications/${va.applicationId}`, { decision: "APPROVE" });
    assert.equal(await listed(student, revoked), true);
    assert.equal((await api(ADMIN, "POST", `/api/v1/admin/mentors/${revoked}/revoke`, { note: "Credentials could not be verified." })).status, 200);
    assert.equal(await listed(student, revoked), false);
    assert.equal((await api(student, "GET", `/api/v1/mentors/${revoked}`)).status, 404);
    const vs = (await api(revoked, "GET", "/api/v1/mentor-applications/me")).json;
    assert.equal(vs.status, "REVOKED"); assert.equal(vs.verifiedMentor, false);
    assert.equal((await api(revoked, "POST", "/api/v1/mentor-applications", APPLICATION)).status, 201, "a revoked mentor may reapply");
    // I: a non-admin is denied every review endpoint
    for (const [m, path, body] of [["GET", "/api/v1/admin/mentor-applications"], ["PUT", `/api/v1/admin/mentor-applications/${ra.applicationId}`, { decision: "APPROVE" }], ["POST", `/api/v1/admin/mentors/${mentor}/revoke`, { note: "nope nope" }], ["GET", "/api/v1/admin/reports"]]) {
      assert.equal((await api(student, m, path, body)).status, 403, `${m} ${path}`);
    }
  });


  await t.test("choosing or changing the profile type never grants or removes verification, and never grants administrator access", async () => {
    const uid = uniq("pt-");
    // a person who picks Mentor at sign-up is just a person with persona MENTOR: not verified, not listed, not an administrator
    await onboard(uid, { persona: "MENTOR", researchDomains: ["Optics"] });
    const me0 = (await api(uid, "GET", "/api/v1/profiles/me")).json;
    assert.equal(me0.profile.persona, "MENTOR"); assert.equal(me0.profile.verifiedMentor, false); assert.equal(me0.isAdmin, false);
    const viewer = uniq("ptv-"); await onboard(viewer);
    assert.equal((await api(viewer, "GET", `/api/v1/mentors/${uid}`)).status, 404, "persona MENTOR alone is not a listing");
    // privileged keys in the same request are refused outright
    for (const extra of [{ verifiedMentor: true }, { isAdmin: true }, { role: "admin" }, { admin: true }, { mentorCapacity: 9 }]) { const r = await api(uid, "PUT", "/api/v1/profiles/me", { persona: "MENTOR", ...extra }); assert.ok([400, 403].includes(r.status), `${JSON.stringify(extra)} -> ${r.status}`); }
    assert.equal((await api(uid, "GET", "/api/v1/profiles/me")).json.profile.verifiedMentor, false);
    assert.equal((await api(uid, "GET", "/api/v1/admin/mentor-applications")).status, 403);
    // once verified, a later persona change does not remove the verification (only an administrator can), and does not hide the listing
    const app = (await api(uid, "POST", "/api/v1/mentor-applications", APPLICATION)).json.application;
    await api(ADMIN, "PUT", `/api/v1/admin/mentor-applications/${app.applicationId}`, { decision: "APPROVE" });
    assert.equal((await api(viewer, "GET", `/api/v1/mentors/${uid}`)).status, 200);
    assert.equal((await api(uid, "PUT", "/api/v1/profiles/me", { persona: "STUDENT" })).status, 200);
    const me1 = (await api(uid, "GET", "/api/v1/profiles/me")).json;
    assert.equal(me1.profile.persona, "STUDENT"); assert.equal(me1.profile.verifiedMentor, true);
    assert.equal((await api(viewer, "GET", `/api/v1/mentors/${uid}`)).status, 200);
    // and a verified mentor cannot reach admin APIs either
    assert.equal((await api(uid, "PUT", `/api/v1/admin/mentor-applications/${app.applicationId}`, { decision: "REJECT", note: "nope nope" })).status, 403);
  });

  // ------------------------------------------------------------------------------------------------ mentorship
  await t.test("request lifecycle: create, duplicate guard, visibility, wrong-party actions, accept creates a mentorship and a private conversation", async () => {
    const [mentor, mentee, stranger] = [uniq("m1-"), uniq("m1-"), uniq("m1-")];
    await makeMentor(mentor, { displayName: "Mentor M" });
    await onboard(mentee, { displayName: "Mentee E" });
    await onboard(stranger);
    const r = await request(mentee, mentor);
    assert.equal(r.status, 201, r.text);
    const rq = r.json.request;
    assert.equal(rq.status, "PENDING");
    assert.equal((await request(mentee, mentor)).json.error, "DUPLICATE_REQUEST");
    assert.equal((await request(mentee, mentee)).status, 400);
    assert.equal((await request(mentee, stranger)).status, 404, "an ordinary user is not a mentor");
    assert.equal((await request(uniq("m1n-"), mentor)).json.error, "PROFILE_REQUIRED");
    assert.equal((await request(mentee, mentor, { interests: "short" })).status, 400);
    assert.equal((await api(mentee, "POST", "/api/v1/mentorship/requests", { mentorUid: mentor, domain: "x", interests: "long enough text", guidanceNeeded: "long enough text", status: "ACCEPTED" })).status, 400, "a client cannot choose the status");
    // the mentor was notified
    const n = (await notes(mentor)).notifications.find((x) => x.type === "MENTORSHIP_REQUEST_RECEIVED");
    assert.ok(n && n.data.requestId === rq.requestId);
    // visibility
    assert.equal((await api(mentor, "GET", "/api/v1/mentorship/requests?box=incoming")).json.requests[0].requestId, rq.requestId);
    assert.equal((await api(mentee, "GET", "/api/v1/mentorship/requests?box=outgoing")).json.requests[0].requestId, rq.requestId);
    assert.equal((await api(mentee, "GET", "/api/v1/mentorship/requests?box=incoming")).json.requests.length, 0);
    assert.equal((await api(stranger, "GET", `/api/v1/mentorship/requests/${rq.requestId}`)).status, 404);
    assert.equal((await api(stranger, "PUT", `/api/v1/mentorship/requests/${rq.requestId}`, { action: "ACCEPT" })).status, 404);
    assert.equal((await api(mentee, "PUT", `/api/v1/mentorship/requests/${rq.requestId}`, { action: "ACCEPT" })).status, 403, "the mentee cannot accept their own request");
    assert.equal((await api(mentor, "PUT", `/api/v1/mentorship/requests/${rq.requestId}`, { action: "CANCEL" })).status, 403, "the mentor cannot cancel it");
    assert.equal((await api(mentor, "PUT", `/api/v1/mentorship/requests/${rq.requestId}`, { action: "TELEPORT" })).status, 400);
    // accept
    const acc = await api(mentor, "PUT", `/api/v1/mentorship/requests/${rq.requestId}`, { action: "ACCEPT" });
    assert.equal(acc.status, 200, acc.text);
    assert.equal(acc.json.request.status, "ACCEPTED");
    assert.match(acc.json.conversationId, /^conv_[0-9a-f]{18}$/);
    assert.equal((await api(mentor, "PUT", `/api/v1/mentorship/requests/${rq.requestId}`, { action: "ACCEPT" })).status, 409, "no double accept");
    assert.equal((await api(mentee, "PUT", `/api/v1/mentorship/requests/${rq.requestId}`, { action: "CANCEL" })).status, 409, "an accepted request cannot be cancelled");
    assert.ok((await notes(mentee)).notifications.some((x) => x.type === "MENTORSHIP_REQUEST_ACCEPTED" && x.data.conversationId === acc.json.conversationId));
    assert.ok((await notes(mentor)).notifications.some((x) => x.type === "MENTORSHIP_STARTED"));
    const rels = await api(mentee, "GET", "/api/v1/mentorship/relationships?status=ACTIVE");
    assert.equal(rels.json.relationships[0].role, "MENTEE");
    assert.equal(rels.json.relationships[0].conversationId, acc.json.conversationId);
    assert.equal((await api(stranger, "GET", "/api/v1/mentorship/relationships")).json.relationships.length, 0);
    // a new request while one is active is a duplicate
    assert.equal((await request(mentee, mentor)).json.error, "DUPLICATE_REQUEST");
    // the mentor's open slots dropped
    assert.equal((await api(stranger, "GET", `/api/v1/mentors/${mentor}`)).json.mentor.openSlots, 1);
  });

  await t.test("decline and cancel are final but do not block a fresh request; statuses follow the state machine", async () => {
    const [mentor, mentee] = [uniq("m2-"), uniq("m2-")];
    await makeMentor(mentor);
    await onboard(mentee);
    const r1 = (await request(mentee, mentor)).json.request;
    const rej = await api(mentor, "PUT", `/api/v1/mentorship/requests/${r1.requestId}`, { action: "REJECT", note: "Full this term" });
    assert.equal(rej.json.request.status, "REJECTED");
    assert.ok((await notes(mentee)).notifications.some((x) => x.type === "MENTORSHIP_REQUEST_REJECTED"));
    assert.equal((await api(mentor, "PUT", `/api/v1/mentorship/requests/${r1.requestId}`, { action: "ACCEPT" })).status, 409, "a declined request cannot be revived");
    const r2 = (await request(mentee, mentor)).json.request;
    const can = await api(mentee, "PUT", `/api/v1/mentorship/requests/${r2.requestId}`, { action: "CANCEL" });
    assert.equal(can.json.request.status, "CANCELLED");
    assert.ok((await notes(mentor)).notifications.some((x) => x.type === "MENTORSHIP_REQUEST_CANCELLED"));
    assert.equal((await api(mentee, "PUT", `/api/v1/mentorship/requests/${r2.requestId}`, { action: "CANCEL" })).status, 409);
    const r3 = await request(mentee, mentor);
    assert.equal(r3.status, 201, "history of decided requests does not block a new one");
    const hist = await api(mentee, "GET", "/api/v1/mentorship/requests?box=outgoing&status=REJECTED");
    assert.equal(hist.json.requests.length, 1);
    assert.equal((await api(mentee, "GET", "/api/v1/mentorship/requests?box=sideways")).status, 400);
  });

  await t.test("mentor capacity is enforced, including under two simultaneous accepts", async () => {
    const mentor = uniq("m3-");
    await makeMentor(mentor, {}, { capacity: 1 });
    const mentees = [uniq("m3a-"), uniq("m3b-")];
    for (const m of mentees) await onboard(m);
    const reqs = [];
    for (const m of mentees) reqs.push((await request(m, mentor)).json.request.requestId);
    const both = await Promise.all(reqs.map((id) => api(mentor, "PUT", `/api/v1/mentorship/requests/${id}`, { action: "ACCEPT" })));
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409], JSON.stringify(both.map((r) => r.text)));
    assert.ok(both.some((r) => r.json.error === "CAPACITY_REACHED"));
    const active = (await pool.query("SELECT count(*)::int AS n FROM mentorship_relationships WHERE mentor_uid=$1 AND status='ACTIVE'", [mentor])).rows[0].n;
    assert.equal(active, 1);
    // an UNAVAILABLE mentor takes no new requests
    const busy = uniq("m3c-");
    await makeMentor(busy);
    await api(busy, "PUT", "/api/v1/profiles/me", { availability: "UNAVAILABLE" });
    assert.equal((await request(mentees[0], busy)).json.error, "MENTOR_UNAVAILABLE");
  });

  await t.test("two simultaneous identical requests create exactly one", async () => {
    const [mentor, mentee] = [uniq("m4-"), uniq("m4-")];
    await makeMentor(mentor);
    await onboard(mentee);
    const rs = await Promise.all([request(mentee, mentor), request(mentee, mentor), request(mentee, mentor)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409, 409]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM mentorship_requests WHERE mentee_uid=$1", [mentee])).rows[0].n, 1);
  });

  // ------------------------------------------------------------------------------------------------ messaging and notifications
  async function pair() {
    const [mentor, mentee] = [uniq("c-"), uniq("c-")];
    await makeMentor(mentor, { displayName: "Mentor Mia" });
    await onboard(mentee, { displayName: "Mentee Max" });
    const rq = (await request(mentee, mentor)).json.request;
    const acc = (await api(mentor, "PUT", `/api/v1/mentorship/requests/${rq.requestId}`, { action: "ACCEPT" })).json;
    return { mentor, mentee, conv: acc.conversationId, rel: acc.relationshipId };
  }
  const send = (uid, conv, body, clientId) => api(uid, "POST", `/api/v1/conversations/${conv}/messages`, { body, ...(clientId ? { clientId } : {}) });

  await t.test("send, receive, history, read receipts and unread counts", async () => {
    const { mentor, mentee, conv } = await pair();
    const m1 = await send(mentee, conv, "Hello, thank you for accepting!", "client-aaaa-0001");
    assert.equal(m1.status, 201, m1.text);
    assert.equal(m1.json.message.mine, true);
    assert.equal(m1.json.message.readByOther, false);
    assert.ok(Date.parse(m1.json.message.createdAt) > 0);
    await send(mentee, conv, "When can we talk?");
    // the mentor sees 2 unread, once
    const list = await api(mentor, "GET", "/api/v1/conversations");
    assert.equal(list.json.unreadTotal, 2);
    const row = list.json.conversations.find((c) => c.conversationId === conv);
    assert.equal(row.unreadCount, 2);
    assert.equal(row.lastMessage.body, "When can we talk?");
    assert.equal(row.other.displayName, "Mentee Max");
    assert.equal((await api(mentor, "GET", "/api/v1/me/counters")).json.messages, 2);
    // polling: only newer messages
    const first = (await api(mentor, "GET", `/api/v1/conversations/${conv}/messages`)).json;
    assert.equal(first.messages.length, 2);
    assert.equal(first.messages[0].mine, false);
    const after = (await api(mentor, "GET", `/api/v1/conversations/${conv}/messages?after=${first.messages[1].id}`)).json;
    assert.equal(after.messages.length, 0);
    assert.equal((await send(mentor, conv, "Tomorrow at 10?")).status, 201);
    assert.equal((await api(mentee, "GET", `/api/v1/conversations/${conv}/messages?after=${first.messages[1].id}`)).json.messages.length, 1);
    // read
    assert.equal((await api(mentor, "POST", `/api/v1/conversations/${conv}/read`)).json.unreadTotal, 0);
    const seen = (await api(mentee, "GET", `/api/v1/conversations/${conv}/messages`)).json;
    assert.equal(seen.messages.filter((m) => m.mine).every((m) => m.readByOther), true, "the mentee sees their messages as read");
    // the mentee's own unread is the mentor's reply
    assert.equal((await api(mentee, "GET", "/api/v1/conversations")).json.unreadTotal, 1);
    // retry with the same clientId is idempotent
    const again = await send(mentee, conv, "Hello, thank you for accepting!", "client-aaaa-0001");
    assert.equal(again.status, 200);
    assert.equal(again.json.message.id, m1.json.message.id);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE conversation_id=$1", [conv])).rows[0].n, 3);
  });

  await t.test("history is paginated (newest page first, older pages by `before`); length and content limits hold", async () => {
    const { mentee, conv } = await pair();
    for (let i = 1; i <= 7; i += 1) await send(mentee, conv, `message ${i}`);
    const p1 = (await api(mentee, "GET", `/api/v1/conversations/${conv}/messages?limit=3`)).json;
    assert.deepEqual(p1.messages.map((m) => m.body), ["message 5", "message 6", "message 7"]);
    assert.ok(p1.nextBefore);
    const p2 = (await api(mentee, "GET", `/api/v1/conversations/${conv}/messages?limit=3&before=${p1.nextBefore}`)).json;
    assert.deepEqual(p2.messages.map((m) => m.body), ["message 2", "message 3", "message 4"]);
    const p3 = (await api(mentee, "GET", `/api/v1/conversations/${conv}/messages?limit=3&before=${p2.nextBefore}`)).json;
    assert.deepEqual(p3.messages.map((m) => m.body), ["message 1"]);
    assert.equal(p3.nextBefore, null);
    assert.equal((await api(mentee, "GET", `/api/v1/conversations/${conv}/messages?before=1&after=2`)).status, 400);
    assert.equal((await api(mentee, "GET", `/api/v1/conversations/${conv}/messages?before=abc`)).status, 400);
    assert.equal((await send(mentee, conv, "x".repeat(2001))).status, 400);
    assert.equal((await send(mentee, conv, "x".repeat(2000))).status, 201);
    assert.equal((await send(mentee, conv, "   ")).status, 400);
    assert.equal((await send(mentee, conv, "")).status, 400);
    assert.equal((await api(mentee, "POST", `/api/v1/conversations/${conv}/messages`, { body: "hi", senderUid: "someone" })).status, 400, "a client cannot name the sender");
    assert.equal((await api(mentee, "POST", `/api/v1/conversations/${conv}/messages`, { body: 12 })).status, 400);
    assert.equal((await send(mentee, conv, "ok", "bad id!")).status, 400);
    const html = await send(mentee, conv, "<script>alert(1)</script> & stuff");
    assert.equal(html.json.message.body, "<script>alert(1)</script> & stuff", "text is stored as typed; the client renders it as text");
  });

  await t.test("[SEC-1] user A cannot read user B's private messages (outsiders and other pairs get 404 everywhere)", async () => {
    const p1 = await pair();
    const p2 = await pair();
    const secret = `secret-${uniq("")}`;
    await send(p1.mentee, p1.conv, secret);
    const outsider = p2.mentee;
    for (const [m, path, body] of [
      ["GET", `/api/v1/conversations/${p1.conv}`], ["GET", `/api/v1/conversations/${p1.conv}/messages`], ["GET", `/api/v1/conversations/${p1.conv}/messages?after=0`],
      ["POST", `/api/v1/conversations/${p1.conv}/messages`, { body: "intruder" }], ["POST", `/api/v1/conversations/${p1.conv}/read`], ["POST", `/api/v1/conversations/${p1.conv}/report`, { reason: "snooping around" }]
    ]) {
      const r = await api(outsider, m, path, body);
      assert.equal(r.status, 404, `${m} ${path}: ${r.status}`);
      assert.ok(!r.text.includes(secret));
    }
    const list = await api(outsider, "GET", "/api/v1/conversations");
    assert.ok(!list.text.includes(secret) && !list.json.conversations.some((c) => c.conversationId === p1.conv));
    // an administrator is not a participant either
    assert.equal((await api(ADMIN, "GET", `/api/v1/conversations/${p1.conv}/messages`)).status, 404);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE conversation_id=$1 AND body='intruder'", [p1.conv])).rows[0].n, 0);
    assert.equal((await api(outsider, "GET", "/api/v1/conversations/not-an-id/messages")).status, 404);
  });

  await t.test("[SEC-5] a non-participant cannot read or join a conversation, and cannot add themselves to one", async () => {
    const { conv, mentee } = await pair();
    const stranger = uniq("s5-");
    await onboard(stranger);
    assert.equal((await api(stranger, "GET", `/api/v1/conversations/${conv}`)).status, 404);
    const dm = await api(stranger, "POST", "/api/v1/conversations", { recipientUid: mentee });
    assert.equal(dm.status, 409, "starting a direct chat needs the recipient's consent setting");
    assert.equal(dm.json.error, "DIRECT_MESSAGES_OFF");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM conversation_participants WHERE conversation_id=$1 AND uid=$2", [conv, stranger])).rows[0].n, 0);
  });

  await t.test("direct conversations need the recipient to allow them, are not duplicated, and can be blocked and reported", async () => {
    const [a, b] = [uniq("dm-"), uniq("dm-")];
    await onboard(a, { displayName: "Alpha" });
    await onboard(b, { displayName: "Beta" });
    const off = await api(a, "POST", "/api/v1/conversations", { recipientUid: b });
    assert.equal(off.status, 409, "off by default");
    assert.equal(off.json.error, "DIRECT_MESSAGES_OFF");
    await api(b, "PUT", "/api/v1/profiles/me", { allowDirectMessages: true });
    const c1 = await api(a, "POST", "/api/v1/conversations", { recipientUid: b });
    assert.equal(c1.status, 201, c1.text);
    const c2 = await api(a, "POST", "/api/v1/conversations", { recipientUid: b });
    assert.equal(c2.status, 200);
    assert.equal(c2.json.conversation.conversationId, c1.json.conversation.conversationId);
    const c3 = await api(b, "POST", "/api/v1/conversations", { recipientUid: a });
    assert.equal(c3.json.conversation.conversationId, c1.json.conversation.conversationId, "the same pair always shares one conversation");
    assert.equal((await api(a, "POST", "/api/v1/conversations", { recipientUid: a })).status, 400);
    assert.equal((await api(a, "POST", "/api/v1/conversations", { recipientUid: "ghost-user" })).status, 404);
    const conv = c1.json.conversation.conversationId;
    assert.equal((await send(a, conv, "hi Beta")).status, 201);
    // block
    assert.equal((await api(b, "PUT", `/api/v1/users/${a}/block`)).status, 200);
    const blocked = await send(a, conv, "still there?");
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.error, "BLOCKED");
    assert.equal((await send(b, conv, "no")).json.error, "BLOCKED", "the blocker cannot send either");
    assert.equal((await api(a, "GET", `/api/v1/conversations/${conv}/messages`)).json.messages.length, 1, "history stays readable");
    assert.equal((await api(a, "POST", "/api/v1/conversations", { recipientUid: b })).status === 201, false);
    assert.equal((await api(b, "DELETE", `/api/v1/users/${a}/block`)).status, 200);
    assert.equal((await send(a, conv, "back again")).status, 201);
    assert.equal((await api(b, "PUT", "/api/v1/users/ghost-user/block")).status, 404);
    assert.equal((await api(b, "PUT", `/api/v1/users/${b}/block`)).status, 400);
    // report
    const msg = (await api(b, "GET", `/api/v1/conversations/${conv}/messages`)).json.messages[0];
    assert.equal((await api(b, "POST", `/api/v1/conversations/${conv}/report`, { reason: "no" })).status, 400, "reason too short");
    const rep = await api(b, "POST", `/api/v1/conversations/${conv}/report`, { reason: "This message is spam", messageId: msg.id });
    assert.equal(rep.status, 201);
    assert.equal((await api(b, "POST", `/api/v1/conversations/${conv}/report`, { reason: "This message is spam", messageId: "999999999" })).status, 404);
    const queue = await api(ADMIN, "GET", "/api/v1/admin/reports");
    assert.equal(queue.status, 200);
    const item = queue.json.reports.find((x) => x.reportId === rep.json.reportId);
    assert.equal(item.messageBody, "hi Beta");
    assert.ok(!queue.text.includes("back again"), "reviewers see only the reported message, not the rest of the conversation");
  });

  await t.test("completing a mentorship closes the conversation: readable, not writable; either party may complete; the other is notified", async () => {
    const { mentor, mentee, conv, rel } = await pair();
    await send(mentee, conv, "before completion");
    assert.equal((await api(uniq("x-"), "PUT", `/api/v1/mentorship/relationships/${rel}`, { action: "COMPLETE" })).status, 404);
    const done = await api(mentee, "PUT", `/api/v1/mentorship/relationships/${rel}`, { action: "COMPLETE" });
    assert.equal(done.status, 200, done.text);
    assert.equal(done.json.relationship.status, "COMPLETED");
    assert.equal((await api(mentor, "PUT", `/api/v1/mentorship/relationships/${rel}`, { action: "COMPLETE" })).status, 409);
    assert.ok((await notes(mentor)).notifications.some((x) => x.type === "MENTORSHIP_COMPLETED"));
    const closed = await send(mentor, conv, "too late");
    assert.equal(closed.status, 409);
    assert.equal(closed.json.error, "CONVERSATION_CLOSED");
    assert.equal((await api(mentor, "GET", `/api/v1/conversations/${conv}/messages`)).json.messages.length, 1);
    const requestRow = (await pool.query("SELECT r.status FROM mentorship_requests r JOIN mentorship_relationships m USING (request_id) WHERE m.relationship_id=$1", [rel])).rows[0];
    assert.equal(requestRow.status, "COMPLETED");
    assert.equal((await api(mentor, "GET", "/api/v1/mentorship/relationships?status=COMPLETED")).json.relationships.length, 1);
  });

  await t.test("notifications: list, unread count, mark one, mark all, pagination", async () => {
    const { mentor, mentee, conv } = await pair();
    for (let i = 0; i < 4; i += 1) await send(mentee, conv, `ping ${i}`);
    const all = await notes(mentor);
    assert.ok(all.unreadCount >= 3);
    assert.equal(all.notifications[0].type, "NEW_MESSAGE");
    assert.equal(all.notifications[0].data.conversationId, conv);
    assert.ok(!JSON.stringify(all.notifications).includes("ping"), "notifications carry no message text");
    assert.equal((await api(mentor, "GET", "/api/v1/notifications/unread-count")).json.unreadCount, all.unreadCount);
    const p1 = await notes(mentor, "?limit=2");
    assert.equal(p1.notifications.length, 2);
    assert.ok(p1.nextBefore);
    const p2 = await notes(mentor, `?limit=2&before=${p1.nextBefore}`);
    assert.ok(p2.notifications.every((n) => Number(n.id) < Number(p1.nextBefore)));
    const target = all.notifications[0];
    const one = await api(mentor, "POST", `/api/v1/notifications/${target.id}/read`);
    assert.equal(one.status, 200);
    assert.ok(one.json.notification.read);
    assert.equal(one.json.unreadCount, all.unreadCount - 1);
    assert.equal((await notes(mentor, "?unread=true")).notifications.every((n) => !n.read), true);
    const allRead = await api(mentor, "POST", "/api/v1/notifications/read-all");
    assert.equal(allRead.json.unreadCount, 0);
    assert.equal((await api(mentor, "GET", "/api/v1/notifications/unread-count")).json.unreadCount, 0);
    assert.equal((await api(mentor, "POST", "/api/v1/notifications/abc/read")).status, 404);
    assert.equal((await api(mentor, "GET", "/api/v1/notifications?before=abc")).status, 400);
    assert.equal((await api(mentor, "GET", "/api/v1/notifications?limit=500")).status, 400);
  });

  await t.test("[SEC-6] a user cannot mark another user's notifications read (and mark-all touches only the caller's)", async () => {
    const { mentor, mentee, conv } = await pair();
    await send(mentee, conv, "ping");
    const target = (await notes(mentor)).notifications[0];
    const menteeUnreadBefore = (await notes(mentee)).unreadCount;
    const steal = await api(mentee, "POST", `/api/v1/notifications/${target.id}/read`);
    assert.equal(steal.status, 404);
    assert.equal((await pool.query("SELECT read_at FROM notifications WHERE notification_id=$1::bigint", [target.id])).rows[0].read_at, null, "still unread");
    await api(mentee, "POST", "/api/v1/notifications/read-all");
    assert.equal((await pool.query("SELECT read_at FROM notifications WHERE notification_id=$1::bigint", [target.id])).rows[0].read_at, null, "mark-all by another person did not touch it");
    assert.ok(menteeUnreadBefore >= 0);
    assert.ok(!(await notes(mentee)).notifications.some((n) => n.id === target.id), "and it is not listed for them");
    assert.equal((await api(mentor, "POST", `/api/v1/notifications/${target.id}/read`)).status, 200);
  });

  await t.test("opening a conversation clears its pending message notification", async () => {
    const { mentor, mentee, conv } = await pair();
    await send(mentee, conv, "one");
    const before = (await notes(mentor)).notifications.find((n) => n.type === "NEW_MESSAGE" && !n.read);
    assert.ok(before);
    await api(mentor, "POST", `/api/v1/conversations/${conv}/read`);
    assert.ok((await notes(mentor)).notifications.filter((n) => n.type === "NEW_MESSAGE").every((n) => n.read));
  });

  await t.test("a deleted-looking id, a huge body and malformed JSON are refused safely", async () => {
    const uid = uniq("ed-");
    await onboard(uid);
    assert.equal((await api(uid, "PUT", "/api/v1/profiles/me", undefined, { rawBody: "{nope" })).status, 400);
    assert.equal((await api(uid, "PUT", "/api/v1/profiles/me", { bio: "x".repeat(700000) })).status, 413);
    assert.equal((await api(uid, "POST", "/api/v1/mentorship/requests", [])).status, 400);
    assert.equal((await api(uid, "GET", "/api/v1/mentorship/requests/mreq_zzzz")).status, 404);
    assert.equal((await api(uid, "GET", "/api/v1/conversations/%27%20OR%201=1")).status, 404);
  });
});

test("rate limits on community routes (real Redis): messages, applications, requests", { skip }, async (t) => {
  await resetInfra();
  const R = await startReplica({ keys, highLimits: true, env: { ADMIN_UIDS: ADMIN, RATE_LIMIT_MESSAGE_SEND_USER: "3/60", RATE_LIMIT_MENTOR_APPLY_USER: "2/60", RATE_LIMIT_MENTOR_REQUEST_USER: "2/60", ANTHROPIC_API_KEY: undefined } });
  t.after(() => R.close());
  const api = (uid, method, path, body) => R.call(method, path, { token: tokenFor(keys, uid), body, headers: ipHeader() });
  const a = uniq("rl-"), b = uniq("rl-");
  await api(a, "PUT", "/api/v1/profiles/me", { displayName: "A", persona: "STUDENT", researchInterests: ["x"], completeOnboarding: true });
  await api(b, "PUT", "/api/v1/profiles/me", { displayName: "B", persona: "STUDENT", researchInterests: ["x"], completeOnboarding: true, allowDirectMessages: true });
  const conv = (await api(a, "POST", "/api/v1/conversations", { recipientUid: b })).json.conversation.conversationId;
  const codes = [];
  for (let i = 0; i < 5; i += 1) codes.push((await api(a, "POST", `/api/v1/conversations/${conv}/messages`, { body: `m${i}` })).status);
  assert.deepEqual(codes, [201, 201, 201, 429, 429]);
  assert.equal((await api(b, "POST", `/api/v1/conversations/${conv}/messages`, { body: "other user is unaffected" })).status, 201);
  const limited = await api(a, "POST", `/api/v1/conversations/${conv}/messages`, { body: "x" });
  assert.equal(limited.json.error, "RATE_LIMITED");
  const apps = [];
  for (let i = 0; i < 3; i += 1) apps.push((await api(a, "POST", "/api/v1/mentor-applications", { ...APPLICATION })).status);
  assert.equal(apps[2], 429, `third application attempt within the window is limited: ${apps}`);
});
