"use strict";
/**
 * Mentorship requests and relationships. Every state change is a transaction that locks the request row (FOR UPDATE), so two people
 * acting at once cannot both win; the legal moves are the pure table in `nextRequestStatus` (unit-tested), and the database repeats the
 * important invariants (one live request per pair, one active relationship per pair, no self-mentoring) as constraints.
 *
 *   PENDING --ACCEPT (mentor)--> ACCEPTED --COMPLETE (either party, via the relationship)--> COMPLETED
 *   PENDING --REJECT (mentor)--> REJECTED
 *   PENDING --CANCEL (mentee)--> CANCELLED
 * Accepting creates the relationship AND the private conversation between the two people, in the same transaction.
 *
 * Someone who is not a party to a request or relationship gets 404 for it (not 403), so identifiers cannot be probed.
 */

const v = require("./validation");
const { SocialError, notFound, forbidden, conflict } = require("./errors");
const { newId, isId } = require("./ids");
const notifications = require("./notifications");

const REQUEST_KEYS = ["mentorUid", "domain", "interests", "guidanceNeeded"];
const RESPONSE_KEYS = ["action", "note"];
const REQUEST_STATUSES = ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED", "COMPLETED"];

const TRANSITIONS = {
  PENDING: { ACCEPT: { by: "MENTOR", to: "ACCEPTED" }, REJECT: { by: "MENTOR", to: "REJECTED" }, CANCEL: { by: "MENTEE", to: "CANCELLED" } },
  ACCEPTED: { COMPLETE: { by: "EITHER", to: "COMPLETED" } }
};

/** The only place that says which moves are legal. `role` is the actor's role in THIS request: "MENTOR" or "MENTEE". */
function nextRequestStatus(current, action, role) {
  const t = TRANSITIONS[current] && TRANSITIONS[current][action];
  if (!t) return { ok: false, reason: "STATE" };
  if (t.by !== "EITHER" && t.by !== role) return { ok: false, reason: "ACTOR" };
  return { ok: true, to: t.to };
}

const person = (prefix, r) => ({ uid: r[`${prefix}_uid`], displayName: r[`${prefix}_name`], photoUrl: r[`${prefix}_photo`], headline: r[`${prefix}_headline`], institution: r[`${prefix}_institution`] });

const REQUEST_SELECT = `
  SELECT r.*, m.display_name AS mentor_name, m.photo_url AS mentor_photo, m.headline AS mentor_headline, m.institution AS mentor_institution,
         e.display_name AS mentee_name, e.photo_url AS mentee_photo, e.headline AS mentee_headline, e.institution AS mentee_institution
    FROM mentorship_requests r
    JOIN user_profiles m ON m.uid = r.mentor_uid
    JOIN user_profiles e ON e.uid = r.mentee_uid`;

function requestView(r, viewerUid) {
  return {
    requestId: r.request_id,
    status: r.status,
    role: viewerUid === r.mentor_uid ? "MENTOR" : "MENTEE",
    mentor: person("mentor", r),
    mentee: person("mentee", r),
    domain: r.domain,
    interests: r.interests,
    guidanceNeeded: r.guidance_needed,
    responseNote: r.response_note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    respondedAt: r.responded_at
  };
}

async function isBlockedEitherWay(db, a, b) {
  const r = await db.query("SELECT 1 FROM user_blocks WHERE (blocker_uid=$1 AND blocked_uid=$2) OR (blocker_uid=$2 AND blocked_uid=$1) LIMIT 1", [a, b]);
  return r.rows.length > 0;
}

