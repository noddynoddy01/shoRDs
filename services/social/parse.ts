/**
 * Defensive parsers for the community endpoints. The server is trusted for authorisation, not for shape: anything malformed is
 * dropped (lists) or rejected (single objects) here, so a screen never renders `undefined` or an unexpected type.
 */
import type {
  AppNotification, AssistantConversation, AssistantMessage, ChatMessage, ConversationSummary, MentorApplication, MentorshipRequest, MyApplicationState, MyProfileState, Person, Profile, Relationship
} from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 5000): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const req = (v: unknown, max = 5000): string => { const s = str(v, max); if (s === null) throw new Error("bad shape"); return s; };
const bool = (v: unknown) => v === true;
const int = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : d);
const strList = (v: unknown, max = 40): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max).map((x) => x.slice(0, 300)) : []);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T => { if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T; throw new Error("bad enum"); };
const oneOfOrNull = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null);

export const APPLICATION_STATUSES = ["NOT_APPLIED", "PENDING", "APPROVED", "REJECTED", "REVOKED"] as const;
export const PERSONAS = ["STUDENT", "MENTOR", "RESEARCHER", "PROFESSOR", "ENTHUSIAST"] as const;
const AVAIL = ["AVAILABLE", "LIMITED", "UNAVAILABLE"] as const;
const LEVELS = ["SCHOOL", "UNDERGRADUATE", "POSTGRADUATE", "DOCTORAL", "POSTDOCTORAL", "FACULTY", "INDUSTRY", "OTHER"] as const;
const PREFS = ["SEEKING_MENTOR", "OFFERING_MENTORING", "BOTH", "NONE"] as const;
const REQ_STATUS = ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED", "COMPLETED"] as const;
const APP_STATUS = ["PENDING", "APPROVED", "REJECTED", "REVOKED"] as const;

export function parseProfile(j: unknown): Profile {
  if (!isObj(j)) throw new Error("bad shape");
  const links = isObj(j.links) ? j.links : {};
  const p: Profile = {
    uid: req(j.uid, 128),
    displayName: req(j.displayName, 200),
    photoUrl: str(j.photoUrl, 500),
    persona: oneOf(j.persona, PERSONAS),
    headline: str(j.headline, 200),
    bio: str(j.bio, 2000),
    institution: str(j.institution, 200),
    department: str(j.department, 200),
    academicLevel: oneOfOrNull(j.academicLevel, LEVELS),
    researchInterests: strList(j.researchInterests),
    researchDomains: strList(j.researchDomains),
    skills: strList(j.skills),
    expertise: strList(j.expertise),
    links: { orcid: str(links.orcid, 40), linkedin: str(links.linkedin, 300), github: str(links.github, 300), website: str(links.website, 300), publications: strList(links.publications, 6) },
    availability: oneOfOrNull(j.availability, AVAIL) || "UNAVAILABLE",
    mentorshipPreference: oneOfOrNull(j.mentorshipPreference, PREFS) || "NONE",
    verifiedMentor: bool(j.verifiedMentor),
    openSlots: typeof j.openSlots === "number" ? int(j.openSlots) : null
  };
  if ("onboardingCompleted" in j) p.own = { email: str(j.email, 320), allowDirectMessages: bool(j.allowDirectMessages), mentorCapacity: int(j.mentorCapacity), onboardingCompleted: bool(j.onboardingCompleted), isAdmin: bool(j.isAdmin) };
  return p;
}

export function parseMyProfile(j: unknown): MyProfileState {
  if (!isObj(j)) throw new Error("bad shape");
  return { profile: j.profile === null || j.profile === undefined ? null : parseProfile(j.profile), onboardingRequired: j.onboardingRequired !== false, isAdmin: bool(j.isAdmin) };
}

const person = (v: unknown): Person => {
  if (!isObj(v)) throw new Error("bad shape");
  return { uid: req(v.uid, 128), displayName: req(v.displayName, 200), photoUrl: str(v.photoUrl, 500), headline: str(v.headline, 200), institution: str(v.institution, 200) };
};

/** A list: malformed entries are dropped, never repaired. */
export function parseList<T>(v: unknown, one: (x: unknown) => T, max = 200): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v.slice(0, max)) { try { out.push(one(x)); } catch (_) { /* dropped */ } }
  return out;
}

export function parseMentors(j: unknown): { items: Profile[]; hasMore: boolean; total: number } {
  const o = isObj(j) ? j : {};
  return { items: parseList(o.mentors, parseProfile), hasMore: bool(o.hasMore), total: int(o.total) };
}

