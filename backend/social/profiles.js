"use strict";
/**
 * User profiles. Firebase authenticates the person; this table is shoRDs's own record of who they are on the platform.
 *
 * Security properties (each tested):
 *  - Only the profile owner can write it, and only through `upsertMe`, which uses an allow-list of fields. `verified_mentor` is not
 *    among them; it is written only by the administrator approval transaction in mentors.js. A request that names a privileged
 *    field (verifiedMentor, isAdmin, role, ...) is refused with FIELD_NOT_ALLOWED rather than ignored.
 *  - The e-mail address is returned only to its owner. Public views (other people, the mentor directory) never contain it.
 *  - A profile is visible to other people only once its owner has completed onboarding.
 */

const v = require("./validation");
const { SocialError, notFound, forbidden } = require("./errors");

const PERSONAS = ["STUDENT", "MENTOR", "RESEARCHER", "PROFESSOR", "ENTHUSIAST"];
const ACADEMIC_LEVELS = ["SCHOOL", "UNDERGRADUATE", "POSTGRADUATE", "DOCTORAL", "POSTDOCTORAL", "FACULTY", "INDUSTRY", "OTHER"];
const AVAILABILITY = ["AVAILABLE", "LIMITED", "UNAVAILABLE"];
const MENTORSHIP_PREFERENCES = ["SEEKING_MENTOR", "OFFERING_MENTORING", "BOTH", "NONE"];

const EDITABLE = [
  "displayName", "photoUrl", "persona", "headline", "bio", "institution", "department", "academicLevel",
  "researchInterests", "researchDomains", "skills", "expertise",
  "orcid", "linkedin", "github", "website", "publications",
  "availability", "mentorshipPreference", "allowDirectMessages", "mentorCapacity", "completeOnboarding"
];

/**
 * Validate a profile edit. Returns only the fields that were sent (already clean). Throws SocialError(400) on the first problem.
 * `has(k)` is "was this key sent?", so an explicit null clears an optional field while an absent key leaves it alone.
 */
function validateProfileInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SocialError("INVALID_BODY", "Send a JSON object.", 400);
  v.onlyKeys(body, EDITABLE, "profile update");
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const c = {};
  if (has("displayName")) c.displayName = v.text(body.displayName, "displayName", { min: 1, max: 80, required: true });
  if (has("photoUrl")) c.photoUrl = v.url(body.photoUrl, "photoUrl", { max: 500 });
  if (has("persona")) c.persona = v.oneOf(body.persona, "persona", PERSONAS, { required: true });
  if (has("headline")) c.headline = v.text(body.headline, "headline", { max: 140 });
  if (has("bio")) c.bio = v.text(body.bio, "bio", { max: 1500, multiline: true });
  if (has("institution")) c.institution = v.text(body.institution, "institution", { max: 120 });
  if (has("department")) c.department = v.text(body.department, "department", { max: 120 });
  if (has("academicLevel")) c.academicLevel = v.oneOf(body.academicLevel, "academicLevel", ACADEMIC_LEVELS);
  if (has("researchInterests")) c.researchInterests = v.list(body.researchInterests, "researchInterests", { maxItems: 15, maxLen: 60 });
  if (has("researchDomains")) c.researchDomains = v.list(body.researchDomains, "researchDomains", { maxItems: 10, maxLen: 60 });
  if (has("skills")) c.skills = v.list(body.skills, "skills", { maxItems: 20, maxLen: 40 });
  if (has("expertise")) c.expertise = v.list(body.expertise, "expertise", { maxItems: 15, maxLen: 60 });
  if (has("orcid")) c.orcid = v.orcid(body.orcid);
  if (has("linkedin")) c.linkedin = v.url(body.linkedin, "linkedin", { host: "linkedin.com" });
  if (has("github")) c.github = v.url(body.github, "github", { host: "github.com" });
  if (has("website")) c.website = v.url(body.website, "website");
  if (has("publications")) c.publications = v.urlList(body.publications, "publications", { maxItems: 6 });
  if (has("availability")) c.availability = v.oneOf(body.availability, "availability", AVAILABILITY, { required: true });
  if (has("mentorshipPreference")) c.mentorshipPreference = v.oneOf(body.mentorshipPreference, "mentorshipPreference", MENTORSHIP_PREFERENCES, { required: true });
  if (has("allowDirectMessages")) c.allowDirectMessages = v.boolean(body.allowDirectMessages, "allowDirectMessages");
  if (has("mentorCapacity")) c.mentorCapacity = v.integer(body.mentorCapacity, "mentorCapacity", { min: 0, max: 50, required: true });
  if (has("completeOnboarding")) c.completeOnboarding = v.boolean(body.completeOnboarding, "completeOnboarding");
  return c;
}