/** POST /mentorship/requests */
async function createRequest(pool, menteeUid, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SocialError("INVALID_BODY", "Send a JSON object.", 400);
  v.onlyKeys(body, REQUEST_KEYS, "mentorship request");
  const mentorUid = typeof body.mentorUid === "string" && require("./ids").UID_RE.test(body.mentorUid) ? body.mentorUid : null;
  if (!mentorUid) throw new SocialError("INVALID_MENTOR_UID", "`mentorUid` is required.", 400);
  const input = {
    domain: v.text(body.domain, "domain", { min: 1, max: 80, required: true }),
    interests: v.text(body.interests, "interests", { min: 10, max: 1000, required: true, multiline: true }),
    guidanceNeeded: v.text(body.guidanceNeeded, "guidanceNeeded", { min: 10, max: 1000, required: true, multiline: true })
  };
  if (mentorUid === menteeUid) throw new SocialError("INVALID_MENTOR_UID", "You cannot ask yourself to mentor you.", 400);
  try {
    return await pool.transaction(async (c) => {
      const mentee = (await c.query("SELECT uid, display_name, onboarding_completed_at FROM user_profiles WHERE uid=$1", [menteeUid])).rows[0];
      if (!mentee || mentee.onboarding_completed_at === null) throw conflict("PROFILE_REQUIRED", "Finish your profile before asking a mentor for guidance.");
      const mentor = (await c.query("SELECT uid, verified_mentor, availability, onboarding_completed_at FROM user_profiles WHERE uid=$1 FOR SHARE", [mentorUid])).rows[0];
      if (!mentor || !mentor.verified_mentor || mentor.onboarding_completed_at === null) throw notFound("mentor"); // an unverified person is not a mentor, and is not revealed as a user
      if (mentor.availability === "UNAVAILABLE") throw conflict("MENTOR_UNAVAILABLE", "This mentor is not taking new requests right now.");
      if (await isBlockedEitherWay(c, menteeUid, mentorUid)) throw conflict("BLOCKED", "You cannot send this request.");
      const id = newId("request");
      await c.query(
        "INSERT INTO mentorship_requests (request_id, mentee_uid, mentor_uid, domain, interests, guidance_needed) VALUES ($1,$2,$3,$4,$5,$6)",
        [id, menteeUid, mentorUid, input.domain, input.interests, input.guidanceNeeded]
      );
      await notifications.create(c, { uid: mentorUid, type: "MENTORSHIP_REQUEST_RECEIVED", title: "New mentorship request", body: `${mentee.display_name} asked you for guidance in ${input.domain}.`, data: { requestId: id } });
      const row = (await c.query(`${REQUEST_SELECT} WHERE r.request_id=$1`, [id])).rows[0];
      return { request: requestView(row, menteeUid) };
    });
  } catch (e) {
    if (e && e.sqlState === "23505") throw conflict("DUPLICATE_REQUEST", "You already have a pending or active request with this mentor.");
    throw e;
  }
}

/** GET /mentorship/requests?box=incoming|outgoing&status=&limit=&offset= */
async function listRequests(pool, uid, query = {}) {
  const box = v.oneOf(query.box === undefined || query.box === "" ? "incoming" : query.box, "box", ["incoming", "outgoing"], { required: true });
  const status = v.oneOf(query.status, "status", REQUEST_STATUSES);
  const limit = v.intParam(query.limit, { def: 20, min: 1, max: 50 });
  const offset = v.intParam(query.offset, { def: 0, min: 0, max: 5000 });
  const col = box === "incoming" ? "r.mentor_uid" : "r.mentee_uid";
  const params = [uid];
  let statusSql = "";
  if (status) { params.push(status); statusSql = ` AND r.status = $${params.length}`; }
  const rows = await pool.query(`${REQUEST_SELECT} WHERE ${col} = $1${statusSql} ORDER BY r.created_at DESC, r.request_id DESC LIMIT ${limit + 1} OFFSET ${offset}`, params);
  const total = (await pool.query(`SELECT count(*)::int AS n FROM mentorship_requests r WHERE ${col} = $1${statusSql}`, params)).rows[0].n;
  return { requests: rows.rows.slice(0, limit).map((r) => requestView(r, uid)), total, limit, offset, hasMore: rows.rows.length > limit, box };
}

/** GET /mentorship/requests/:id (a party to it only) */
async function getRequest(pool, uid, requestId) {
  if (!isId("request", requestId)) throw notFound("request");
  const r = (await pool.query(`${REQUEST_SELECT} WHERE r.request_id=$1 AND (r.mentor_uid=$2 OR r.mentee_uid=$2)`, [requestId, uid])).rows[0];
  if (!r) throw notFound("request");
  return { request: requestView(r, uid) };
}

