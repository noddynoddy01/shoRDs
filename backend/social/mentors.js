"use strict";
/**
 * Mentors: applications, administrator review, and the verified-mentor directory.
 *
 * Four separate concepts (never conflated):
 *   persona                -> what the person says they are (profile.persona; self-chosen label, grants nothing)
 *   application status     -> NOT_APPLIED | PENDING | APPROVED | REJECTED | REVOKED   (mentor_applications)
 *   verified mentor        -> user_profiles.verified_mentor, written ONLY by reviewApplication(APPROVE) below
 *   platform administrator -> ADMIN_UIDS (environment), checked by the route layer AND again here
 * Project membership roles (VIEWER..OWNER) are a fifth, unrelated thing and are not touched.
 */

const v = require("./validation");
const { SocialError, notFound, forbidden, conflict } = require("./errors");
const { newId, isId } = require("./ids");
const notifications = require("./notifications");
const { publicView } = require("./profiles");

const APP_AVAILABILITY = ["AVAILABLE", "LIMITED"];
const APPLICATION_KEYS = ["institution", "designation", "professionalBio", "background", "expertise", "mentoringAreas", "experience", "portfolioLinks", "orcid", "googleScholar", "verificationNote", "availability", "capacity"];

function validateApplication(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SocialError("INVALID_BODY", "Send a JSON object.", 400);
  v.onlyKeys(body, APPLICATION_KEYS, "mentor application");
  const expertise = v.list(body.expertise, "expertise", { maxItems: 15, maxLen: 60 });
  const mentoringAreas = v.list(body.mentoringAreas, "mentoringAreas", { maxItems: 10, maxLen: 60 });
  if (expertise.length === 0) throw new SocialError("INVALID_EXPERTISE", "List at least one area of expertise.", 400);
  if (mentoringAreas.length === 0) throw new SocialError("INVALID_MENTORING_AREAS", "List at least one area where you can mentor.", 400);
  return {
    institution: v.text(body.institution, "institution", { min: 1, max: 120, required: true }),
    designation: v.text(body.designation, "designation", { min: 1, max: 120, required: true }),
    professionalBio: v.text(body.professionalBio, "professionalBio", { min: 20, max: 2000, required: true, multiline: true }),
    orcid: v.orcid(body.orcid),
    googleScholar: v.url(body.googleScholar, "googleScholar", { host: "scholar.google.com" }),
    verificationNote: v.text(body.verificationNote, "verificationNote", { max: 500, multiline: true }),
    background: v.text(body.background, "background", { min: 20, max: 2000, required: true, multiline: true }),
    expertise,
    mentoringAreas,
    experience: v.text(body.experience, "experience", { min: 20, max: 2000, required: true, multiline: true }),
    portfolioLinks: v.urlList(body.portfolioLinks, "portfolioLinks", { maxItems: 6 }),
    availability: v.oneOf(body.availability, "availability", APP_AVAILABILITY, { required: true }),
    capacity: v.integer(body.capacity, "capacity", { min: 1, max: 50, required: true })
  };
}

const applicationView = (r) => ({
  applicationId: r.application_id,
  status: r.status,
  institution: r.institution || null,
  designation: r.designation || null,
  professionalBio: r.professional_bio || null,
  orcid: r.orcid || null,
  googleScholar: r.google_scholar_url || null,
  verificationNote: r.verification_note || null,
  background: r.background,
  expertise: r.expertise,
  mentoringAreas: r.mentoring_areas,
  experience: r.experience,
  portfolioLinks: r.portfolio_links,
  availability: r.availability,
  capacity: r.capacity,
  reviewNote: r.review_note,
  reviewedAt: r.reviewed_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at
});

const isUniqueViolation = (e) => e && e.sqlState === "23505";

