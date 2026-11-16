import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import { social } from "../services/social/instance";
import { describeSocialError } from "../services/social/format";
import type { OnboardingState } from "../services/auth/routeGuard";
import type { Profile } from "../services/social/types";

/**
 * The signed-in person's shoRDs profile (PostgreSQL, through the backend) and the two unread counters shown on badges.
 * Firebase only authenticates; this context asks the backend who the person is on the platform. Nothing here decides permissions:
 * `isAdmin` and `verifiedMentor` are read from the server and used only to choose what to show. The server enforces every action.
 */
type Phase = "IDLE" | "LOADING" | "READY" | "ERROR";
type Counters = { notifications: number; messages: number };

type ProfileValue = {
  phase: Phase;
  profile: Profile | null;
  isAdmin: boolean;
  onboarding: OnboardingState;
  error: string | null;
  counters: Counters;
  refresh: () => Promise<void>;
  refreshCounters: () => Promise<void>;
  saveProfile: (body: Record<string, unknown>) => Promise<{ ok: true; profile: Profile } | { ok: false; message: string; code: string | null }>;
  skipOnboarding: () => void;
};

const Ctx = createContext<ProfileValue | null>(null);
const COUNTER_POLL_MS = 30000;

export function useProfile(): ProfileValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProfile must be used inside <ProfileProvider>");
  return v;
}

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth();
  const uid = user ? user.uid : null;
  const [phase, setPhase] = useState<Phase>("IDLE");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [required, setRequired] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counters, setCounters] = useState<Counters>({ notifications: 0, messages: 0 });
  const loadId = useRef(0);

  const load = useCallback(async () => {
    const mine = ++loadId.current;
    setPhase("LOADING");
    setError(null);
    try {
      const me = await social.getMyProfile();
      if (mine !== loadId.current) return;
      setProfile(me.profile);
      setIsAdmin(me.isAdmin);
      setRequired(me.onboardingRequired);
      setPhase("READY");
    } catch (e) {
      if (mine !== loadId.current) return;
      setError(describeSocialError(e));
      setPhase("ERROR");
    }
  }, []);

  const refreshCounters = useCallback(async () => {
    try { setCounters(await social.counters()); } catch (_) { /* a badge that cannot refresh keeps its last value */ }
  }, []);

  useEffect(() => {
    loadId.current += 1; // supersede anything in flight for the previous person
    if (status !== "SIGNED_IN" || !uid) {
      setPhase("IDLE"); setProfile(null); setIsAdmin(false); setRequired(false); setSkipped(false); setError(null); setCounters({ notifications: 0, messages: 0 });
      return;
    }
    void load();
    void refreshCounters();
    const t = setInterval(() => { void refreshCounters(); }, COUNTER_POLL_MS);
    return () => clearInterval(t);
  }, [status, uid, load, refreshCounters]);

  const saveProfile = useCallback<ProfileValue["saveProfile"]>(async (body) => {
    try {
      const p = await social.saveMyProfile(body);
      setProfile(p);
      if (p.own) setRequired(!p.own.onboardingCompleted);
      return { ok: true, profile: p };
    } catch (e) {
      return { ok: false, message: describeSocialError(e), code: (e as { code?: string | null }).code ?? null };
    }
  }, []);

  const onboarding: OnboardingState = phase !== "READY" ? "UNKNOWN" : !required ? "DONE" : skipped ? "SKIPPED" : "REQUIRED";
  const value = useMemo<ProfileValue>(() => ({ phase, profile, isAdmin, onboarding, error, counters, refresh: load, refreshCounters, saveProfile, skipOnboarding: () => setSkipped(true) }), [phase, profile, isAdmin, onboarding, error, counters, load, refreshCounters, saveProfile]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
