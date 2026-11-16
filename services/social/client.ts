/**
 * Every community and assistant endpoint as a typed function. Pure: the authenticated api client is injected, so this runs unchanged
 * under Node's test runner. Identity is never sent: the server takes the caller from the verified token.
 */
import type { createApiClient } from "../auth/apiClient";
import {
  parseApplication, parseMyApplication, parseAssistantConversation, parseAssistantMessage, parseConversation, parseList, parseMentors, parseMessage, parseMyProfile, parseNotification, parseProfile, parseRelationship, parseRequest
} from "./parse.ts";
import type { AppNotification, AssistantConversation, AssistantMessage, ChatMessage, ConversationSummary, MentorApplication, MentorshipRequest, MyApplicationState, Page, Profile, Relationship } from "./types";

export type Api = Pick<ReturnType<typeof createApiClient>, "get" | "post" | "put" | "delete">;
type Json = Record<string, unknown>;
const enc = encodeURIComponent;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const page = <T,>(items: T[], j: Json): Page<T> => ({ items, hasMore: j.hasMore === true, total: typeof j.total === "number" ? j.total : null });

export function createSocialClient(api: Api) {
  return {
    // profiles
    getMyProfile: async () => parseMyProfile(await api.get("/api/v1/profiles/me")),
    saveMyProfile: async (body: Json) => parseProfile(obj(await api.put("/api/v1/profiles/me", body)).profile),
    getProfile: async (uid: string) => parseProfile(obj(await api.get(`/api/v1/profiles/${enc(uid)}`)).profile),

    // mentors
    searchMentors: async (q: { q?: string; domain?: string; expertise?: string; skill?: string; institution?: string; level?: string; availability?: string; sort?: string; limit?: number; offset?: number }) => {
      const j = obj(await api.get("/api/v1/mentors", { query: { ...q } }));
      const m = parseMentors(j);
      return { items: m.items, hasMore: m.hasMore, total: m.total } as Page<Profile>;
    },
    getMentor: async (uid: string) => parseProfile(obj(await api.get(`/api/v1/mentors/${enc(uid)}`)).mentor),
    getMyApplication: async (): Promise<MyApplicationState> => parseMyApplication(await api.get("/api/v1/mentor-applications/me")),
    submitApplication: async (body: Json) => parseApplication(obj(await api.post("/api/v1/mentor-applications", body)).application),
    listApplications: async (status: "PENDING" | "APPROVED" | "REJECTED" | "REVOKED" = "PENDING", offset = 0) => { const j = obj(await api.get("/api/v1/admin/mentor-applications", { query: { status, offset, limit: 20 } })); return page(parseList(j.applications, parseApplication), j); },
    reviewApplication: async (id: string, decision: "APPROVE" | "REJECT", note?: string) => parseApplication(obj(await api.put(`/api/v1/admin/mentor-applications/${enc(id)}`, { decision, ...(note ? { note } : {}) })).application),
    /** Administrators only (the server refuses everyone else, and refuses revoking yourself). A reason is required. */
    revokeMentor: async (uid: string, note: string) => { await api.post(`/api/v1/admin/mentors/${enc(uid)}/revoke`, { note }); },

    // mentorship
    createRequest: async (body: { mentorUid: string; domain: string; interests: string; guidanceNeeded: string }) => parseRequest(obj(await api.post("/api/v1/mentorship/requests", body)).request),
    listRequests: async (box: "incoming" | "outgoing", status?: string, offset = 0) => { const j = obj(await api.get("/api/v1/mentorship/requests", { query: { box, status, offset, limit: 20 } })); return page(parseList(j.requests, parseRequest), j) as Page<MentorshipRequest>; },
    respondToRequest: async (id: string, action: "ACCEPT" | "REJECT" | "CANCEL", note?: string) => { const j = obj(await api.put(`/api/v1/mentorship/requests/${enc(id)}`, { action, ...(note ? { note } : {}) })); return { request: parseRequest(j.request), conversationId: typeof j.conversationId === "string" ? j.conversationId : null }; },
    listRelationships: async (status?: "ACTIVE" | "COMPLETED", offset = 0) => { const j = obj(await api.get("/api/v1/mentorship/relationships", { query: { status, offset, limit: 20 } })); return page(parseList(j.relationships, parseRelationship), j) as Page<Relationship>; },
    completeRelationship: async (id: string) => parseRelationship(obj(await api.put(`/api/v1/mentorship/relationships/${enc(id)}`, { action: "COMPLETE" })).relationship),

    // messaging (polling)
    listConversations: async (offset = 0) => { const j = obj(await api.get("/api/v1/conversations", { query: { offset, limit: 30 } })); return { ...page(parseList(j.conversations, parseConversation), j), unreadTotal: typeof j.unreadTotal === "number" ? j.unreadTotal : 0 } as Page<ConversationSummary> & { unreadTotal: number }; },
    getConversation: async (id: string) => parseConversation(obj(await api.get(`/api/v1/conversations/${enc(id)}`)).conversation),
    startDirect: async (recipientUid: string) => parseConversation(obj(await api.post("/api/v1/conversations", { recipientUid })).conversation),
    listMessages: async (id: string, q: { before?: string; after?: string; limit?: number } = {}) => { const j = obj(await api.get(`/api/v1/conversations/${enc(id)}/messages`, { query: { ...q } })); return { messages: parseList(j.messages, parseMessage), nextBefore: typeof j.nextBefore === "string" ? j.nextBefore : null }; },
    sendMessage: async (id: string, body: string, clientId: string): Promise<ChatMessage> => parseMessage(obj(await api.post(`/api/v1/conversations/${enc(id)}/messages`, { body, clientId })).message),
    markConversationRead: async (id: string) => { await api.post(`/api/v1/conversations/${enc(id)}/read`, {}); },
    reportConversation: async (id: string, reason: string, messageId?: string) => { await api.post(`/api/v1/conversations/${enc(id)}/report`, { reason, ...(messageId ? { messageId } : {}) }); },
    blockUser: async (uid: string) => { await api.put(`/api/v1/users/${enc(uid)}/block`, {}); },
    unblockUser: async (uid: string) => { await api.delete(`/api/v1/users/${enc(uid)}/block`); },

    // notifications (in-app only)
    listNotifications: async (q: { unread?: boolean; before?: string } = {}) => { const j = obj(await api.get("/api/v1/notifications", { query: { unread: q.unread ? "true" : undefined, before: q.before, limit: 20 } })); return { items: parseList(j.notifications, parseNotification) as AppNotification[], unreadCount: typeof j.unreadCount === "number" ? j.unreadCount : 0, nextBefore: typeof j.nextBefore === "string" ? j.nextBefore : null }; },
    markNotificationRead: async (id: string) => { await api.post(`/api/v1/notifications/${enc(id)}/read`, {}); },
    markAllNotificationsRead: async () => { await api.post("/api/v1/notifications/read-all", {}); },
    counters: async () => { const j = obj(await api.get("/api/v1/me/counters")); return { notifications: typeof j.notifications === "number" ? j.notifications : 0, messages: typeof j.messages === "number" ? j.messages : 0 }; },

    // shoRDs Assistant
    askAssistant: async (message: string, conversationId?: string) => {
      const j = obj(await api.post("/api/v1/assistant/query", { message, ...(conversationId ? { conversationId } : {}) }));
      return { conversation: parseAssistantConversation(j.conversation), userMessage: parseAssistantMessage(j.userMessage), assistantMessage: parseAssistantMessage(j.assistantMessage) };
    },
    listAssistantConversations: async (offset = 0) => { const j = obj(await api.get("/api/v1/assistant/conversations", { query: { offset, limit: 20 } })); return page(parseList(j.conversations, parseAssistantConversation), j) as Page<AssistantConversation>; },
    getAssistantConversation: async (id: string) => { const j = obj(await api.get(`/api/v1/assistant/conversations/${enc(id)}`)); return { conversation: parseAssistantConversation(j.conversation), messages: parseList(j.messages, parseAssistantMessage) as AssistantMessage[] }; },
    deleteAssistantConversation: async (id: string) => { await api.delete(`/api/v1/assistant/conversations/${enc(id)}`); },
    clearAssistantHistory: async () => { await api.delete("/api/v1/assistant/conversations"); },
    assistantSuggestions: async (): Promise<string[]> => { const j = obj(await api.get("/api/v1/assistant/suggestions")); return Array.isArray(j.suggestions) ? j.suggestions.filter((s): s is string => typeof s === "string").slice(0, 10) : []; }
  };
}

export type SocialClient = ReturnType<typeof createSocialClient>;
