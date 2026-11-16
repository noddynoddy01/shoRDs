/**
 * The navigation model: one list of destinations shared by the desktop rail and the mobile bar, with the rules for which are shown and which is active.
 * Pure (no React, no router), so a test can prove every destination resolves to a real screen file and that no two entries point at the same place.
 */
export type NavKey = "dashboard" | "research" | "explore" | "mentors" | "mentorship" | "messages" | "notifications" | "assistant" | "upload" | "profile" | "review";
export type NavIcon = "grid-outline" | "newspaper-outline" | "compass-outline" | "people-outline" | "git-compare-outline" | "chatbubbles-outline" | "notifications-outline" | "help-buoy-outline" | "cloud-upload-outline" | "person-outline" | "shield-checkmark-outline";
export type Badge = "messages" | "notifications" | null;

export type NavItem = { key: NavKey; label: string; icon: NavIcon; route: string; badge: Badge; adminOnly?: boolean };

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "grid-outline", route: "/(tabs)/dashboard", badge: null },
  { key: "research", label: "Research", icon: "newspaper-outline", route: "/(tabs)", badge: null },
  { key: "explore", label: "Explore", icon: "compass-outline", route: "/(tabs)/explore", badge: null },
  { key: "mentors", label: "Mentors", icon: "people-outline", route: "/(tabs)/mentors", badge: null },
  { key: "mentorship", label: "Mentorship", icon: "git-compare-outline", route: "/mentorship", badge: null },
  { key: "messages", label: "Messages", icon: "chatbubbles-outline", route: "/messages", badge: "messages" },
  { key: "notifications", label: "Notifications", icon: "notifications-outline", route: "/notifications", badge: "notifications" },
  { key: "assistant", label: "Assistant", icon: "help-buoy-outline", route: "/assistant", badge: null },
  { key: "upload", label: "Upload a paper", icon: "cloud-upload-outline", route: "/(tabs)/upload", badge: null },
  { key: "profile", label: "Profile", icon: "person-outline", route: "/(tabs)/profile", badge: null },
  { key: "review", label: "Mentor applications", icon: "shield-checkmark-outline", route: "/mentor/review", badge: null, adminOnly: true }
];

/** The bottom bar on phones and tablets: five tabs plus the Assistant (its own screen). Everything else is reachable from the dashboard and the profile menu. */
export const DOCK_KEYS: readonly NavKey[] = ["dashboard", "research", "explore", "mentors", "assistant", "profile"];

/** Administrator-only entries appear only when the SERVER said the person is an administrator. Hiding is a convenience; the server enforces access. */
export function railItems(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin === true);
}
export const dockItems = (): NavItem[] => DOCK_KEYS.map((k) => NAV_ITEMS.find((i) => i.key === k)!);

/** Which destination is current, from expo-router segments. Unknown routes (a paper, a chat) highlight the closest parent area. */
export function activeKey(segments: readonly string[]): NavKey | null {
  const [a, b] = segments;
  if (a === "(tabs)") {
    switch (b) {
      case "dashboard": return "dashboard";
      case undefined: case "index": return "research";
      case "explore": return "explore";
      case "mentors": return "mentors";
      case "upload": return "upload";
      case "profile": return "profile";
      default: return null;
    }
  }
  switch (a) {
    case "mentors": return "mentors";
    case "mentorship": return "mentorship";
    case "messages": return "messages";
    case "notifications": return "notifications";
    case "assistant": return "assistant";
    case "profile": return "profile";
    case "mentor": return b === "review" ? "review" : "mentors";
    case "paper": case "research": case "search": case "chat": return "research";
    default: return null;
  }
}

/** Routes on which the rail is not shown: the public landing page, sign-in and the guided setup. */
const NO_CHROME = new Set(["", "index", "auth", "onboarding"]);
export const showsChrome = (segments: readonly string[]): boolean => !NO_CHROME.has(segments.length > 0 ? segments[0] : "");

/** The screen file (relative to app/) each route string resolves to, for the route-resolution test. */
export function routeFileCandidates(route: string): string[] {
  const clean = route.replace(/^\//, "");
  if (clean === "(tabs)") return ["(tabs)/index.tsx"];
  return [`${clean}.tsx`, `${clean}/index.tsx`];
}