const searchText = (p) =>
  [p.display_name, p.headline, p.bio, p.institution, p.department, ...p.research_interests, ...p.research_domains, ...p.skills, ...p.expertise]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .slice(0, 4000);

/** What is still missing before onboarding can be marked complete. */
function missingForOnboarding(p) {
  const missing = [];
  if (!p.display_name) missing.push("displayName");
  if (!p.persona) missing.push("persona");
  if (p.research_interests.length + p.research_domains.length === 0) missing.push("researchInterests");
  return missing;
}

const linkView = (links) => ({
  orcid: links.orcid || null,
  linkedin: links.linkedin || null,
  github: links.github || null,
  website: links.website || null,
  publications: Array.isArray(links.publications) ? links.publications : []
});

/** What anyone signed in may see about an onboarded person. No e-mail, no internal flags. */
function publicView(r, extra = {}) {
  return {
    uid: r.uid,
    displayName: r.display_name,
    photoUrl: r.photo_url,
    persona: r.persona,
    headline: r.headline,
    bio: r.bio,
    institution: r.institution,
    department: r.department,
    academicLevel: r.academic_level,
    researchInterests: r.research_interests,
    researchDomains: r.research_domains,
    skills: r.skills,
    expertise: r.expertise,
    links: linkView(r.links || {}),
    availability: r.availability,
    mentorshipPreference: r.mentorship_preference,
    verifiedMentor: r.verified_mentor === true,
    ...extra
  };
}

