/**
 * Firebase-backed session: the one place that connects Firebase Auth to the pure session machine and the API client.
 *
 *   onAuthStateChanged -> reduceSession -> subscribers (React)      user.getIdToken() -> apiClient -> Bearer header
 *
 * This is the thin, SDK-dependent layer; all decisions live in the pure modules next to it (session.ts, apiClient.ts,
 * routeGuard.ts, projects.ts), which are unit-tested without the Expo toolchain.
 */

import { onAuthStateChanged, signOut as firebaseSignOut } from "firebase/auth";
import { auth, hasFirebaseConfig, loginWithEmail, loginWithGooglePopup, signupWithEmail } from "../firebase";
import { createApiClient } from "./apiClient";
import type { AuthReadiness } from "./apiClient";
import { initialSession, issue, mapFirebaseError, reduceSession, toSessionUser } from "./session";
import type { SessionEvent, SessionState } from "./session";

let state: SessionState = initialSession;
const listeners = new Set<(s: SessionState) => void>();
let started = false;
let readyWaiters: Array<(r: AuthReadiness) => void> = [];

function readiness(s: SessionState): AuthReadiness | null {
  if (s.status === "LOADING") return null;
  return s.status === "SIGNED_IN" ? "SIGNED_IN" : s.status === "UNCONFIGURED" ? "UNCONFIGURED" : "SIGNED_OUT";
}

function dispatch(event: SessionEvent) {
  state = reduceSession(state, event);
  const r = readiness(state);
  if (r) {
    const waiters = readyWaiters;
    readyWaiters = [];
    waiters.forEach((w) => w(r));
  }
  listeners.forEach((l) => l(state));
}

/** Idempotent. Call once at app start (AuthProvider does). */
export function startSession(): void {
  if (started) return;
  started = true;
  if (!hasFirebaseConfig || !auth) {
    dispatch({ type: "CONFIG_MISSING" });
    return;
  }
  onAuthStateChanged(
    auth,
    (user) => dispatch({ type: "AUTH_STATE", user: toSessionUser(user) }),
    (err) => dispatch({ type: "LISTENER_ERROR", issue: mapFirebaseError(err) })
  );
}

export const getSession = (): SessionState => state;
export function subscribeSession(fn: (s: SessionState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Resolves as soon as auth state is known; protected API calls wait on this so nothing is sent while LOADING. */
export function waitForAuthReady(): Promise<AuthReadiness> {
  startSession();
  const r = readiness(state);
  if (r) return Promise.resolve(r);
  return new Promise((resolve) => readyWaiters.push(resolve));
}

/** The current user's Firebase ID token (refreshed by the SDK when near expiry, or forcibly when asked). Never logged or stored by us. */
export async function getIdToken(forceRefresh: boolean): Promise<string | null> {
  const user = auth ? auth.currentUser : null;
  if (!user) return null;
  try {
    return await user.getIdToken(forceRefresh);
  } catch (_) {
    return null;
  }
}

async function guarded<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; issue: ReturnType<typeof mapFirebaseError> }> {
  if (!hasFirebaseConfig || !auth) return { ok: false, issue: issue("NOT_CONFIGURED") };
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    const i = mapFirebaseError(e);
    dispatch({ type: "SIGN_IN_FAILED", issue: i });
    return { ok: false, issue: i };
  }
}

export const signIn = (email: string, password: string) => guarded(() => loginWithEmail(email.trim(), password));
export const signUp = (name: string, email: string, password: string, interests: string[]) => guarded(() => signupWithEmail(name.trim(), email.trim(), password, interests));
export const signInWithGoogle = () => guarded(() => loginWithGooglePopup());

export async function signOutUser(): Promise<void> {
  if (auth) {
    try {
      await firebaseSignOut(auth);
    } catch (_) {
      // onAuthStateChanged remains the source of truth; a failed sign-out leaves the user signed in and the UI says so
    }
  }
}

export function clearIssue(): void {
  dispatch({ type: "ISSUE_SEEN" });
}

/** The backend rejected a freshly refreshed token: the local session is unusable, so end it (the guard then routes to /auth). */
function onSessionRejected(reason: "EXPIRED" | "INVALID") {
  dispatch({ type: "SESSION_REJECTED", reason });
  void signOutUser();
}

/** EXPO_PUBLIC_API_URL must be referenced literally so Expo inlines it into the bundle. */
export const api = createApiClient({ baseUrl: process.env.EXPO_PUBLIC_API_URL, getIdToken, waitForAuthReady, onSessionRejected });
