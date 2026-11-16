/** Small, pure presentation helpers shared by the community screens. */
import { ApiError, describeApiError } from "../auth/apiClient.ts";
import type { AcademicLevel, Availability, Persona, RequestStatus } from "./types";

export const PERSONA_LABEL: Record<Persona, string> = { STUDENT: "Student", MENTOR: "Mentor", RESEARCHER: "Researcher", PROFESSOR: "Professor / Academic", ENTHUSIAST: "Independent enthusiast" };
export const PERSONA_HELP: Record<Persona, string> = {
  STUDENT: "Learning and looking for guidance.",
  MENTOR: "Experienced and keen to guide others. Verified mentor status needs an application.",
  RESEARCHER: "Doing research, in a lab or independently.",
  PROFESSOR: "Teaching or leading research at a university or institute.",
  ENTHUSIAST: "Curious about research without an institution."
};
export const LEVEL_LABEL: Record<AcademicLevel, string> = { SCHOOL: "School", UNDERGRADUATE: "Undergraduate", POSTGRADUATE: "Postgraduate", DOCTORAL: "Doctoral", POSTDOCTORAL: "Postdoctoral", FACULTY: "Faculty", INDUSTRY: "Industry", OTHER: "Other" };
export const AVAILABILITY_LABEL: Record<Availability, string> = { AVAILABLE: "Available", LIMITED: "Limited availability", UNAVAILABLE: "Not available" };
export const STATUS_LABEL: Record<RequestStatus, string> = { PENDING: "Pending", ACCEPTED: "Accepted", REJECTED: "Declined", CANCELLED: "Cancelled", COMPLETED: "Completed" };

/** "just now", "5 min ago", "3 h ago", "2 d ago", else a date. `now` is injectable for tests. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** A comma/newline separated text box -> a clean list (the same rules as the server: trimmed, de-duplicated, bounded). */
export function splitList(text: string, maxItems = 15, maxLen = 60): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,\n]/)) {
    const s = raw.trim().slice(0, maxLen);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** The sentence to show for a failed community call. The server's own message is client-safe and specific (409/422), so it is used for those. */
export function describeSocialError(e: unknown): string {
  if (e instanceof ApiError && (e.kind === "INVALID_REQUEST" || e.kind === "FORBIDDEN" || e.kind === "UNAVAILABLE") && e.message) return e.message;
  if (e instanceof ApiError && e.kind === "NOT_FOUND") return "That could not be found. It may have been removed.";
  return describeApiError(e);
}

/** Where tapping a notification should go. Only identifiers from the server's own `data` object are used, validated against known shapes. */
export function notificationTarget(type: string, data: Record<string, string | number>): string | null {
  const conv = typeof data.conversationId === "string" && /^conv_[0-9a-f]{18}$/.test(data.conversationId) ? data.conversationId : null;
  switch (type) {
    case "NEW_MESSAGE": return conv ? `/messages/${conv}` : "/messages";
    case "MENTORSHIP_REQUEST_ACCEPTED":
    case "MENTORSHIP_STARTED": return conv ? `/messages/${conv}` : "/mentorship";
    case "MENTORSHIP_REQUEST_RECEIVED":
    case "MENTORSHIP_REQUEST_REJECTED":
    case "MENTORSHIP_REQUEST_CANCELLED": return "/mentorship/requests";
    case "MENTORSHIP_COMPLETED": return "/mentorship";
    case "MENTOR_APPLICATION_APPROVED":
    case "MENTOR_APPLICATION_REJECTED":
    case "MENTOR_STATUS_REVOKED": return "/mentor/application";
    case "MENTOR_APPLICATION_RECEIVED": return "/mentor/review";
    default: return null;
  }
}
