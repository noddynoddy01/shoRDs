/** Shapes the community endpoints return (backend/social/*). The parsers in parse.ts produce exactly these; nothing else reaches a screen. */

export type Persona = "STUDENT" | "MENTOR" | "RESEARCHER" | "PROFESSOR" | "ENTHUSIAST";
export type Availability = "AVAILABLE" | "LIMITED" | "UNAVAILABLE";
export type AcademicLevel = "SCHOOL" | "UNDERGRADUATE" | "POSTGRADUATE" | "DOCTORAL" | "POSTDOCTORAL" | "FACULTY" | "INDUSTRY" | "OTHER";
export type MentorshipPreference = "SEEKING_MENTOR" | "OFFERING_MENTORING" | "BOTH" | "NONE";
export type RequestStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "CANCELLED" | "COMPLETED";
export type ApplicationStatus = "NOT_APPLIED" | "PENDING" | "APPROVED" | "REJECTED" | "REVOKED";

export type Links = { orcid: string | null; linkedin: string | null; github: string | null; website: string | null; publications: string[] };

export type Profile = {
  uid: string;
  displayName: string;
  photoUrl: string | null;
  persona: Persona;
  headline: string | null;
  bio: string | null;
  institution: string | null;
  department: string | null;
  academicLevel: AcademicLevel | null;
  researchInterests: string[];
  researchDomains: string[];
  skills: string[];
  expertise: string[];
  links: Links;
  availability: Availability;
  mentorshipPreference: MentorshipPreference;
  verifiedMentor: boolean;
  openSlots: number | null;
  /** Only present on the caller's own profile. */
  own?: { email: string | null; allowDirectMessages: boolean; mentorCapacity: number; onboardingCompleted: boolean; isAdmin: boolean };
};

export type MyProfileState = { profile: Profile | null; onboardingRequired: boolean; isAdmin: boolean };

export type Person = { uid: string; displayName: string; photoUrl: string | null; headline: string | null; institution: string | null };

export type MentorApplication = {
  applicationId: string;
  status: ApplicationStatus;
  institution: string | null;
  designation: string | null;
  professionalBio: string | null;
  orcid: string | null;
  googleScholar: string | null;
  verificationNote: string | null;
  background: string;
  expertise: string[];
  mentoringAreas: string[];
  experience: string;
  portfolioLinks: string[];
  availability: Availability;
  capacity: number;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  /** Admin queue only: true when the reviewer is the applicant. The server refuses the decision; the screen disables the buttons. */
  ownApplication?: boolean;
  applicant?: { uid: string; displayName: string; persona: string; institution: string | null; headline: string | null };
};

/** GET /mentor-applications/me: the person's current standing. `verifiedMentor` is read from the server, never set by the client. */
export type MyApplicationState = { status: ApplicationStatus; verifiedMentor: boolean; application: MentorApplication | null };

export type MentorshipRequest = {
  requestId: string;
  status: RequestStatus;
  role: "MENTOR" | "MENTEE";
  mentor: Person;
  mentee: Person;
  domain: string;
  interests: string;
  guidanceNeeded: string;
  responseNote: string | null;
  createdAt: string;
};

export type Relationship = {
  relationshipId: string;
  requestId: string;
  status: "ACTIVE" | "COMPLETED";
  role: "MENTOR" | "MENTEE";
  mentor: Person;
  mentee: Person;
  conversationId: string | null;
  startedAt: string;
  endedAt: string | null;
};

export type ConversationSummary = {
  conversationId: string;
  kind: "MENTORSHIP" | "DIRECT";
  status: "ACTIVE" | "CLOSED";
  other: { uid: string; displayName: string; photoUrl: string | null; headline: string | null };
  lastMessage: { body: string; senderUid: string; createdAt: string } | null;
  unreadCount: number;
  lastActivityAt: string;
  canSend: boolean;
  blocked: boolean;
};

export type ChatMessage = { id: string; senderUid: string; body: string; createdAt: string; mine: boolean; readByOther: boolean | null };

export type AppNotification = { id: string; type: string; title: string; body: string; data: Record<string, string | number>; read: boolean; createdAt: string };

export type AssistantMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string; sources: { id: string; title: string }[]; truncated: boolean };
export type AssistantConversation = { id: string; title: string; createdAt: string; updatedAt: string; messageCount?: number };

export type Page<T> = { items: T[]; hasMore: boolean; total: number | null };
