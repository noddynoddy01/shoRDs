/** Rules the administrator review screen follows. Pure and unit-tested; the server enforces all of them again. */
import type { MentorApplication } from "./types";

export type ReviewAction = "APPROVE" | "REJECT" | "REVOKE";
export const MIN_REASON = 5;

/** Which actions the screen offers for an application. Own applications get none (separation of duties); the server refuses them too. */
export function reviewActions(a: Pick<MentorApplication, "status" | "ownApplication">): ReviewAction[] {
  if (a.ownApplication === true) return [];
  if (a.status === "PENDING") return ["APPROVE", "REJECT"];
  if (a.status === "APPROVED") return ["REVOKE"];
  return [];
}

/** Null when the reason is acceptable. Rejecting and revoking need one, approving does not. */
export function reasonProblem(action: ReviewAction, reason: string): string | null {
  if (action === "APPROVE") return null;
  const r = reason.trim();
  if (r.length < MIN_REASON) return `Give a reason of at least ${MIN_REASON} characters. The applicant will see it.`;
  if (r.length > 500) return "Keep the reason under 500 characters.";
  return null;
}

/** Only https links are ever opened from the review screen. */
export const safeLink = (u: string): string | null => (/^https:\/\/[^\s]+$/.test(u) ? u : null);
