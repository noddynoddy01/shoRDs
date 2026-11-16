"use strict";
/**
 * HTTP surface of the community layer (profiles, mentors, mentorship, messaging, notifications) and the shoRDs Assistant.
 *
 * Mounted by app.js through one hook, so every route inherits the existing pipeline unchanged: CORS, per-IP limit, Firebase token
 * verification, per-user limit, JSON body limit. None of these routes is public. This module adds, per route: the caller-specific
 * rate-limit policy, input validation (in the services), authorisation (in the services, in SQL), and the mapping of SocialError to a
 * client-safe response. The caller's identity is ALWAYS ctx.principal.uid from the verified token; no route reads a uid from a body to
 * mean "the caller".
 *
 * Route table (all under /api/v1):
 *   GET  PUT        /profiles/me                      GET /profiles/:uid
 *   GET             /mentors                          GET /mentors/:uid
 *   GET  POST       /mentor-applications/me | /mentor-applications
 *   GET             /admin/mentor-applications        PUT /admin/mentor-applications/:id     POST /admin/mentors/:uid/revoke
 *   POST GET        /mentorship/requests              GET/PUT /mentorship/requests/:id
 *   GET             /mentorship/relationships         PUT /mentorship/relationships/:id
 *   GET  POST       /conversations                    GET /conversations/:id
 *   GET  POST       /conversations/:id/messages       POST /conversations/:id/read | /conversations/:id/report
 *   PUT  DELETE     /users/:uid/block                 GET /admin/reports
 *   GET             /notifications | /notifications/unread-count | /me/counters
 *   POST            /notifications/read-all | /notifications/:id/read
 *   POST GET        /assistant/query | /assistant/suggestions | /assistant/conversations[/:id]    DELETE /assistant/conversations[/:id]
 */

const { SocialError } = require("./errors");
const profiles = require("./profiles");
const mentors = require("./mentors");
const mentorship = require("./mentorship");
const messaging = require("./messaging");
const notifications = require("./notifications");

