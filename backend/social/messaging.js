"use strict";
/**
 * Person-to-person messaging (text only). Messages live in PostgreSQL; clients read them by polling (see docs: this is NOT real-time
 * push, and nothing here claims to be).
 *
 * Who may talk to whom (the permission model, enforced here and by constraints):
 *   MENTORSHIP conversation: created automatically when a mentor accepts a request (mentorship.js); the two people in it, nobody else.
 *   DIRECT conversation:     either person may start one with an onboarded person who has switched on "allow direct messages"
 *                            (default OFF), unless either has blocked the other. This is the connection policy for
 *                            student-student and researcher-researcher chat.
 * Every function takes the caller's uid from the verified token. A conversation id that does not involve the caller answers 404, exactly
 * like one that does not exist. A CLOSED conversation (its mentorship was completed) can be read but not written to; a block stops
 * new messages in both directions but never deletes history.
 */

const v = require("./validation");
const { SocialError, notFound, conflict } = require("./errors");
const { newId, isId, UID_RE, NUMERIC_ID_RE } = require("./ids");
const notifications = require("./notifications");

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_BODY = 2000;
const PREVIEW = 120;

const directKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const BLOCK_EXISTS = "EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_uid = $1 AND b.blocked_uid = o.uid) OR (b.blocker_uid = o.uid AND b.blocked_uid = $1))";
const CONVERSATION_SELECT = `
  SELECT c.conversation_id, c.kind, c.status, c.relationship_id, c.last_message_at, c.created_at,
         o.uid AS other_uid, op.display_name AS other_name, op.photo_url AS other_photo, op.headline AS other_headline,
         lm.body AS last_body, lm.sender_uid AS last_sender, lm.created_at AS last_created,
         (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.conversation_id AND m.message_id > me.last_read_message_id AND m.sender_uid <> $1) AS unread,
         ${BLOCK_EXISTS} AS blocked
    FROM conversation_participants me
    JOIN conversations c ON c.conversation_id = me.conversation_id
    JOIN conversation_participants o ON o.conversation_id = c.conversation_id AND o.uid <> $1
    JOIN user_profiles op ON op.uid = o.uid
    LEFT JOIN LATERAL (SELECT body, sender_uid, created_at FROM messages m WHERE m.conversation_id = c.conversation_id ORDER BY m.message_id DESC LIMIT 1) lm ON TRUE`;

function conversationView(r) {
  return {
    conversationId: r.conversation_id,
    kind: r.kind,
    status: r.status,
    relationshipId: r.relationship_id,
    other: { uid: r.other_uid, displayName: r.other_name, photoUrl: r.other_photo, headline: r.other_headline },
    lastMessage: r.last_body === null || r.last_body === undefined ? null : { body: r.last_body.length > PREVIEW ? r.last_body.slice(0, PREVIEW) + "…" : r.last_body, senderUid: r.last_sender, createdAt: r.last_created },
    unreadCount: r.unread,
    lastActivityAt: r.last_message_at || r.created_at,
    canSend: r.status === "ACTIVE" && r.blocked !== true,
    blocked: r.blocked === true
  };
}

