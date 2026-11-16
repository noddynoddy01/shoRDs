/** What a person's home screen shows, decided from server-provided facts only (profile, application standing, admin flag). Pure. */
import type { ApplicationStatus, Persona, Profile } from "./types";

export type MentorPanel = "VERIFIED" | "APPLY" | "APPLY_OPTIONAL" | "PENDING" | "REJECTED" | "REVOKED" | "NONE";
export type DashboardModel = { kind: Persona; mentorPanel: MentorPanel; showAdmin: boolean; showStudentTools: boolean };

/**
 * `verifiedMentor` comes from the server profile. A person whose standing is APPROVED but whose profile flag is false is NOT treated as verified
 * (the two can briefly disagree after a revoke). Nothing the client stores can raise the panel: it only ever reads what the server said.
 */
export function dashboardModel(input: { persona: Persona | null; verifiedMentor: boolean; applicationStatus: ApplicationStatus; isAdmin: boolean }): DashboardModel {
  const kind: Persona = input.persona ?? "ENTHUSIAST";
  let mentorPanel: MentorPanel;
  if (input.verifiedMentor) mentorPanel = "VERIFIED";
  else if (input.applicationStatus === "PENDING") mentorPanel = "PENDING";
  else if (input.applicationStatus === "REJECTED") mentorPanel = "REJECTED";
  else if (input.applicationStatus === "REVOKED") mentorPanel = "REVOKED";
  else mentorPanel = kind === "MENTOR" ? "APPLY" : kind === "PROFESSOR" || kind === "RESEARCHER" ? "APPLY_OPTIONAL" : "NONE";
  return { kind, mentorPanel, showAdmin: input.isAdmin === true, showStudentTools: kind === "STUDENT" || kind === "ENTHUSIAST" || kind === "RESEARCHER" };
}

export type Completion = { percent: number; done: string[]; missing: string[] };

/** How complete a profile is, with the exact items still missing. Persona-aware: mentors are asked for availability and expertise. */
export function profileCompletion(p: Profile | null): Completion {
  if (!p) return { percent: 0, done: [], missing: ["Create your profile"] };
  const checks: [string, boolean][] = [
    ["Name", p.displayName.trim().length > 0],
    ["Headline", !!p.headline],
    ["Institution", !!p.institution],
    ["About you", !!p.bio],
    ["Research interests", p.researchInterests.length > 0]
  ];
  if (p.persona === "MENTOR" || p.persona === "PROFESSOR" || p.persona === "RESEARCHER") checks.push(["Research domains", p.researchDomains.length > 0]);
  if (p.persona === "MENTOR" || p.persona === "PROFESSOR") { checks.push(["Expertise", p.expertise.length > 0]); checks.push(["Availability", p.availability !== "UNAVAILABLE"]); }
  if (p.persona === "STUDENT") checks.push(["Academic level", !!p.academicLevel]);
  const done = checks.filter((c) => c[1]).map((c) => c[0]);
  const missing = checks.filter((c) => !c[1]).map((c) => c[0]);
  return { percent: Math.round((done.length / checks.length) * 100), done, missing };
}

/** The headline for a person's dashboard. */
export function dashboardTitle(kind: Persona, name: string): { greeting: string; sub: string } {
  const first = name.trim().split(/\s+/)[0] || "there";
  const sub: Record<Persona, string> = {
    STUDENT: "Your research learning, mentors and conversations.",
    MENTOR: "Your mentoring, requests and mentees.",
    RESEARCHER: "Papers, collaborators and ideas.",
    PROFESSOR: "Your academic community and mentorship.",
    ENTHUSIAST: "Research, explained."
  };
  return { greeting: `Welcome, ${first}`, sub: sub[kind] };
}

/** Where onboarding should send a person when they finish. Mentors go to the dedicated application step unless they are already verified or have applied. */
export function postOnboardingRoute(input: { persona: Persona | null; verifiedMentor: boolean; applicationStatus: ApplicationStatus }): string {
  if (input.persona === "MENTOR" && !input.verifiedMentor && input.applicationStatus === "NOT_APPLIED") return "/mentor/application";
  return "/(tabs)/dashboard";
}
