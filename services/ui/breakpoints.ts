/** Responsive classes used across the app. Pure so it is unit-tested; useBreakpoint() wraps it. */
export type Breakpoint = "mobile" | "tablet" | "laptop" | "desktop";
export const BREAKPOINT_MIN = { tablet: 768, laptop: 1024, desktop: 1440 } as const;

export function breakpointFor(width: number): Breakpoint {
  if (!Number.isFinite(width) || width < BREAKPOINT_MIN.tablet) return "mobile";
  if (width < BREAKPOINT_MIN.laptop) return "tablet";
  if (width < BREAKPOINT_MIN.desktop) return "laptop";
  return "desktop";
}
/** The left navigation rail replaces the bottom dock from laptop width up. */
export const usesRail = (b: Breakpoint) => b === "laptop" || b === "desktop";