async function unreadTotal(db, uid) {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM conversation_participants me JOIN messages m ON m.conversation_id = me.conversation_id AND m.message_id > me.last_read_message_id AND m.sender_uid <> me.uid WHERE me.uid = $1`,
    [uid]
  );
  return r.rows[0].n;
}

/** GET /conversations?limit=&offset= */
async function listConversations(pool, uid, query = {}) {
  const limit = v.intParam(query.limit, { def: 30, min: 1, max: 50 });
  const offset = v.intParam(query.offset, { def: 0, min: 0, max: 5000 });
  const rows = await pool.query(`${CONVERSATION_SELECT} WHERE me.uid = $1 ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.conversation_id DESC LIMIT ${limit + 1} OFFSET ${offset}`, [uid]);
  return { conversations: rows.rows.slice(0, limit).map(conversationView), unreadTotal: await unreadTotal(pool, uid), limit, offset, hasMore: rows.rows.length > limit };
}

async function loadConversation(db, uid, conversationId) {
  if (!isId("conversation", conversationId)) throw notFound("conversation");
  const r = (await db.query(`${CONVERSATION_SELECT} WHERE me.uid = $1 AND c.conversation_id = $2`, [uid, conversationId])).rows[0];
  if (!r) throw notFound("conversation");
  return r;
}

/** GET /conversations/:id (a participant only) */
async function getConversation(pool, uid, conversationId) {
  return { conversation: conversationView(await loadConversation(pool, uid, conversationId)) };
}

/** POST /conversations  { recipientUid }: a DIRECT conversation (or the existing one). */
async function createDirect(pool, uid, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SocialError("INVALID_BODY", "Send a JSON object.", 400);
  v.onlyKeys(body, ["recipientUid"], "conversation");
  const recipient = typeof body.recipientUid === "string" && UID_RE.test(body.recipientUid) ? body.recipientUid : null;
  if (!recipient) throw new SocialError("INVALID_RECIPIENT", "`recipientUid` is required.", 400);
  if (recipient === uid) throw new SocialError("INVALID_RECIPIENT", "You cannot start a conversation with yourself.", 400);
  const key = directKey(uid, recipient);
  let created = false;
  const id = await (async () => {
    try {
      return await pool.transaction(async (c) => {
        const me = (await c.query("SELECT onboarding_completed_at FROM user_profiles WHERE uid=$1", [uid])).rows[0];
        if (!me || me.onboarding_completed_at === null) throw conflict("PROFILE_REQUIRED", "Finish your profile before messaging people.");
        const other = (await c.query("SELECT allow_direct_messages, onboarding_completed_at FROM user_profiles WHERE uid=$1", [recipient])).rows[0];
        if (!other || other.onboarding_completed_at === null) throw notFound("person");
        const blocked = (await c.query("SELECT 1 FROM user_blocks WHERE (blocker_uid=$1 AND blocked_uid=$2) OR (blocker_uid=$2 AND blocked_uid=$1) LIMIT 1", [uid, recipient])).rows.length > 0;
        if (blocked) throw conflict("BLOCKED", "You cannot message this person.");
        const existing = (await c.query("SELECT conversation_id FROM conversations WHERE direct_key=$1", [key])).rows[0];
        if (existing) return existing.conversation_id;
        // The recipient's consent is needed only to START a conversation (an existing one is already agreed).
        if (!other.allow_direct_messages) throw conflict("DIRECT_MESSAGES_OFF", "This person is not accepting direct messages.");
        const cid = newId("conversation");
        await c.query("INSERT INTO conversations (conversation_id, kind, direct_key, created_by) VALUES ($1,'DIRECT',$2,$3)", [cid, key, uid]);
        await c.query("INSERT INTO conversation_participants (conversation_id, uid) VALUES ($1,$2), ($1,$3)", [cid, uid, recipient]);
        created = true;
        return cid;
      });
    } catch (e) {
      if (e && e.sqlState === "23505") { // two people started it at the same moment: the other one won; use theirs
        const ex = (await pool.query("SELECT conversation_id FROM conversations WHERE direct_key=$1", [key])).rows[0];
        if (ex) return ex.conversation_id;
      }
      throw e;
    }
  })();
  return { conversation: conversationView(await loadConversation(pool, uid, id)), created };
}

const messageView = (m, uid, otherLastRead) => ({
  id: String(m.message_id),
  senderUid: m.sender_uid,
  body: m.body,
  createdAt: m.created_at,
  mine: m.sender_uid === uid,
  readByOther: m.sender_uid === uid ? Number(m.message_id) <= otherLastRead : null
});

async function otherLastRead(db, uid, conversationId) {
  const r = await db.query("SELECT last_read_message_id FROM conversation_participants WHERE conversation_id=$1 AND uid <> $2", [conversationId, uid]);
  return r.rows.length ? Number(r.rows[0].last_read_message_id) : 0;
}

/**
 * GET /conversations/:id/messages?limit=&before=&after=
 *   default / before: the newest `limit` messages (older than `before` when given), returned oldest-first, with `nextBefore` to page back.
 *   after:            messages newer than `after` (oldest-first), for polling.
 */
async function listMessages(pool, uid, conversationId, query = {}) {
  await loadConversation(pool, uid, conversationId); // participant check (404 otherwise)
  const limit = v.intParam(query.limit, { def: 30, min: 1, max: 100 });
  const idArg = (name) => {
    const raw = query[name];
    if (raw === undefined || raw === null || raw === "") return null;
    if (!NUMERIC_ID_RE.test(String(raw))) throw new SocialError("INVALID_PAGINATION", `\`${name}\` must be a message id.`, 400);
    return String(raw);
  };
  const before = idArg("before");
  const after = idArg("after");
  if (before && after) throw new SocialError("INVALID_PAGINATION", "Use either `before` or `after`, not both.", 400);
  const peer = await otherLastRead(pool, uid, conversationId);
  if (after) {
    const r = await pool.query("SELECT message_id, sender_uid, body, created_at FROM messages WHERE conversation_id=$1 AND message_id > $2::bigint ORDER BY message_id ASC LIMIT $3::int", [conversationId, after, limit]);
    return { messages: r.rows.map((m) => messageView(m, uid, peer)), nextBefore: null, otherLastReadMessageId: String(peer) };
  }
  const r = await pool.query(
    "SELECT message_id, sender_uid, body, created_at FROM messages WHERE conversation_id=$1 AND ($2::bigint IS NULL OR message_id < $2::bigint) ORDER BY message_id DESC LIMIT $3::int",
    [conversationId, before, limit + 1]
  );
  const page = r.rows.slice(0, limit).reverse();
  return { messages: page.map((m) => messageView(m, uid, peer)), nextBefore: r.rows.length > limit ? String(page[0].message_id) : null, otherLastReadMessageId: String(peer) };
}

