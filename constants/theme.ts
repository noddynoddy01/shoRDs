import { Platform, Dimensions } from "react-native";

export const colors = {
  background: "#030712",
  surface: "#0B0F19",
  card: "#0F1423",
  cardElevated: "#151B30",
  ink: "#F9FAFB",
  primary: "#3B82F6",
  accent: "#06B6D4",
  accentSoft: "#67E8F9",
  success: "#10B981",
  warning: "#F59E0B",
  text: "#FFFFFF",
  muted: "#9CA3AF",
  subdued: "#6B7280",
  border: "rgba(255, 255, 255, 0.06)",
  overlay: "rgba(3, 7, 18, 0.75)"
};

export const spacing = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48
};

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  pill: 9999
};

const isWebOrDesktop = Platform.OS === "web";

export const typography = {
  title: isWebOrDesktop ? 34 : 32,
  heading: isWebOrDesktop ? 24 : 22,
  subheading: isWebOrDesktop ? 18 : 16,
  body: isWebOrDesktop ? 16 : 15,
  caption: isWebOrDesktop ? 14 : 13,
  tiny: isWebOrDesktop ? 12 : 11,
  family: Platform.select({
    web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif',
    ios: "System",
    android: "Roboto",
    default: "System"
  })
};

/**
 * Helper to calculate responsive desktop max widths
 */
export const layout = {
  maxContentWidth: 860,
  maxReaderWidth: 920,
  maxDockWidth: 580,
  isDesktop: () => {
    if (Platform.OS === "web") {
      const { width } = Dimensions.get("window");
      return width >= 768;
    }
    return false;
  }
};

/**
 * Design tokens added for the shared UI kit (components/ui). Colours that change with the theme still come from useTheme(); these are the values that do not:
 * semantic danger, focus ring, type scale, elevation, motion timing, breakpoints and the minimum touch target.
 */
export const tokens = {
  danger: "#DC2626",
  focusRing: "#60A5FA",
  minTouch: 44,
  fontSize: { xs: 12, sm: 13, md: 15, lg: 17, xl: 20, xxl: 28, display: 44 },
  lineHeight: { tight: 1.2, snug: 1.35, normal: 1.5 },
  weight: { regular: "400", medium: "500", semibold: "600", bold: "700", heavy: "800" } as const,
  motion: { fast: 120, base: 200, slow: 320 },
  breakpoints: { tablet: 768, laptop: 1024, desktop: 1440 },
  rail: { width: 248, collapsed: 72 },
  shadow: {
    sm: { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
    md: { shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
    lg: { shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12 }
  }
} as const;
