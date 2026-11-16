/** The mentor application form: how its values become a request body, which mistakes are caught before sending (the server re-checks all of them), and what each status means. Pure. */
import { splitList } from "./format.ts";
import type { ApplicationStatus, Availability } from "./types";

export type ApplicationForm = {
  institution: string; designation: string; professionalBio: string; background: string; experience: string; expertise: string; mentoringAreas: string;
  links: string; orcid: string; googleScholar: string; verificationNote: string; availability: Availability; capacity: string;
};

export const emptyApplicationForm = (institution = ""): ApplicationForm => ({
  institution, designation: "", professionalBio: "", background: "", experience: "", expertise: "", mentoringAreas: "", links: "", orcid: "", googleScholar: "", verificationNote: "", availability: "AVAILABLE", capacity: "3"
});

const ORCID_RE = /^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$/;
const linesOf = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

function isHttps(u: string, host?: string): boolean {
  try { const x = new URL(u); return x.protocol === "https:" && (!host || x.hostname === host); } catch (_) { return false; }
}

/** field -> message, empty when the form is acceptable. Mirrors backend/social/mentors.js validateApplication. */
export function validateApplicationForm(f: ApplicationForm): Record<string, string> {
  const e: Record<string, string> = {};
  const len = (v: string) => v.trim().length;
  if (len(f.institution) < 1 || len(f.institution) > 120) e.institution = "Enter your institution or organisation.";
  if (len(f.designation) < 1 || len(f.designation) > 120) e.designation = "Enter your designation, for example Associate Professor.";
  if (len(f.professionalBio) < 20) e.professionalBio = "Write at least 20 characters about your professional background.";
  if (len(f.professionalBio) > 2000) e.professionalBio = "Keep the biography under 2000 characters.";
  if (len(f.background) < 20) e.background = "Describe your research background in at least 20 characters.";
  if (len(f.experience) < 20) e.experience = "Describe your mentoring or supervision experience in at least 20 characters.";
  if (splitList(f.expertise, 15).length === 0) e.expertise = "List at least one area of research expertise.";
  if (splitList(f.mentoringAreas, 10).length === 0) e.mentoringAreas = "List at least one area where you can mentor.";
  const links = linesOf(f.links);
  if (links.length > 6) e.links = "At most 6 links.";
  else if (links.some((l) => !isHttps(l))) e.links = "Each link must be a full https:// address.";
  const orcid = f.orcid.trim().replace(/^https?:\/\/orcid\.org\//i, "");
  if (orcid && !ORCID_RE.test(orcid)) e.orcid = "An ORCID looks like 0000-0002-1825-0097.";
  if (f.googleScholar.trim() && !isHttps(f.googleScholar.trim(), "scholar.google.com")) e.googleScholar = "Use your Google Scholar profile address (https://scholar.google.com/...).";
  if (len(f.verificationNote) > 500) e.verificationNote = "Keep this under 500 characters.";
  const cap = Number(f.capacity);
  if (!Number.isInteger(cap) || cap < 1 || cap > 50) e.capacity = "Enter a whole number from 1 to 50.";
  return e;
}

/** The request body. Only the keys the server accepts, never a status, a verified flag or an identity. */
export function applicationBody(f: ApplicationForm): Record<string, unknown> {
  const opt = (v: string) => (v.trim() === "" ? undefined : v.trim());
  const body: Record<string, unknown> = {
    institution: f.institution.trim(), designation: f.designation.trim(), professionalBio: f.professionalBio.trim(), background: f.background.trim(), experience: f.experience.trim(),
    expertise: splitList(f.expertise, 15), mentoringAreas: splitList(f.mentoringAreas, 10), portfolioLinks: linesOf(f.links).slice(0, 6), availability: f.availability, capacity: Number(f.capacity)
  };
  const orcid = opt(f.orcid), scholar = opt(f.googleScholar), note = opt(f.verificationNote);
  if (orcid) body.orcid = orcid;
  if (scholar) body.googleScholar = scholar;
  if (note) body.verificationNote = note;
  return body;
}

export type StatusTone = "neutral" | "good" | "warn" | "bad";
export type StatusInfo = { label: string; tone: StatusTone; headline: string; detail: string; canApply: boolean; showNote: boolean };

/** What each standing means to the person. `verifiedMentor` is the server's flag; the status alone never makes someone verified in the UI. */
export function applicationStatusInfo(status: ApplicationStatus, verifiedMentor: boolean): StatusInfo {
  if (verifiedMentor) return { label: "Approved", tone: "good", headline: "You are a verified mentor", detail: "You appear in the Mentors directory while your availability is not set to Not available. Students can send you mentorship requests.", canApply: false, showNote: false };
  switch (status) {
    case "PENDING": return { label: "Pending review", tone: "warn", headline: "Your application is being reviewed", detail: "An administrator will review it. You will be notified here when it is decided. Until then you are not listed as a verified mentor, and you can keep using shoRDs as a member.", canApply: false, showNote: false };
    case "APPROVED": return { label: "Approved", tone: "good", headline: "Your application was approved", detail: "Refresh your profile to see your verified status.", canApply: false, showNote: true };
    case "REJECTED": return { label: "Rejected", tone: "bad", headline: "Your application was not approved", detail: "You may update your details and apply again.", canApply: true, showNote: true };
    case "REVOKED": return { label: "Revoked", tone: "bad", headline: "Your verified mentor status was revoked", detail: "You are no longer listed in the Mentors directory. You may apply again.", canApply: true, showNote: true };
    default: return { label: "Not applied", tone: "neutral", headline: "Apply to become a verified mentor", detail: "Verified mentors are reviewed by a shoRDs administrator before they are listed. Complete your profile, then submit your professional details.", canApply: true, showNote: false };
  }
}