/** PUT /mentorship/requests/:id  { action: "ACCEPT" | "REJECT" | "CANCEL", note? } */
async function respondToRequest(pool, uid, requestId, body) {
  if (!isId("request", requestId)) throw notFound("request");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SocialError("INVALID_BODY", "Send a JSON object.", 400);
  v.onlyKeys(body, RESPONSE_KEYS, "mentorship response");
  const action = v.oneOf(body.action, "action", ["ACCEPT", "REJECT", "CANCEL"], { required: true });
  const note = v.text(body.note, "note", { max: 500, multiline: true });
  return pool.transaction(async (c) => {
    const r = (await c.query("SELECT * FROM mentorship_requests WHERE request_id=$1 FOR UPDATE", [requestId])).rows[0];
    if (!r || (r.mentor_uid !== uid && r.mentee_uid !== uid)) throw notFound("request");
    const role = r.mentor_uid === uid ? "MENTOR" : "MENTEE";
    const t = nextRequestStatus(r.status, action, role);
    if (!t.ok) {
      if (t.reason === "ACTOR") throw forbidden(role === "MENTOR" ? "Only the person who asked can cancel a request." : "Only the mentor can accept or decline a request.");
      throw conflict("STATE_CONFLICT", `This request is ${r.status.toLowerCase()}, so it cannot be ${action === "ACCEPT" ? "accepted" : action === "REJECT" ? "declined" : "cancelled"}.`);
    }
    const names = (await c.query("SELECT uid, display_name FROM user_profiles WHERE uid IN ($1, $2)", [r.mentor_uid, r.mentee_uid])).rows;
    const nameOf = (id) => (names.find((n) => n.uid === id) || {}).display_name || "Someone";

    let relationshipId = null;
    let conversationId = null;
    if (action === "ACCEPT") {
      // Lock the mentor's profile row: two simultaneous accepts must not both pass the capacity check.
      const mentor = (await c.query("SELECT verified_mentor, mentor_capacity FROM user_profiles WHERE uid=$1 FOR UPDATE", [r.mentor_uid])).rows[0];
      if (!mentor || !mentor.verified_mentor) throw conflict("MENTOR_NOT_VERIFIED", "Your mentor verification is no longer active.");
      const active = (await c.query("SELECT count(*)::int AS n FROM mentorship_relationships WHERE mentor_uid=$1 AND status='ACTIVE'", [r.mentor_uid])).rows[0].n;
      if (active >= mentor.mentor_capacity) throw conflict("CAPACITY_REACHED", "You have reached your mentoring capacity. Complete a mentorship or raise your capacity first.");
      if (await isBlockedEitherWay(c, r.mentor_uid, r.mentee_uid)) throw conflict("BLOCKED", "This request can no longer be accepted.");
      relationshipId = newId("relationship");
      conversationId = newId("conversation");
      await c.query("INSERT INTO mentorship_relationships (relationship_id, request_id, mentor_uid, mentee_uid) VALUES ($1,$2,$3,$4)", [relationshipId, requestId, r.mentor_uid, r.mentee_uid]);
      await c.query("INSERT INTO conversations (conversation_id, kind, relationship_id, created_by) VALUES ($1,'MENTORSHIP',$2,$3)", [conversationId, relationshipId, r.mentor_uid]);
      await c.query("INSERT INTO conversation_participants (conversation_id, uid) VALUES ($1,$2), ($1,$3)", [conversationId, r.mentor_uid, r.mentee_uid]);
    }
    await c.query("UPDATE mentorship_requests SET status=$2, response_note=$3, responded_at=now(), updated_at=now() WHERE request_id=$1", [requestId, t.to, action === "CANCEL" ? null : note]);

    if (action === "ACCEPT") {
      await notifications.create(c, { uid: r.mentee_uid, type: "MENTORSHIP_REQUEST_ACCEPTED", title: "Your mentorship request was accepted", body: `${nameOf(r.mentor_uid)} accepted. You can message them now.`, data: { requestId, relationshipId, conversationId } });
      await notifications.create(c, { uid: r.mentor_uid, type: "MENTORSHIP_STARTED", title: "Mentorship started", body: `You are now mentoring ${nameOf(r.mentee_uid)}.`, data: { requestId, relationshipId, conversationId } });
    } else if (action === "REJECT") {
      await notifications.create(c, { uid: r.mentee_uid, type: "MENTORSHIP_REQUEST_REJECTED", title: "Your mentorship request was declined", body: note ? `${nameOf(r.mentor_uid)}: ${note}`.slice(0, 400) : `${nameOf(r.mentor_uid)} cannot take this on right now.`, data: { requestId } });
    } else {
      await notifications.create(c, { uid: r.mentor_uid, type: "MENTORSHIP_REQUEST_CANCELLED", title: "A mentorship request was cancelled", body: `${nameOf(r.mentee_uid)} withdrew their request.`, data: { requestId } });
    }
    const row = (await c.query(`${REQUEST_SELECT} WHERE r.request_id=$1`, [requestId])).rows[0];
    return { request: requestView(row, uid), ...(relationshipId ? { relationshipId, conversationId } : {}) };
  });
}

