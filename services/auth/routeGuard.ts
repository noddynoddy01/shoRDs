/**
 * Route guard: a pure function from (auth status, current route segments) to what the router should do.
 *
 *   LOADING                -> WAIT (render a neutral splash; never redirect while auth is still being resolved)
 *   SIGNED_OUT/UNCONFIGURED-> only the landing page and /auth are reachable; everything else goes to /auth
 *   SIGNED_IN              -> the app; the landing page and /auth redirect into the app
 *
 * Property (tested): applying a REDIRECT and deciding again on the target always yields ALLOW, so no state can loop.
 */

export type RouteDecision = { action: "ALLOW" } | { action: "WAIT" } | { action: "REDIRECT"; to: string };

export const AUTH_ROUTE = "/auth";
export const APP_HOME = "/(tabs)";

type Status = "LOADING" | "SIGNED_OUT" | "SIGNED_IN" | "UNCONFIGURED";

/** expo-router segments for a path: "/" -> [], "/auth" -> ["auth"], "/(tabs)/explore" -> ["(tabs)","explore"]. */
export function decideRoute(input: { status: Status; segments: readonly string[] }): RouteDecision {
  const { status, segments } = input;
  const first = segments.length > 0 ? segments[0] : "";
  const isLanding = segments.length === 0 || (segments.length === 1 && first === "index");
  const isAuth = first === "auth";

  if (status === "LOADING") return { action: "WAIT" };
  if (status === "SIGNED_IN") {
    if (isLanding || isAuth) return { action: "REDIRECT", to: APP_HOME };
    return { action: "ALLOW" };
  }
  // SIGNED_OUT or UNCONFIGURED
  if (isLanding || isAuth) return { action: "ALLOW" };
  return { action: "REDIRECT", to: AUTH_ROUTE };
}

/** The segments a redirect target lands on (to prove the no-loop property in tests). */
export function segmentsOf(path: string): string[] {
  return path.split("/").filter(Boolean);
}