/** The owner's own view: the public fields plus e-mail and settings. */
function privateView(r, { isAdmin = false } = {}) {
  return {
    ...publicView(r),
    email: r.email,
    allowDirectMessages: r.allow_direct_messages === true,
    mentorCapacity: r.mentor_capacity,
    onboardingCompleted: r.onboarding_completed_at !== null,
    onboardingCompletedAt: r.onboarding_completed_at,
    isAdmin,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

async function getRow(db, uid) {
  const r = await db.query("SELECT * FROM user_profiles WHERE uid=$1", [uid]);
  return r.rows[0] || null;
}

/** GET /profile/me. A person with no profile row yet gets `profile: null` and `onboardingRequired: true` (not an error). */
async function getMe(pool, principal, { isAdmin = false } = {}) {
  const row = await getRow(pool, principal.uid);
  if (!row) return { profile: null, onboardingRequired: true, isAdmin };
  return { profile: privateView(row, { isAdmin }), onboardingRequired: row.onboarding_completed_at === null, isAdmin };
}

const COLS = "uid, display_name, photo_url, email, persona, headline, bio, institution, department, academic_level, research_interests, research_domains, skills, expertise, links, availability, mentorship_preference, allow_direct_messages, mentor_capacity, onboarding_completed_at, search_text";

/**
 * PUT /profile/me: create or update the caller's own profile (partial: only the fields sent change).
 * The caller's uid comes from the verified token, never from the request.
 */
async function upsertMe(pool, principal, body, { isAdmin = false } = {}) {
  const changes = validateProfileInput(body);
  let created = false;
  const row = await pool.transaction(async (c) => {
    const existing = (await c.query("SELECT * FROM user_profiles WHERE uid=$1 FOR UPDATE", [principal.uid])).rows[0] || null;
    created = !existing;
    if (!existing) {
      if (changes.displayName === undefined) throw new SocialError("INVALID_DISPLAY_NAME", "`displayName` is required to create your profile.", 400);
      if (changes.persona === undefined) throw new SocialError("INVALID_PERSONA", "`persona` is required to create your profile.", 400);
    }
    if (changes.mentorCapacity !== undefined && !(existing && existing.verified_mentor)) {
      throw forbidden("Only a verified mentor can set a mentoring capacity.", "NOT_VERIFIED_MENTOR");
    }
    const links = { ...((existing && existing.links) || {}) };
    for (const k of ["orcid", "linkedin", "github", "website"]) if (changes[k] !== undefined) (changes[k] === null ? delete links[k] : (links[k] = changes[k]));
    if (changes.publications !== undefined) links.publications = changes.publications;

    const p = {
      uid: principal.uid,
      display_name: changes.displayName !== undefined ? changes.displayName : existing.display_name,
      photo_url: changes.photoUrl !== undefined ? changes.photoUrl : existing ? existing.photo_url : null,
      email: principal.email || (existing ? existing.email : null),
      persona: changes.persona !== undefined ? changes.persona : existing.persona,
      headline: changes.headline !== undefined ? changes.headline : existing ? existing.headline : null,
      bio: changes.bio !== undefined ? changes.bio : existing ? existing.bio : null,
      institution: changes.institution !== undefined ? changes.institution : existing ? existing.institution : null,
      department: changes.department !== undefined ? changes.department : existing ? existing.department : null,
      academic_level: changes.academicLevel !== undefined ? changes.academicLevel : existing ? existing.academic_level : null,
      research_interests: changes.researchInterests !== undefined ? changes.researchInterests : existing ? existing.research_interests : [],
      research_domains: changes.researchDomains !== undefined ? changes.researchDomains : existing ? existing.research_domains : [],
      skills: changes.skills !== undefined ? changes.skills : existing ? existing.skills : [],
      expertise: changes.expertise !== undefined ? changes.expertise : existing ? existing.expertise : [],
      links,
      availability: changes.availability !== undefined ? changes.availability : existing ? existing.availability : "UNAVAILABLE",
      mentorship_preference: changes.mentorshipPreference !== undefined ? changes.mentorshipPreference : existing ? existing.mentorship_preference : "NONE",
      allow_direct_messages: changes.allowDirectMessages !== undefined && changes.allowDirectMessages !== null ? changes.allowDirectMessages : existing ? existing.allow_direct_messages : false,
      mentor_capacity: changes.mentorCapacity !== undefined ? changes.mentorCapacity : existing ? existing.mentor_capacity : 0,
      onboarding_completed_at: existing ? existing.onboarding_completed_at : null
    };
    if (changes.completeOnboarding === true && p.onboarding_completed_at === null) {
      const missing = missingForOnboarding(p);
      if (missing.length) throw new SocialError("ONBOARDING_INCOMPLETE", `Add ${missing.join(", ")} to finish setting up your profile.`, 422, { missing });
      p.onboarding_completed_at = new Date().toISOString();
    }
    p.search_text = searchText(p);

    const r = await c.query(
      `INSERT INTO user_profiles (${COLS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (uid) DO UPDATE SET
         display_name=EXCLUDED.display_name, photo_url=EXCLUDED.photo_url, email=EXCLUDED.email, persona=EXCLUDED.persona, headline=EXCLUDED.headline,
         bio=EXCLUDED.bio, institution=EXCLUDED.institution, department=EXCLUDED.department, academic_level=EXCLUDED.academic_level,
         research_interests=EXCLUDED.research_interests, research_domains=EXCLUDED.research_domains, skills=EXCLUDED.skills, expertise=EXCLUDED.expertise,
         links=EXCLUDED.links, availability=EXCLUDED.availability, mentorship_preference=EXCLUDED.mentorship_preference,
         allow_direct_messages=EXCLUDED.allow_direct_messages, mentor_capacity=EXCLUDED.mentor_capacity,
         onboarding_completed_at=COALESCE(user_profiles.onboarding_completed_at, EXCLUDED.onboarding_completed_at),
         search_text=EXCLUDED.search_text, updated_at=now()
       RETURNING *`,
      [p.uid, p.display_name, p.photo_url, p.email, p.persona, p.headline, p.bio, p.institution, p.department, p.academic_level,
        JSON.stringify(p.research_interests), JSON.stringify(p.research_domains), JSON.stringify(p.skills), JSON.stringify(p.expertise), JSON.stringify(p.links),
        p.availability, p.mentorship_preference, p.allow_direct_messages, p.mentor_capacity, p.onboarding_completed_at, p.search_text]
    );
    return r.rows[0];
  });
  return { profile: privateView(row, { isAdmin }), created };
}

/** GET /profiles/:uid. Another person's profile exists for the caller only when that person has finished onboarding. */
async function getPublic(pool, viewerUid, targetUid) {
  const row = await getRow(pool, targetUid);
  if (!row || (row.onboarding_completed_at === null && row.uid !== viewerUid)) throw notFound("profile");
  return { profile: row.uid === viewerUid ? privateView(row) : publicView(row) };
}

module.exports = { PERSONAS, ACADEMIC_LEVELS, AVAILABILITY, MENTORSHIP_PREFERENCES, EDITABLE, validateProfileInput, publicView, privateView, getRow, getMe, upsertMe, getPublic, missingForOnboarding, searchText };