const relationshipView = (r, uid) => ({
  relationshipId: r.relationship_id,
  requestId: r.request_id,
  status: r.status,
  role: uid === r.mentor_uid ? "MENTOR" : "MENTEE",
  mentor: person("mentor", r),
  mentee: person("mentee", r),
  conversationId: r.conversation_id,
  startedAt: r.started_at,
  endedAt: r.ended_at
});

const REL_SELECT = `
  SELECT r.*, c.conversation_id, m.display_name AS mentor_name, m.photo_url AS mentor_photo, m.headline AS mentor_headline, m.institution AS mentor_institution,
         e.display_name AS mentee_name, e.photo_url AS mentee_photo, e.headline AS mentee_headline, e.institution AS mentee_institution
    FROM mentorship_relationships r
    JOIN user_profiles m ON m.uid = r.mentor_uid
    JOIN user_profiles e ON e.uid = r.mentee_uid
    LEFT JOIN conversations c ON c.relationship_id = r.relationship_id`;

/** GET /mentorship/relationships?status=ACTIVE|COMPLETED&limit=&offset= : every relationship the caller is a party to (as mentor or mentee). */
async function listRelationships(pool, uid, query = {}) {
  const status = v.oneOf(query.status, "status", ["ACTIVE", "COMPLETED"]);
  const limit = v.intParam(query.limit, { def: 20, min: 1, max: 50 });
  const offset = v.intParam(query.offset, { def: 0, min: 0, max: 5000 });
  const params = [uid];
  let statusSql = "";
  if (status) { params.push(status); statusSql = ` AND r.status = $${params.length}`; }
  const rows = await pool.query(`${REL_SELECT} WHERE (r.mentor_uid = $1 OR r.mentee_uid = $1)${statusSql} ORDER BY r.started_at DESC, r.relationship_id DESC LIMIT ${limit + 1} OFFSET ${offset}`, params);
  return { relationships: rows.rows.slice(0, limit).map((r) => relationshipView(r, uid)), limit, offset, hasMore: rows.rows.length > limit };
}

/** PUT /mentorship/relationships/:id  { action: "COMPLETE" }: either party may close it; the conversation becomes read-only. */
async function updateRelationship(pool, uid, relationshipId, body) {
  if (!isId("relationship", relationshipId)) throw notFound("mentorship");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SocialError("INVALID_BODY", "Send a JSON object.", 400);
  v.onlyKeys(body, ["action"], "mentorship update");
  v.oneOf(body.action, "action", ["COMPLETE"], { required: true });
  return pool.transaction(async (c) => {
    const rel = (await c.query("SELECT * FROM mentorship_relationships WHERE relationship_id=$1 FOR UPDATE", [relationshipId])).rows[0];
    if (!rel || (rel.mentor_uid !== uid && rel.mentee_uid !== uid)) throw notFound("mentorship");
    const req = (await c.query("SELECT status FROM mentorship_requests WHERE request_id=$1 FOR UPDATE", [rel.request_id])).rows[0];
    const t = nextRequestStatus(req.status, "COMPLETE", rel.mentor_uid === uid ? "MENTOR" : "MENTEE");
    if (!t.ok || rel.status !== "ACTIVE") throw conflict("STATE_CONFLICT", "This mentorship is already completed.");
    await c.query("UPDATE mentorship_relationships SET status='COMPLETED', ended_at=now(), ended_by=$2 WHERE relationship_id=$1", [relationshipId, uid]);
    await c.query("UPDATE mentorship_requests SET status='COMPLETED', updated_at=now() WHERE request_id=$1", [rel.request_id]);
    await c.query("UPDATE conversations SET status='CLOSED' WHERE relationship_id=$1", [relationshipId]);
    const other = rel.mentor_uid === uid ? rel.mentee_uid : rel.mentor_uid;
    const me = (await c.query("SELECT display_name FROM user_profiles WHERE uid=$1", [uid])).rows[0];
    await notifications.create(c, { uid: other, type: "MENTORSHIP_COMPLETED", title: "A mentorship was completed", body: `${me ? me.display_name : "Your mentorship partner"} marked your mentorship as completed. The conversation is now read-only.`, data: { relationshipId } });
    const row = (await c.query(`${REL_SELECT} WHERE r.relationship_id=$1`, [relationshipId])).rows[0];
    return { relationship: relationshipView(row, uid) };
  });
}

module.exports = { nextRequestStatus, TRANSITIONS, REQUEST_STATUSES, createRequest, listRequests, getRequest, respondToRequest, listRelationships, updateRelationship };
