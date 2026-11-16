/**
 * "How would you like to use shoRDs?" The four choices a person can make before signing up, and the small store that carries the choice from the landing
 * page through sign-up into onboarding.
 *
 * The choice is a USER INTERFACE HINT and nothing more. It does not authenticate, authorise or verify anyone: onboarding sends it to the profile API as
 * an ordinary `persona` value (the same field a person can edit later), and the server alone decides everything that matters (verified mentor, admin).
 * A tampered value in storage can at worst preselect a different card, so it can never grant anything.
 */
import type { Persona } from "./types";

export type IconName = "school-outline" | "ribbon-outline" | "flask-outline" | "library-outline";

export type PersonaChoice = { persona: Persona; title: string; icon: IconName; tagline: string; points: string[]; notice?: string };

export const SELECTABLE_PERSONAS = ["STUDENT", "MENTOR", "RESEARCHER", "PROFESSOR"] as const;
export type SelectablePersona = (typeof SELECTABLE_PERSONAS)[number];

export const PERSONA_CHOICES: readonly PersonaChoice[] = [
  { persona: "STUDENT", title: "Student", icon: "school-outline", tagline: "Learn from research and from people who do it.", points: ["Discover research", "Connect with mentors", "Develop research skills"] },
  {
    persona: "MENTOR", title: "Mentor", icon: "ribbon-outline", tagline: "Guide the next generation of researchers.",
    points: ["Guide students", "Share expertise", "Support research development"],
    notice: "Requires administrator verification before you are listed as a verified mentor."
  },
  { persona: "RESEARCHER", title: "Researcher", icon: "flask-outline", tagline: "Stay current and find people to work with.", points: ["Discover research", "Find collaborators", "Exchange research ideas"] },
  { persona: "PROFESSOR", title: "Professor / Academic", icon: "library-outline", tagline: "Bring academic experience to the community.", points: ["Share academic expertise", "Support researchers", "Participate in mentorship"] }
];

/** Accepts only the four selectable personas, in any letter case; anything else (including a made-up or privileged-sounding value) is null. */
export function parsePersonaChoice(v: unknown): SelectablePersona | null {
  if (typeof v !== "string") return null;
  const up = v.trim().toUpperCase().replace(/[\s/-]+/g, "_");
  const alias = up === "ACADEMIC" || up === "PROFESSOR_ACADEMIC" ? "PROFESSOR" : up;
  return (SELECTABLE_PERSONAS as readonly string[]).includes(alias) ? (alias as SelectablePersona) : null;
}

export type KeyValueStorage = { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> };
export const PENDING_PERSONA_KEY = "shords.pendingPersona";

/** In memory first (so the next screen sees it synchronously), mirrored to storage so a page reload or a Google redirect does not lose it. */
export function createIntentStore(storage: KeyValueStorage | null) {
  let current: SelectablePersona | null = null;
  return {
    get: (): SelectablePersona | null => current,
    set: async (p: SelectablePersona | null) => {
      current = p;
      if (!storage) return;
      try { if (p) await storage.setItem(PENDING_PERSONA_KEY, p); else await storage.removeItem(PENDING_PERSONA_KEY); } catch (_) { /* in-memory still works */ }
    },
    /** Reads storage once (e.g. after a reload). A stored value that is not one of the four is discarded. */
    hydrate: async (): Promise<SelectablePersona | null> => {
      if (current || !storage) return current;
      try { current = parsePersonaChoice(await storage.getItem(PENDING_PERSONA_KEY)); } catch (_) { current = null; }
      return current;
    },
    clear: async () => { current = null; if (storage) { try { await storage.removeItem(PENDING_PERSONA_KEY); } catch (_) { /* ignore */ } } }
  };
}
export type IntentStore = ReturnType<typeof createIntentStore>;
