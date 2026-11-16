/**
 * Route guard: a pure function from (auth status, current route segments) to what the router should do.
 *
 *   LOADING                -> WAIT (render a neutral splash; never redirect while auth is still being resolved)
 *   SIGNED_OUT/UNCONFIGURED-> only the landing page and /auth are reachable; everything else goes to /auth
 *   SIGNED_IN              -> the app; the landing page and /auth redirect into the app
 *
 * Onboarding (optional input): a signed-in person whose shoRDs profile is not finished is taken to /onboarding once; the screen allows
 * "skip for now" (state SKIPPED), after which the app is fully reachable, so onboarding can never trap anyone. The server, not this guard,
 * enforces what an unfinished profile may do (no mentorship or messaging).
 *
 * Property (tested): applying a REDIRECT and deciding again on the target always yields ALLOW, so no state can loop.
 */

export type RouteDecision = { action: "ALLOW" } | { action: "WAIT" } | { action: "REDIRECT"; to: string };

export const AUTH_ROUTE = "/auth";
export const APP_HOME = "/(tabs)/dashboard";

type Status = "LOADING" | "SIGNED_OUT" | "SIGNED_IN" | "UNCONFIGURED";
/** UNKNOWN: not loaded yet (never redirects). REQUIRED: no finished profile. SKIPPED: the person chose to continue without one. DONE: finished. */
export type OnboardingState = "UNKNOWN" | "REQUIRED" | "SKIPPED" | "DONE";
export const ONBOARDING_ROUTE = "/onboarding";

/** expo-router segments for a path: "/" -> [], "/auth" -> ["auth"], "/(tabs)/explore" -> ["(tabs)","explore"]. */
export function decideRoute(input: { status: Status; segments: readonly string[]; onboarding?: OnboardingState }): RouteDecision {
  const { status, segments } = input;
  const onboarding = input.onboarding || "UNKNOWN";
  const first = segments.length > 0 ? segments[0] : "";
  const isLanding = segments.length === 0 || (segments.length === 1 && first === "index");
  const isAuth = first === "auth";

  if (status === "LOADING") return { action: "WAIT" };
  if (status === "SIGNED_IN") {
    if (onboarding === "REQUIRED" && first !== "onboarding") return { action: "REDIRECT", to: ONBOARDING_ROUTE };
    if (isLanding || isAuth) return { action: "REDIRECT", to: APP_HOME };
    return { action: "ALLOW" };
  }
  // SIGNED_OUT or UNCONFIGURED
  if (isLanding || isAuth) return { action: "ALLOW" };
  return { action: "REDIRECT", to: AUTH_ROUTE };
}

/**
 * On a full page load of a deep link (refresh, a shared link, a bookmark) the router reports NO segments for a moment, which looks exactly
 * like the landing page, so a signed-in person was redirected to the dashboard and lost the page they asked for. When the browser's real
 * path is not the landing page but the router still reports none, the router has not caught up: wait, never decide.
 */
export function routerBehindUrl(segments: readonly string[], urlPath: string | null | undefined): boolean {
  if (segments.length > 0 || !urlPath) return false;
  const p = urlPath.replace(/\/+$/, "");
  return p !== "" && p !== "/index";
}

/** The segments a redirect target lands on (to prove the no-loop property in tests). */
export function segmentsOf(path: string): string[] {
  return path.split("/").filter(Boolean);
}
