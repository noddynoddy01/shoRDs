import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearIssue,
  getSession,
  signIn,
  signInWithGoogle,
  signOutUser,
  signUp,
  startSession,
  subscribeSession
} from "../services/auth/firebaseSession";
import { profileFromSession } from "../services/auth/session";
import { purgeLegacyBrowserAiKeys } from "../services/auth/legacy";
import type { AuthIssue, AuthStatus, SessionUser } from "../services/auth/session";

/** Local, non-authoritative cache of the signed-in user's display profile (name, interests, ...). Never an identity or privilege. */
export const PROFILE_KEY = "shords.currentUser";

type Result = { ok: true } | { ok: false; issue: AuthIssue };

type AuthValue = {
  status: AuthStatus;
  user: SessionUser | null;
  issue: AuthIssue | null;
  login: (email: string, password: string) => Promise<Result>;
  register: (name: string, email: string, password: string, interests: string[], extra?: { phoneNumber?: string }) => Promise<Result>;
  loginWithGoogle: () => Promise<Result>;
  logout: () => Promise<void>;
  dismissIssue: () => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  // undefined = not yet synced for the current user; the app is not shown until the cached profile matches the Firebase user
  const [syncedUid, setSyncedUid] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    startSession();
    void purgeLegacyBrowserAiKeys(AsyncStorage); // delete AI keys / self-declared subscription kept by earlier builds
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (session.status === "SIGNED_IN" && session.user) {
          let stored: Record<string, unknown> | null = null;
          try {
            const raw = await AsyncStorage.getItem(PROFILE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            stored = parsed && typeof parsed === "object" ? parsed : null;
          } catch (_) {
            stored = null;
          }
          await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profileFromSession(session.user, stored)));
          if (!cancelled) setSyncedUid(session.user.uid);
        } else if (session.status === "SIGNED_OUT" || session.status === "UNCONFIGURED") {
          await AsyncStorage.removeItem(PROFILE_KEY);
          if (!cancelled) setSyncedUid(null);
        }
      } catch (_) {
        if (!cancelled) setSyncedUid(session.user ? session.user.uid : null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.status, session.user]);

  const register = useCallback<AuthValue["register"]>(async (name, email, password, interests, extra) => {
    const r = await signUp(name, email, password, interests);
    if (!r.ok) return r;
    if (extra?.phoneNumber) {
      // Optional, local-only display detail (used for regional pricing); never sent to the backend as identity.
      try {
        const raw = await AsyncStorage.getItem(PROFILE_KEY);
        const base = raw ? JSON.parse(raw) : {};
        const isIndia = /^\+?91/.test(extra.phoneNumber.trim());
        await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({ ...base, phoneNumber: extra.phoneNumber.trim(), country: isIndia ? "India" : "International" }));
      } catch (_) {
        // cosmetic only
      }
    }
    return { ok: true };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status: session.status,
      user: session.user,
      issue: session.issue,
      login: async (email, password) => {
        const r = await signIn(email, password);
        return r.ok ? { ok: true } : r;
      },
      register,
      loginWithGoogle: async () => {
        const r = await signInWithGoogle();
        return r.ok ? { ok: true } : r;
      },
      logout: signOutUser,
      dismissIssue: clearIssue
    }),
    [session.status, session.user, session.issue, register]
  );

  const syncing = session.status === "SIGNED_IN" && session.user ? syncedUid !== session.user.uid : false;
  return (
    <AuthContext.Provider value={value}>
      {syncing ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}
