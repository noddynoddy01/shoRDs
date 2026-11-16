"use strict";
/**
 * In-app notifications, stored in PostgreSQL. A notification belongs to exactly one uid; every read and every state change filters on
 * that uid in SQL, so another user's notification is indistinguishable from one that does not exist (404). No email or push is sent
 * anywhere: this is the in-app list only.
 *
 * `data` carries identifiers for navigation (request id, conversation id, ...), never message text or private profile fields.
 */

const { notFound } = require("./errors");
const { NUMERIC_ID_RE } = require("./ids");
const { intParam } = require("./validation");

const TYPES = Object.freeze([
  "MENTOR_APPLICATION_RECEIVED", // to administrators
  "MENTOR_APPLICATION_APPROVED",
  "MENTOR_APPLICATION_REJECTED",
  "MENTOR_STATUS_REVOKED",
  "MENTORSHIP_REQUEST_RECEIVED",
  "MENTORSHIP_REQUEST_ACCEPTED",
  "MENTORSHIP_REQUEST_REJECTED",
  "MENTORSHIP_REQUEST_CANCELLED",
  "MENTORSHIP_STARTED",
  "MENTORSHIP_COMPLETED",
  "NEW_MESSAGE"
]);

const clip = (s, n) => String(s).slice(0, n);

/** `db` is the pool or a transaction client (both have .query), so a notification is written in the same transaction as the event. */
async function create(db, { uid, type, title, body = "", data = {} }) {
  if (!TYPES.includes(type)) throw new Error(`unknown notification type ${type}`);
  const r = await db.query(
    "INSERT INTO notifications (uid, type, title, body, data) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING notification_id",
    [uid, type, clip(title, 160), clip(body, 400), JSON.stringify(data)]
  );
  return r.rows[0].notification_id;
}

/**
 * One unread "new message" notification per conversation: a second message while the first is still unread raises its count instead
 * of adding a row, so a chatty conversation cannot bury the list.
 */
async function notifyNewMessage(db, { uid, conversationId, senderName }) {
  const existing = await db.query(
    "SELECT notification_id, (data->>'count')::int AS count FROM notifications WHERE uid=$1 AND type='NEW_MESSAGE' AND read_at IS NULL AND data->>'conversationId' = $2 ORDER BY notification_id DESC LIMIT 1",
    [uid, conversationId]
  );
  if (existing.rows.length) {
    const n = Math.min(999, (existing.rows[0].count || 1) + 1);
    await db.query(
      "UPDATE notifications SET data = jsonb_set(data, '{count}', to_jsonb($2::int)), body=$3, created_at=now() WHERE notification_id=$1",
      [existing.rows[0].notification_id, n, clip(`${n} new messages from ${senderName}`, 400)]
    );
    return;
  }
  await create(db, { uid, type: "NEW_MESSAGE", title: `New message from ${senderName}`, body: "Open the conversation to read it.", data: { conversationId, count: 1 } });
}

const view = (r) => ({ id: String(r.notification_id), type: r.type, title: r.title, body: r.body, data: r.data || {}, read: r.read_at !== null, readAt: r.read_at, createdAt: r.created_at });

async function unreadCount(pool, uid) {
  const r = await pool.query("SELECT count(*)::int AS n FROM notifications WHERE uid=$1 AND read_at IS NULL", [uid]);
  return r.rows[0].n;
}

/** Newest first. `before` is the id of the last notification already shown (keyset pagination, stable while new ones arrive). */
async function list(pool, uid, { unreadOnly = false, before, limit } = {}) {
  const lim = intParam(limit, { def: 20, min: 1, max: 50 });
  let beforeId = null;
  if (before !== undefined && before !== null && before !== "") {
    if (!NUMERIC_ID_RE.test(String(before))) throw require("./errors").invalid("INVALID_PAGINATION", "`before` must be a notification id.");
    beforeId = String(before);
  }
  const r = await pool.query(
    `SELECT notification_id, type, title, body, data, read_at, created_at FROM notifications
      WHERE uid=$1 AND ($2::boolean IS NOT TRUE OR read_at IS NULL) AND ($3::bigint IS NULL OR notification_id < $3::bigint)
      ORDER BY notification_id DESC LIMIT $4::int`,
    [uid, unreadOnly, beforeId, lim + 1]
  );
  const rows = r.rows.slice(0, lim);
  return { notifications: rows.map(view), unreadCount: await unreadCount(pool, uid), nextBefore: r.rows.length > lim ? String(rows[rows.length - 1].notification_id) : null };
}

async function markRead(pool, uid, id) {
  if (!NUMERIC_ID_RE.test(String(id))) throw notFound("notification");
  const r = await pool.query(
    "UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE notification_id=$1::bigint AND uid=$2 RETURNING notification_id, type, title, body, data, read_at, created_at",
    [String(id), uid]
  );
  if (r.rowCount === 0) throw notFound("notification"); // someone else's id looks exactly like a missing one
  return { notification: view(r.rows[0]), unreadCount: await unreadCount(pool, uid) };
}

async function markAllRead(pool, uid) {
  const r = await pool.query("UPDATE notifications SET read_at = now() WHERE uid=$1 AND read_at IS NULL", [uid]);
  return { marked: r.rowCount, unreadCount: 0 };
}

/** A conversation was opened: its "new message" notification is no longer pending. */
async function markConversationRead(db, uid, conversationId) {
  await db.query("UPDATE notifications SET read_at = now() WHERE uid=$1 AND type='NEW_MESSAGE' AND read_at IS NULL AND data->>'conversationId' = $2", [uid, conversationId]);
}

module.exports = { TYPES, create, notifyNewMessage, list, markRead, markAllRead, markConversationRead, unreadCount, view };
