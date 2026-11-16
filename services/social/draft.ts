/** The profile form's state and how it becomes a request body. Pure (no React), so it is unit-tested: nothing privileged is ever put in a body. */
import { splitList } from "./format.ts";
import type { AcademicLevel, Availability, Persona, Profile } from "./types";

export type Draft = {
  displayName: string; persona: Persona | null; headline: string; bio: string; institution: string; department: string; academicLevel: AcademicLevel | null;
  interests: string; domains: string; skills: string; expertise: string; orcid: string; linkedin: string; github: string; website: string; publications: string;
  availability: Availability; allowDirectMessages: boolean;
};


export function draftFrom(p: Profile | null, fallbackName = ""): Draft {
  return {
    displayName: p?.displayName ?? fallbackName, persona: p?.persona ?? null, headline: p?.headline ?? "", bio: p?.bio ?? "", institution: p?.institution ?? "", department: p?.department ?? "",
    academicLevel: p?.academicLevel ?? null, interests: (p?.researchInterests ?? []).join(", "), domains: (p?.researchDomains ?? []).join(", "), skills: (p?.skills ?? []).join(", "),
    expertise: (p?.expertise ?? []).join(", "), orcid: p?.links.orcid ?? "", linkedin: p?.links.linkedin ?? "", github: p?.links.github ?? "", website: p?.links.website ?? "",
    publications: (p?.links.publications ?? []).join("\n"), availability: p?.availability ?? "UNAVAILABLE", allowDirectMessages: p?.own?.allowDirectMessages ?? false
  };
}

/** The request body for a set of fields. Empty optional text is sent as null so it clears; nothing privileged is ever included. */
export function bodyFrom(d: Draft, fields: (keyof Draft)[]): Record<string, unknown> {
  const t = (v: string) => (v.trim() === "" ? null : v.trim());
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    switch (f) {
      case "displayName": out.displayName = d.displayName.trim(); break;
      case "persona": if (d.persona) out.persona = d.persona; break;
      case "headline": out.headline = t(d.headline); break;
      case "bio": out.bio = t(d.bio); break;
      case "institution": out.institution = t(d.institution); break;
      case "department": out.department = t(d.department); break;
      case "academicLevel": out.academicLevel = d.academicLevel; break;
      case "interests": out.researchInterests = splitList(d.interests, 15); break;
      case "domains": out.researchDomains = splitList(d.domains, 10); break;
      case "skills": out.skills = splitList(d.skills, 20, 40); break;
      case "expertise": out.expertise = splitList(d.expertise, 15); break;
      case "orcid": out.orcid = t(d.orcid); break;
      case "linkedin": out.linkedin = t(d.linkedin); break;
      case "github": out.github = t(d.github); break;
      case "website": out.website = t(d.website); break;
      case "publications": out.publications = d.publications.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 6); break;
      case "availability": out.availability = d.availability; break;
      case "allowDirectMessages": out.allowDirectMessages = d.allowDirectMessages; break;
    }
  }
  return out;
}