/** POST /conversations/:id/messages  { body, clientId? }. A repeated clientId (a retry after a network failure) returns the stored message. */
async function sendMessage(pool, uid, conversationId, input) {
  if (!isId("conversation", conversationId)) throw notFound("conversation");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SocialError("INVALID_BODY", "Send a JSON object.", 400);
  v.onlyKeys(input, ["body", "clientId"], "message");
  const body = v.text(input.body, "body", { min: 1, max: MAX_BODY, required: true, multiline: true });
  let clientId = null;
  if (input.clientId !== undefined && input.clientId !== null) {
    if (typeof input.clientId !== "string" || !CLIENT_ID_RE.test(input.clientId)) throw new SocialError("INVALID_CLIENT_ID", "`clientId` must be 8-64 characters of letters, digits, _ or -.", 400);
    clientId = input.clientId;
  }
  return pool.transaction(async (c) => {
    // Lock this person's participant row: it proves membership and serialises their own concurrent sends.
    const me = (await c.query("SELECT cp.uid, conv.status FROM conversation_participants cp JOIN conversations conv ON conv.conversation_id = cp.conversation_id WHERE cp.conversation_id=$1 AND cp.uid=$2 FOR UPDATE OF cp", [conversationId, uid])).rows[0];
    if (!me) throw notFound("conversation");
    if (me.status !== "ACTIVE") throw conflict("CONVERSATION_CLOSED", "This conversation is closed. You can read it, but not add to it.");
    const other = (await c.query("SELECT cp.uid, p.display_name FROM conversation_participants cp JOIN user_profiles p ON p.uid = cp.uid WHERE cp.conversation_id=$1 AND cp.uid <> $2", [conversationId, uid])).rows[0];
    if (!other) throw conflict("CONVERSATION_CLOSED", "This conversation has no other participant.");
    const blocked = (await c.query("SELECT 1 FROM user_blocks WHERE (blocker_uid=$1 AND blocked_uid=$2) OR (blocker_uid=$2 AND blocked_uid=$1) LIMIT 1", [uid, other.uid])).rows.length > 0;
    if (blocked) throw conflict("BLOCKED", "You cannot send messages in this conversation.");

    let inserted = (await c.query(
      "INSERT INTO messages (conversation_id, sender_uid, body, client_id) VALUES ($1,$2,$3,$4) ON CONFLICT (conversation_id, sender_uid, client_id) WHERE client_id IS NOT NULL DO NOTHING RETURNING message_id, sender_uid, body, created_at",
      [conversationId, uid, body, clientId]
    )).rows[0];
    let duplicate = false;
    if (!inserted) {
      duplicate = true;
      inserted = (await c.query("SELECT message_id, sender_uid, body, created_at FROM messages WHERE conversation_id=$1 AND sender_uid=$2 AND client_id=$3", [conversationId, uid, clientId])).rows[0];
    } else {
      await c.query("UPDATE conversations SET last_message_at = now() WHERE conversation_id=$1", [conversationId]);
      await c.query("UPDATE conversation_participants SET last_read_message_id = GREATEST(last_read_message_id, $3::bigint) WHERE conversation_id=$1 AND uid=$2", [conversationId, uid, String(inserted.message_id)]);
      const mine = (await c.query("SELECT display_name FROM user_profiles WHERE uid=$1", [uid])).rows[0];
      await notifications.notifyNewMessage(c, { uid: other.uid, conversationId, senderName: mine ? mine.display_name : "someone" });
    }
    return { message: messageView(inserted, uid, 0), duplicate };
  });
}

