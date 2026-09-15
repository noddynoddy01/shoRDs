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