/** POST /mentors/applications. `adminUids`: who is told that a new application is waiting. */
async function submitApplication(pool, uid, body, { adminUids = [] } = {}) {
  const a = validateApplication(body);
  try {
    return await pool.transaction(async (c) => {
      const p = (await c.query("SELECT uid, display_name, verified_mentor, onboarding_completed_at FROM user_profiles WHERE uid=$1 FOR UPDATE", [uid])).rows[0];
      if (!p || p.onboarding_completed_at === null) throw conflict("PROFILE_REQUIRED", "Finish your profile before applying to become a mentor.");
      if (p.verified_mentor) throw conflict("ALREADY_MENTOR", "You are already a verified mentor.");
      const id = newId("application");
      const r = await c.query(
        `INSERT INTO mentor_applications (application_id, uid, status, background, expertise, mentoring_areas, experience, portfolio_links, availability, capacity,
                                          institution, designation, professional_bio, orcid, google_scholar_url, verification_note)
         VALUES ($1,$2,'PENDING',$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [id, uid, a.background, JSON.stringify(a.expertise), JSON.stringify(a.mentoringAreas), a.experience, JSON.stringify(a.portfolioLinks), a.availability, a.capacity,
         a.institution, a.designation, a.professionalBio, a.orcid, a.googleScholar, a.verificationNote]
      );
      for (const admin of adminUids) {
        await notifications.create(c, { uid: admin, type: "MENTOR_APPLICATION_RECEIVED", title: "New mentor application", body: `${p.display_name} applied to become a mentor.`, data: { applicationId: id } });
      }
      return { application: applicationView(r.rows[0]) };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("APPLICATION_PENDING", "You already have an application waiting for review.");
    throw e;
  }
}

/** GET /mentors/applications/me */
async function getMyApplication(pool, uid) {
  const p = (await pool.query("SELECT verified_mentor FROM user_profiles WHERE uid=$1", [uid])).rows[0];
  const r = (await pool.query("SELECT * FROM mentor_applications WHERE uid=$1 ORDER BY created_at DESC, application_id DESC LIMIT 1", [uid])).rows[0];
  return { status: r ? r.status : "NOT_APPLIED", verifiedMentor: Boolean(p && p.verified_mentor), application: r ? applicationView(r) : null };
}

function assertAdmin(isAdmin) {
  if (isAdmin !== true) throw forbidden("Administrator access required.");
}

/** GET /admin/mentor-applications (administrators only). No e-mail addresses: the reviewer sees the application, not contact details. */
async function listApplications(pool, { isAdmin, adminUid = null, status = "PENDING", limit, offset } = {}) {
  assertAdmin(isAdmin);
  const st = v.oneOf(status, "status", ["PENDING", "APPROVED", "REJECTED", "REVOKED"], { required: true });
  const lim = v.intParam(limit, { def: 20, min: 1, max: 50 });
  const off = v.intParam(offset, { def: 0, min: 0, max: 5000 });
  const r = await pool.query(
    `SELECT a.*, p.display_name, p.persona, p.institution AS profile_institution, p.headline FROM mentor_applications a JOIN user_profiles p ON p.uid = a.uid
      WHERE a.status=$1 ORDER BY a.created_at, a.application_id LIMIT $2::int OFFSET $3::int`,
    [st, lim + 1, off]
  );
  const total = (await pool.query("SELECT count(*)::int AS n FROM mentor_applications WHERE status=$1", [st])).rows[0].n;
  return {
    applications: r.rows.slice(0, lim).map((x) => ({ ...applicationView(x), applicant: { uid: x.uid, displayName: x.display_name, persona: x.persona, institution: x.profile_institution, headline: x.headline }, ownApplication: adminUid !== null && x.uid === adminUid })),
    total, limit: lim, offset: off, hasMore: r.rows.length > lim
  };
}

/** PUT /admin/mentor-applications/:id  { decision: "APPROVE" | "REJECT", note? } */
async function reviewApplication(pool, { isAdmin, adminUid, applicationId, body }) {
  assertAdmin(isAdmin);
  if (!isId("application", applicationId)) throw notFound("application");
  if (!body || typeof body !== "object") throw new SocialError("INVALID_BODY", "Send a JSON object.", 400);
  v.onlyKeys(body, ["decision", "note"], "review");
  const decision = v.oneOf(body.decision, "decision", ["APPROVE", "REJECT"], { required: true });
  const note = v.text(body.note, "note", { max: 500, multiline: true });
  // A rejection must say why: the applicant sees this text and may reapply, so a bare "no" is not allowed.
  if (decision === "REJECT" && (!note || note.length < 5)) throw new SocialError("REASON_REQUIRED", "Give the applicant a reason for the rejection (at least 5 characters).", 400);
  return pool.transaction(async (c) => {
    const a = (await c.query("SELECT * FROM mentor_applications WHERE application_id=$1 FOR UPDATE", [applicationId])).rows[0];
    if (!a) throw notFound("application");
    // Separation of duties: nobody, administrators included, decides their own application. Checked on the stored owner of the row,
    // never on anything the client sends, and before any state is read or written.
    if (a.uid === adminUid) throw new SocialError("SELF_REVIEW_FORBIDDEN", "You cannot review your own mentor application. Another administrator must decide it.", 403);
    if (a.status !== "PENDING") throw conflict("STATE_CONFLICT", `This application was already ${a.status.toLowerCase()}.`);
    if (decision === "APPROVE") {
      const p = (await c.query("SELECT * FROM user_profiles WHERE uid=$1 FOR UPDATE", [a.uid])).rows[0];
      if (!p || p.onboarding_completed_at === null) throw conflict("PROFILE_REQUIRED", "The applicant no longer has a completed profile.");
      const pref = p.mentorship_preference === "SEEKING_MENTOR" || p.mentorship_preference === "BOTH" ? "BOTH" : "OFFERING_MENTORING";
      const expertise = p.expertise.length ? p.expertise : a.expertise;
      await c.query(
        "UPDATE user_profiles SET verified_mentor=TRUE, mentor_capacity=$2, availability=$3, mentorship_preference=$4, expertise=$5::jsonb, updated_at=now() WHERE uid=$1",
        [a.uid, a.capacity, a.availability, pref, JSON.stringify(expertise)]
      );
    }
    const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    const r = await c.query("UPDATE mentor_applications SET status=$2, reviewer_uid=$3, review_note=$4, reviewed_at=now(), updated_at=now() WHERE application_id=$1 RETURNING *", [applicationId, status, adminUid, note]);
    await notifications.create(c, {
      uid: a.uid,
      type: status === "APPROVED" ? "MENTOR_APPLICATION_APPROVED" : "MENTOR_APPLICATION_REJECTED",
      title: status === "APPROVED" ? "You are now a verified mentor" : "Your mentor application was not approved",
      body: status === "APPROVED" ? "Students can now find you in the mentor directory." : note ? `Reviewer note: ${note}`.slice(0, 400) : "You can apply again after updating your application.",
      data: { applicationId }
    });
    return { application: applicationView(r.rows[0]) };
  });
}

/** POST /admin/mentors/:uid/revoke  { note? }: take verification away. Live mentorships continue until their participants close them. */
async function revokeMentor(pool, { isAdmin, adminUid, targetUid, body }) {
  assertAdmin(isAdmin);
  v.onlyKeys(body || {}, ["note"], "revocation");
  const note = v.text((body || {}).note, "note", { max: 500, multiline: true });
  if (!note || note.length < 5) throw new SocialError("REASON_REQUIRED", "Give the mentor a reason for removing verification (at least 5 characters).", 400);
  if (targetUid === adminUid) throw new SocialError("SELF_REVIEW_FORBIDDEN", "You cannot remove your own mentor verification. Another administrator must do it.", 403);
  return pool.transaction(async (c) => {
    const p = (await c.query("SELECT uid, verified_mentor FROM user_profiles WHERE uid=$1 FOR UPDATE", [targetUid])).rows[0];
    if (!p) throw notFound("profile");
    if (!p.verified_mentor) throw conflict("STATE_CONFLICT", "That person is not a verified mentor.");
    await c.query("UPDATE user_profiles SET verified_mentor=FALSE, availability='UNAVAILABLE', mentor_capacity=0, updated_at=now() WHERE uid=$1", [targetUid]);
    await c.query("UPDATE mentor_applications SET status='REVOKED', reviewer_uid=$2, review_note=$3, reviewed_at=now(), updated_at=now() WHERE uid=$1 AND status='APPROVED'", [targetUid, adminUid, note]);
    await notifications.create(c, { uid: targetUid, type: "MENTOR_STATUS_REVOKED", title: "Your mentor verification was removed", body: note ? `Reviewer note: ${note}`.slice(0, 400) : "You can apply again.", data: {} });
    return { uid: targetUid, verifiedMentor: false };
  });
}

// ------------------------------------------------------------------------------------------------ discovery
const SORTS = {
  recent: "p.updated_at DESC, p.uid",
  name: "lower(p.display_name), p.uid",
  availability: "CASE p.availability WHEN 'AVAILABLE' THEN 0 WHEN 'LIMITED' THEN 1 ELSE 2 END, p.updated_at DESC, p.uid"
};
const OPEN_SLOTS = "GREATEST(0, p.mentor_capacity - (SELECT count(*) FROM mentorship_relationships r WHERE r.mentor_uid = p.uid AND r.status = 'ACTIVE'))::int";

/**
 * GET /mentors. Only verified, onboarded mentors, and never the caller. Public fields only (no e-mail). All filters are AND-ed;
 * every value reaches SQL as a bound parameter, and LIKE wildcards in a search term are escaped.
 */
async function searchMentors(pool, viewerUid, query = {}) {
  const where = ["p.verified_mentor", "p.onboarding_completed_at IS NOT NULL", "p.uid <> $1"];
  const params = [viewerUid];
  const add = (value) => { params.push(value); return `$${params.length}`; };
  const q = v.text(query.q, "q", { max: 100 });
  if (q) for (const word of q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)) where.push(`p.search_text LIKE ${add("%" + v.likeEscape(word) + "%")} ESCAPE '\\'`);
  const domain = v.text(query.domain, "domain", { max: 60 });
  if (domain) where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.research_domains) d WHERE lower(d) = lower(${add(domain)}))`);
  const expertise = v.text(query.expertise, "expertise", { max: 60 });
  if (expertise) where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.expertise) d WHERE lower(d) = lower(${add(expertise)}))`);
  const skill = v.text(query.skill, "skill", { max: 40 });
  if (skill) where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.skills) d WHERE lower(d) = lower(${add(skill)}))`);
  const institution = v.text(query.institution, "institution", { max: 120 });
  if (institution) where.push(`lower(coalesce(p.institution,'')) LIKE ${add("%" + v.likeEscape(institution.toLowerCase()) + "%")} ESCAPE '\\'`);
  const level = v.oneOf(query.level, "level", require("./profiles").ACADEMIC_LEVELS);
  if (level) where.push(`p.academic_level = ${add(level)}`);
  const availability = v.oneOf(query.availability, "availability", ["AVAILABLE", "LIMITED"]);
  if (availability) where.push(`p.availability = ${add(availability)}`);
  const sort = query.sort === undefined || query.sort === "" ? "recent" : query.sort;
  if (!Object.prototype.hasOwnProperty.call(SORTS, sort)) throw new SocialError("INVALID_SORT", `\`sort\` must be one of ${Object.keys(SORTS).join(", ")}.`, 400);
  const limit = v.intParam(query.limit, { def: 12, min: 1, max: 50 });
  const offset = v.intParam(query.offset, { def: 0, min: 0, max: 5000 });

  const whereSql = where.join(" AND ");
  const rows = await pool.query(`SELECT p.*, ${OPEN_SLOTS} AS open_slots FROM user_profiles p WHERE ${whereSql} ORDER BY ${SORTS[sort]} LIMIT ${add(limit + 1)}::int OFFSET ${add(offset)}::int`, params);
  const total = (await pool.query(`SELECT count(*)::int AS n FROM user_profiles p WHERE ${whereSql}`, params.slice(0, params.length - 2))).rows[0].n;
  return { mentors: rows.rows.slice(0, limit).map((r) => publicView(r, { openSlots: r.open_slots })), total, limit, offset, hasMore: rows.rows.length > limit, sort };
}

/** GET /mentors/:uid: a verified, onboarded mentor only. */
async function getMentor(pool, viewerUid, uid) {
  const r = (await pool.query(`SELECT p.*, ${OPEN_SLOTS} AS open_slots FROM user_profiles p WHERE p.uid=$1 AND p.verified_mentor AND p.onboarding_completed_at IS NOT NULL`, [uid])).rows[0];
  if (!r) throw notFound("mentor");
  return { mentor: publicView(r, { openSlots: r.open_slots }) };
}

module.exports = { validateApplication, submitApplication, getMyApplication, listApplications, reviewApplication, revokeMentor, searchMentors, getMentor, SORTS };