/** PUT /conversations/:id/read: everything in the conversation up to now is read by the caller. */
async function markRead(pool, uid, conversationId) {
  await loadConversation(pool, uid, conversationId);
  await pool.transaction(async (c) => {
    await c.query(
      "UPDATE conversation_participants SET last_read_message_id = GREATEST(last_read_message_id, COALESCE((SELECT max(message_id) FROM messages WHERE conversation_id=$1), 0)) WHERE conversation_id=$1 AND uid=$2",
      [conversationId, uid]
    );
    await notifications.markConversationRead(c, uid, conversationId);
  });
  return { conversationId, unreadTotal: await unreadTotal(pool, uid) };
}

/** PUT /users/:uid/block and /unblock */
async function setBlock(pool, uid, targetUid, blocked) {
  if (typeof targetUid !== "string" || !UID_RE.test(targetUid) || targetUid === uid) throw new SocialError("INVALID_USER_ID", "Invalid person.", 400);
  const exists = (await pool.query("SELECT 1 FROM user_profiles WHERE uid=$1", [targetUid])).rows.length > 0;
  if (!exists) throw notFound("person");
  if (blocked) await pool.query("INSERT INTO user_blocks (blocker_uid, blocked_uid) VALUES ($1,$2) ON CONFLICT DO NOTHING", [uid, targetUid]);
  else await pool.query("DELETE FROM user_blocks WHERE blocker_uid=$1 AND blocked_uid=$2", [uid, targetUid]);
  return { uid: targetUid, blocked };
}

/** POST /conversations/:id/report  { reason, messageId? } */
async function reportConversation(pool, uid, conversationId, input) {
  await loadConversation(pool, uid, conversationId);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SocialError("INVALID_BODY", "Send a JSON object.", 400);
  v.onlyKeys(input, ["reason", "messageId"], "report");
  const reason = v.text(input.reason, "reason", { min: 5, max: 500, required: true, multiline: true });
  let messageId = null;
  if (input.messageId !== undefined && input.messageId !== null) {
    if (!NUMERIC_ID_RE.test(String(input.messageId))) throw new SocialError("INVALID_MESSAGE_ID", "`messageId` is not valid.", 400);
    const m = (await pool.query("SELECT 1 FROM messages WHERE message_id=$1::bigint AND conversation_id=$2", [String(input.messageId), conversationId])).rows[0];
    if (!m) throw notFound("message");
    messageId = String(input.messageId);
  }
  const r = await pool.query("INSERT INTO message_reports (reporter_uid, conversation_id, message_id, reason) VALUES ($1,$2,$3::bigint,$4) RETURNING report_id", [uid, conversationId, messageId, reason]);
  return { reportId: String(r.rows[0].report_id), status: "OPEN" };
}

/** GET /admin/reports (administrators only). Shows the reported message only, never the rest of the conversation. */
async function listReports(pool, { isAdmin, status = "OPEN", limit } = {}) {
  if (isAdmin !== true) throw require("./errors").forbidden("Administrator access required.");
  const st = v.oneOf(status, "status", ["OPEN", "REVIEWED"], { required: true });
  const lim = v.intParam(limit, { def: 20, min: 1, max: 50 });
  const r = await pool.query(
    "SELECT rp.report_id, rp.reporter_uid, rp.conversation_id, rp.message_id, rp.reason, rp.status, rp.created_at, m.body AS message_body, m.sender_uid AS message_sender FROM message_reports rp LEFT JOIN messages m ON m.message_id = rp.message_id WHERE rp.status=$1 ORDER BY rp.report_id DESC LIMIT $2::int",
    [st, lim]
  );
  return { reports: r.rows.map((x) => ({ reportId: String(x.report_id), reporterUid: x.reporter_uid, conversationId: x.conversation_id, messageId: x.message_id === null ? null : String(x.message_id), messageSenderUid: x.message_sender || null, messageBody: x.message_body || null, reason: x.reason, status: x.status, createdAt: x.created_at })) };
}

module.exports = { MAX_BODY, directKey, listConversations, getConversation, createDirect, listMessages, sendMessage, markRead, setBlock, reportConversation, listReports, unreadTotal };
