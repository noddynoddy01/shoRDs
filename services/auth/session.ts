/**
 * Authentication session state for shoRDs: a pure, framework-free state machine.
 *
 * Production identity is Firebase ONLY. This module never invents a user: a session is SIGNED_IN only when the Firebase SDK
 * reported a user, and it carries nothing but what Firebase gave us (uid, email, display name). There is no local, mock,
 * "admin", "mentor" or offline-fallback login anywhere in this model; if sign-in fails the session stays SIGNED_OUT and says why.
 *
 * Kept free of imports so it can be unit-tested in Node (backend/tests/node/frontendAuth.test.js) without the Expo toolchain.
 */

export type AuthStatus = "LOADING" | "SIGNED_OUT" | "SIGNED_IN" | "UNCONFIGURED";

export type AuthIssueCode =
  | "NOT_CONFIGURED"
  | "INVALID_CREDENTIALS"
  | "INVALID_EMAIL"
  | "WEAK_PASSWORD"
  | "EMAIL_IN_USE"
  | "ACCOUNT_DISABLED"
  | "TOO_MANY_ATTEMPTS"
  | "NETWORK"
  | "SESSION_EXPIRED"
  | "TOKEN_INVALID"
  | "POPUP_CLOSED"
  | "UNKNOWN";

export type AuthIssue = { code: AuthIssueCode; message: string };

export type SessionUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
};

export type SessionState = {
  status: AuthStatus;
  user: SessionUser | null;
  /** Why the user is signed out, if something went wrong (shown once on the sign-in screen). */
  issue: AuthIssue | null;
};

export type SessionEvent =
  | { type: "CONFIG_MISSING" }
  | { type: "AUTH_STATE"; user: SessionUser | null }
  | { type: "LISTENER_ERROR"; issue: AuthIssue }
  | { type: "SIGN_IN_FAILED"; issue: AuthIssue }
  | { type: "SESSION_REJECTED"; reason: "EXPIRED" | "INVALID" }
  | { type: "ISSUE_SEEN" };

export const initialSession: SessionState = { status: "LOADING", user: null, issue: null };

const MESSAGES: Record<AuthIssueCode, string> = {
  NOT_CONFIGURED: "Sign-in is not configured for this build. Ask the administrator to set the Firebase environment variables.",
  INVALID_CREDENTIALS: "That email and password do not match an account.",
  INVALID_EMAIL: "Enter a valid email address.",
  WEAK_PASSWORD: "Choose a stronger password (at least 6 characters).",
  EMAIL_IN_USE: "An account with that email already exists. Try signing in.",
  ACCOUNT_DISABLED: "This account has been disabled.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Wait a few minutes and try again.",
  NETWORK: "Could not reach the sign-in service. Check your connection and try again.",
  SESSION_EXPIRED: "Your session expired. Sign in again to continue.",
  TOKEN_INVALID: "Your session could not be verified. Sign in again to continue.",
  POPUP_CLOSED: "Sign-in was cancelled.",
  UNKNOWN: "Sign-in failed. Try again."
};

export function issue(code: AuthIssueCode): AuthIssue {
  return { code, message: MESSAGES[code] };
}

/** Map a Firebase Auth error code (e.g. "auth/wrong-password") to a user-facing issue. Unknown codes never leak raw text. */
export function mapFirebaseError(err: unknown): AuthIssue {
  const code = err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string" ? ((err as { code: string }).code) : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-login-credentials":
      return issue("INVALID_CREDENTIALS"); // deliberately the same message for wrong password and unknown account
    case "auth/invalid-email":
    case "auth/missing-email":
      return issue("INVALID_EMAIL");
    case "auth/weak-password":
      return issue("WEAK_PASSWORD");
    case "auth/email-already-in-use":
      return issue("EMAIL_IN_USE");
    case "auth/user-disabled":
      return issue("ACCOUNT_DISABLED");
    case "auth/too-many-requests":
      return issue("TOO_MANY_ATTEMPTS");
    case "auth/network-request-failed":
      return issue("NETWORK");
    case "auth/user-token-expired":
    case "auth/id-token-expired":
      return issue("SESSION_EXPIRED");
    case "auth/invalid-user-token":
    case "auth/id-token-revoked":
    case "auth/requires-recent-login":
      return issue("TOKEN_INVALID");
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return issue("POPUP_CLOSED");
    case "auth/api-key-not-valid":
    case "auth/invalid-api-key":
    case "auth/configuration-not-found":
      return issue("NOT_CONFIGURED");
    default:
      return issue("UNKNOWN");
  }
}

/** Only these fields are ever taken from the Firebase user object. */
export function toSessionUser(fb: { uid?: unknown; email?: unknown; displayName?: unknown; emailVerified?: unknown } | null | undefined): SessionUser | null {
  if (!fb || typeof fb.uid !== "string" || fb.uid.length === 0 || fb.uid.length > 128) return null;
  return {
    uid: fb.uid,
    email: typeof fb.email === "string" ? fb.email : null,
    displayName: typeof fb.displayName === "string" ? fb.displayName : null,
    emailVerified: fb.emailVerified === true
  };
}

export function reduceSession(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case "CONFIG_MISSING":
      return { status: "UNCONFIGURED", user: null, issue: issue("NOT_CONFIGURED") };
    case "AUTH_STATE":
      if (state.status === "UNCONFIGURED") return state; // nothing can sign in without configuration
      return event.user
        ? { status: "SIGNED_IN", user: event.user, issue: null }
        : { status: "SIGNED_OUT", user: null, issue: state.status === "LOADING" ? null : state.issue };
    case "LISTENER_ERROR":
      return { status: "SIGNED_OUT", user: null, issue: event.issue };
    case "SIGN_IN_FAILED":
      if (state.status === "UNCONFIGURED") return state;
      return { status: "SIGNED_OUT", user: null, issue: event.issue };
    case "SESSION_REJECTED":
      // The backend refused a freshly refreshed token: the local session is no longer usable. Signed out, with the reason.
      if (state.status !== "SIGNED_IN") return state;
      return { status: "SIGNED_OUT", user: null, issue: issue(event.reason === "EXPIRED" ? "SESSION_EXPIRED" : "TOKEN_INVALID") };
    case "ISSUE_SEEN":
      return state.issue ? { ...state, issue: null } : state;
    default:
      return state;
  }
}

/** Resolves once the session has left LOADING (used by the API client so no protected request is sent before auth is known). */
export function isReady(status: AuthStatus): boolean {
  return status !== "LOADING";
}

/** The profile shown in the UI is derived from the Firebase user; the role is always "user" (privilege lives on the server). */
export function profileFromSession(user: SessionUser, stored: Record<string, unknown> | null): Record<string, unknown> {
  const sameUser = stored && stored.id === user.uid;
  const keep = (k: string, fallback: unknown) => (sameUser && stored && stored[k] !== undefined ? stored[k] : fallback);
  const fallbackName = user.displayName || (user.email ? user.email.split("@")[0] : "") || "Researcher";
  return {
    id: user.uid,
    name: user.displayName || (sameUser && typeof stored?.name === "string" ? stored.name : fallbackName),
    email: user.email || "",
    bio: keep("bio", "Learning emerging technology through simplified research discoveries."),
    interests: keep("interests", ["AI / ML"]),
    profileImage: keep("profileImage", ""),
    role: "user",
    phoneNumber: keep("phoneNumber", undefined),
    country: keep("country", undefined),
    language: keep("language", "English"),
    subscription: undefined // never carried from device storage: entitlement is a server matter
  };
}