export function parseApplication(j: unknown): MentorApplication {
  if (!isObj(j)) throw new Error("bad shape");
  const a: MentorApplication = {
    applicationId: req(j.applicationId, 60), status: oneOf(j.status, APP_STATUS),
    institution: str(j.institution, 200), designation: str(j.designation, 200), professionalBio: str(j.professionalBio, 2100),
    orcid: str(j.orcid, 40), googleScholar: str(j.googleScholar, 300), verificationNote: str(j.verificationNote, 600),
    background: req(j.background), expertise: strList(j.expertise), mentoringAreas: strList(j.mentoringAreas),
    experience: req(j.experience), portfolioLinks: strList(j.portfolioLinks, 6), availability: oneOfOrNull(j.availability, AVAIL) || "AVAILABLE", capacity: int(j.capacity, 1),
    reviewNote: str(j.reviewNote, 600), reviewedAt: str(j.reviewedAt, 40), createdAt: req(j.createdAt, 40)
  };
  if (typeof j.ownApplication === "boolean") a.ownApplication = j.ownApplication;
  if (isObj(j.applicant)) a.applicant = { uid: req(j.applicant.uid, 128), displayName: req(j.applicant.displayName, 200), persona: str(j.applicant.persona, 30) || "", institution: str(j.applicant.institution, 200), headline: str(j.applicant.headline, 200) };
  return a;
}

/** The caller's own standing. An unknown status is treated as NOT_APPLIED and never as approved; `verifiedMentor` must be exactly true. */
export function parseMyApplication(j: unknown): MyApplicationState {
  const o = isObj(j) ? j : {};
  const status = oneOfOrNull(o.status, APPLICATION_STATUSES) || "NOT_APPLIED";
  let application: MentorApplication | null = null;
  if (o.application) { try { application = parseApplication(o.application); } catch (_) { application = null; } }
  return { status, verifiedMentor: o.verifiedMentor === true, application };
}

export function parseRequest(j: unknown): MentorshipRequest {
  if (!isObj(j)) throw new Error("bad shape");
  return { requestId: req(j.requestId, 60), status: oneOf(j.status, REQ_STATUS), role: oneOf(j.role, ["MENTOR", "MENTEE"] as const), mentor: person(j.mentor), mentee: person(j.mentee), domain: req(j.domain, 200), interests: req(j.interests), guidanceNeeded: req(j.guidanceNeeded), responseNote: str(j.responseNote, 600), createdAt: req(j.createdAt, 40) };
}

export function parseRelationship(j: unknown): Relationship {
  if (!isObj(j)) throw new Error("bad shape");
  return { relationshipId: req(j.relationshipId, 60), requestId: req(j.requestId, 60), status: oneOf(j.status, ["ACTIVE", "COMPLETED"] as const), role: oneOf(j.role, ["MENTOR", "MENTEE"] as const), mentor: person(j.mentor), mentee: person(j.mentee), conversationId: str(j.conversationId, 60), startedAt: req(j.startedAt, 40), endedAt: str(j.endedAt, 40) };
}

export function parseConversation(j: unknown): ConversationSummary {
  if (!isObj(j) || !isObj(j.other)) throw new Error("bad shape");
  const lm = isObj(j.lastMessage) ? { body: req(j.lastMessage.body, 400), senderUid: req(j.lastMessage.senderUid, 128), createdAt: req(j.lastMessage.createdAt, 40) } : null;
  return {
    conversationId: req(j.conversationId, 60), kind: oneOf(j.kind, ["MENTORSHIP", "DIRECT"] as const), status: oneOf(j.status, ["ACTIVE", "CLOSED"] as const),
    other: { uid: req(j.other.uid, 128), displayName: req(j.other.displayName, 200), photoUrl: str(j.other.photoUrl, 500), headline: str(j.other.headline, 200) },
    lastMessage: lm, unreadCount: int(j.unreadCount), lastActivityAt: req(j.lastActivityAt, 40), canSend: bool(j.canSend), blocked: bool(j.blocked)
  };
}

export function parseMessage(j: unknown): ChatMessage {
  if (!isObj(j)) throw new Error("bad shape");
  return { id: req(j.id, 20), senderUid: req(j.senderUid, 128), body: req(j.body, 2100), createdAt: req(j.createdAt, 40), mine: bool(j.mine), readByOther: typeof j.readByOther === "boolean" ? j.readByOther : null };
}

export function parseNotification(j: unknown): AppNotification {
  if (!isObj(j)) throw new Error("bad shape");
  const data: Record<string, string | number> = {};
  if (isObj(j.data)) for (const [k, v] of Object.entries(j.data)) if (typeof v === "string" || typeof v === "number") data[k.slice(0, 40)] = typeof v === "string" ? v.slice(0, 80) : v;
  return { id: req(j.id, 20), type: req(j.type, 60), title: req(j.title, 200), body: str(j.body, 500) || "", data, read: bool(j.read), createdAt: req(j.createdAt, 40) };
}

export function parseAssistantMessage(j: unknown): AssistantMessage {
  if (!isObj(j)) throw new Error("bad shape");
  const sources = parseList(j.sources, (s) => { if (!isObj(s)) throw new Error("bad"); return { id: req(s.id, 60), title: req(s.title, 200) }; }, 5);
  return { id: req(j.id, 20), role: oneOf(j.role, ["user", "assistant"] as const), content: req(j.content, 13000), createdAt: req(j.createdAt, 40), sources, truncated: bool(j.truncated) };
}

export function parseAssistantConversation(j: unknown): AssistantConversation {
  if (!isObj(j)) throw new Error("bad shape");
  const c: AssistantConversation = { id: req(j.id, 60), title: req(j.title, 200), createdAt: req(j.createdAt, 40), updatedAt: req(j.updatedAt, 40) };
  if (typeof j.messageCount === "number") c.messageCount = int(j.messageCount);
  return c;
}