function createSocialRoutes({ pool, assistant, adminUids, helpers, logger = console }) {
  const { limit, readBody, send, fail } = helpers;
  const isAdmin = (ctx) => adminUids.has(ctx.principal.uid);
  const uidOf = (ctx) => ctx.principal.uid;
  const queryOf = (ctx) => {
    const out = {};
    for (const [k, val] of new URL(ctx.req.url || "/", "http://localhost").searchParams) if (!(k in out)) out[k] = val;
    return out;
  };

  const guard = (run) => async (ctx) => {
    try {
      await run(ctx);
    } catch (e) {
      if (!(e instanceof SocialError) || ctx.res.headersSent) throw e;
      const extra = e.httpStatus === 503 ? { "Retry-After": String(e.extra && e.extra.retryAfterSec ? e.extra.retryAfterSec : 10) } : undefined;
      fail(ctx, e.httpStatus, e.code, e.message, extra);
    }
  };
  const read = (name, fn) => ({ name, run: guard(async (ctx) => { if (!(await limit(ctx, "READ_USER", "user", uidOf(ctx)))) return; await fn(ctx); }) });
  /** A state-changing route: its own per-user policy, then the JSON body. `policies` may be one name or several. */
  const write = (name, policies, fn, { body = true } = {}) => ({
    name, post: true,
    run: guard(async (ctx) => {
      for (const p of [].concat(policies)) if (!(await limit(ctx, p, "user", uidOf(ctx)))) return;
      let b = {};
      if (body) { b = await readBody(ctx); if (!b) return; }
      await fn(ctx, b);
    })
  });

  const table = [];
  const add = (method, pattern, route) => table.push({ method, parts: pattern.split("/").filter(Boolean), route });

  // ---- profiles
  add("GET", "profiles/me", read("profile_me", async (ctx) => send(ctx, 200, { ...(await profiles.getMe(pool, ctx.principal, { isAdmin: isAdmin(ctx) })), requestId: ctx.requestId })));
  add("PUT", "profiles/me", write("profile_save", "PROFILE_WRITE_USER", async (ctx, body) => {
    const { profile, created } = await profiles.upsertMe(pool, ctx.principal, body, { isAdmin: isAdmin(ctx) });
    send(ctx, created ? 201 : 200, { profile, requestId: ctx.requestId });
  }));
  add("GET", "profiles/*", read("profile_get", async (ctx) => send(ctx, 200, { ...(await profiles.getPublic(pool, uidOf(ctx), ctx.seg[3])), requestId: ctx.requestId })));

  // ---- mentor directory and applications
  add("GET", "mentors", read("mentor_search", async (ctx) => send(ctx, 200, { ...(await mentors.searchMentors(pool, uidOf(ctx), queryOf(ctx))), requestId: ctx.requestId })));
  add("GET", "mentors/*", read("mentor_get", async (ctx) => send(ctx, 200, { ...(await mentors.getMentor(pool, uidOf(ctx), ctx.seg[3])), requestId: ctx.requestId })));
  add("GET", "mentor-applications/me", read("mentor_application_me", async (ctx) => send(ctx, 200, { ...(await mentors.getMyApplication(pool, uidOf(ctx))), requestId: ctx.requestId })));
  add("POST", "mentor-applications", write("mentor_apply", "MENTOR_APPLY_USER", async (ctx, body) => send(ctx, 201, { ...(await mentors.submitApplication(pool, uidOf(ctx), body, { adminUids: [...adminUids] })), requestId: ctx.requestId })));

  // ---- administration (every handler re-checks the admin allow-list inside the service as well)
  const admin = (name, fn) => read(name, async (ctx) => { if (!(await limit(ctx, "ADMIN_USER", "user", uidOf(ctx)))) return; await fn(ctx); });
  add("GET", "admin/mentor-applications", admin("admin_applications", async (ctx) => send(ctx, 200, { ...(await mentors.listApplications(pool, { isAdmin: isAdmin(ctx), adminUid: ctx.principal.uid, ...queryOf(ctx) })), requestId: ctx.requestId })));
  add("PUT", "admin/mentor-applications/*", write("admin_application_review", "ADMIN_USER", async (ctx, body) => send(ctx, 200, { ...(await mentors.reviewApplication(pool, { isAdmin: isAdmin(ctx), adminUid: uidOf(ctx), applicationId: ctx.seg[4], body })), requestId: ctx.requestId })));
  add("POST", "admin/mentors/*/revoke", write("admin_mentor_revoke", "ADMIN_USER", async (ctx, body) => send(ctx, 200, { ...(await mentors.revokeMentor(pool, { isAdmin: isAdmin(ctx), adminUid: uidOf(ctx), targetUid: ctx.seg[4], body })), requestId: ctx.requestId })));
  add("GET", "admin/reports", admin("admin_reports", async (ctx) => send(ctx, 200, { ...(await messaging.listReports(pool, { isAdmin: isAdmin(ctx), ...queryOf(ctx) })), requestId: ctx.requestId })));

  // ---- mentorship requests and relationships
  add("POST", "mentorship/requests", write("mentorship_request_create", ["MENTOR_REQUEST_USER"], async (ctx, body) => send(ctx, 201, { ...(await mentorship.createRequest(pool, uidOf(ctx), body)), requestId: ctx.requestId })));
  add("GET", "mentorship/requests", read("mentorship_request_list", async (ctx) => send(ctx, 200, { ...(await mentorship.listRequests(pool, uidOf(ctx), queryOf(ctx))), requestId: ctx.requestId })));
  add("GET", "mentorship/requests/*", read("mentorship_request_get", async (ctx) => send(ctx, 200, { ...(await mentorship.getRequest(pool, uidOf(ctx), ctx.seg[4])), requestId: ctx.requestId })));
  add("PUT", "mentorship/requests/*", write("mentorship_request_respond", "MENTORSHIP_ACTION_USER", async (ctx, body) => send(ctx, 200, { ...(await mentorship.respondToRequest(pool, uidOf(ctx), ctx.seg[4], body)), requestId: ctx.requestId })));
  add("GET", "mentorship/relationships", read("mentorship_relationship_list", async (ctx) => send(ctx, 200, { ...(await mentorship.listRelationships(pool, uidOf(ctx), queryOf(ctx))), requestId: ctx.requestId })));
  add("PUT", "mentorship/relationships/*", write("mentorship_relationship_update", "MENTORSHIP_ACTION_USER", async (ctx, body) => send(ctx, 200, { ...(await mentorship.updateRelationship(pool, uidOf(ctx), ctx.seg[4], body)), requestId: ctx.requestId })));

  // ---- messaging (text only; clients poll)
  add("GET", "conversations", read("conversation_list", async (ctx) => send(ctx, 200, { ...(await messaging.listConversations(pool, uidOf(ctx), queryOf(ctx))), requestId: ctx.requestId })));
  add("POST", "conversations", write("conversation_create", "CONVERSATION_CREATE_USER", async (ctx, body) => {
    const out = await messaging.createDirect(pool, uidOf(ctx), body);
    send(ctx, out.created === false ? 200 : 201, { ...out, requestId: ctx.requestId });
  }));
  add("GET", "conversations/*", read("conversation_get", async (ctx) => send(ctx, 200, { ...(await messaging.getConversation(pool, uidOf(ctx), ctx.seg[3])), requestId: ctx.requestId })));
  add("GET", "conversations/*/messages", read("message_list", async (ctx) => send(ctx, 200, { ...(await messaging.listMessages(pool, uidOf(ctx), ctx.seg[3], queryOf(ctx))), requestId: ctx.requestId })));
  add("POST", "conversations/*/messages", write("message_send", "MESSAGE_SEND_USER", async (ctx, body) => {
    const out = await messaging.sendMessage(pool, uidOf(ctx), ctx.seg[3], body);
    send(ctx, out.duplicate ? 200 : 201, { ...out, requestId: ctx.requestId });
  }));
  add("POST", "conversations/*/read", write("conversation_read", "READ_USER", async (ctx) => send(ctx, 200, { ...(await messaging.markRead(pool, uidOf(ctx), ctx.seg[3])), requestId: ctx.requestId }), { body: false }));
  add("POST", "conversations/*/report", write("conversation_report", "REPORT_USER", async (ctx, body) => send(ctx, 201, { ...(await messaging.reportConversation(pool, uidOf(ctx), ctx.seg[3], body)), requestId: ctx.requestId })));
  add("PUT", "users/*/block", write("user_block", "MENTORSHIP_ACTION_USER", async (ctx) => send(ctx, 200, { ...(await messaging.setBlock(pool, uidOf(ctx), ctx.seg[3], true)), requestId: ctx.requestId }), { body: false }));
  add("DELETE", "users/*/block", write("user_unblock", "MENTORSHIP_ACTION_USER", async (ctx) => send(ctx, 200, { ...(await messaging.setBlock(pool, uidOf(ctx), ctx.seg[3], false)), requestId: ctx.requestId }), { body: false }));

  // ---- notifications (in-app only)
  add("GET", "notifications", read("notification_list", async (ctx) => {
    const q = queryOf(ctx);
    send(ctx, 200, { ...(await notifications.list(pool, uidOf(ctx), { unreadOnly: q.unread === "true", before: q.before, limit: q.limit })), requestId: ctx.requestId });
  }));
  add("GET", "notifications/unread-count", read("notification_count", async (ctx) => send(ctx, 200, { unreadCount: await notifications.unreadCount(pool, uidOf(ctx)), requestId: ctx.requestId })));
  add("GET", "me/counters", read("me_counters", async (ctx) => send(ctx, 200, { notifications: await notifications.unreadCount(pool, uidOf(ctx)), messages: await messaging.unreadTotal(pool, uidOf(ctx)), requestId: ctx.requestId })));
  add("POST", "notifications/read-all", write("notification_read_all", "WRITE_USER", async (ctx) => send(ctx, 200, { ...(await notifications.markAllRead(pool, uidOf(ctx))), requestId: ctx.requestId }), { body: false }));
  add("POST", "notifications/*/read", write("notification_read", "WRITE_USER", async (ctx) => send(ctx, 200, { ...(await notifications.markRead(pool, uidOf(ctx), ctx.seg[3])), requestId: ctx.requestId }), { body: false }));

  // ---- shoRDs Assistant
  if (assistant) {
    add("POST", "assistant/query", write("assistant_query", ["ASSISTANT_USER", "ASSISTANT_USER_DAILY"], async (ctx, body) => send(ctx, 201, { ...(await assistant.query(uidOf(ctx), body)), requestId: ctx.requestId })));
    add("GET", "assistant/suggestions", read("assistant_suggestions", async (ctx) => send(ctx, 200, { ...assistant.suggestions(), requestId: ctx.requestId })));
    add("GET", "assistant/conversations", read("assistant_list", async (ctx) => send(ctx, 200, { ...(await assistant.listConversations(uidOf(ctx), queryOf(ctx))), requestId: ctx.requestId })));
    add("GET", "assistant/conversations/*", read("assistant_get", async (ctx) => send(ctx, 200, { ...(await assistant.getConversation(uidOf(ctx), ctx.seg[4], queryOf(ctx))), requestId: ctx.requestId })));
    add("DELETE", "assistant/conversations/*", write("assistant_delete", "WRITE_USER", async (ctx) => send(ctx, 200, { ...(await assistant.deleteConversation(uidOf(ctx), ctx.seg[4])), requestId: ctx.requestId }), { body: false }));
    add("DELETE", "assistant/conversations", write("assistant_clear", "WRITE_USER", async (ctx) => send(ctx, 200, { ...(await assistant.clearHistory(uidOf(ctx))), requestId: ctx.requestId }), { body: false }));
  }

  /** @returns {{name:string, post?:boolean, run:Function}|null} for the app.js router; `seg` is the path split on "/". */
  function match(method, seg) {
    if (seg[0] !== "api" || seg[1] !== "v1") return null;
    const rest = seg.slice(2);
    for (const t of table) {
      if (t.method !== method || t.parts.length !== rest.length) continue;
      if (!t.parts.every((p, i) => p === "*" || p === rest[i])) continue;
      return { name: t.route.name, post: t.route.post, run: (ctx) => { ctx.seg = seg; return t.route.run(ctx); } };
    }
    return null;
  }

  return { match, routeCount: table.length };
}

module.exports = { createSocialRoutes };
