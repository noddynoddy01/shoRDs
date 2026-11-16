import React, { createContext, useContext, useEffect, useState } from "react";
import { Appearance, Platform, useWindowDimensions } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors as defaultColors } from "../constants/theme";

export const themes = {
  dark: {
    ...defaultColors,
    cardGradient: ["rgba(255,255,255,0.02)", "rgba(255,255,255,0.01)", "rgba(15,20,35,0.98)"]
  },
  light: {
    background: "#F8FAFC",
    surface: "#F1F5F9",
    card: "#FFFFFF",
    cardElevated: "#E2E8F0",
    ink: "#0F172A",
    primary: "#3B82F6",
    accent: "#0284C7",
    accentSoft: "#0EA5E9",
    success: "#10B981",
    warning: "#F59E0B",
    text: "#0F172A",
    muted: "#475569",
    subdued: "#64748B",
    border: "rgba(15, 23, 42, 0.08)",
    overlay: "rgba(15, 23, 42, 0.4)",
    cardGradient: ["rgba(255,255,255,0.99)", "rgba(248,250,252,0.98)"]
  },
  nord: {
    background: "#2E3440",
    surface: "#3B4252",
    card: "#434C5E",
    cardElevated: "#4C566A",
    ink: "#D8DEE9",
    primary: "#88C0D0",
    accent: "#81A1C1",
    accentSoft: "#8FBCBB",
    success: "#A3BE8C",
    warning: "#EBCB8B",
    text: "#ECEFF4",
    muted: "#D8DEE9",
    subdued: "#8892B0",
    border: "rgba(216, 222, 233, 0.14)",
    overlay: "rgba(46, 52, 64, 0.65)",
    cardGradient: ["rgba(136,192,208,0.12)", "rgba(129,161,193,0.06)", "rgba(67,76,94,0.96)"]
  },
  sepia: {
    background: "#F5ECD7",
    surface: "#EADFC9",
    card: "#FBF7EF",
    cardElevated: "#E1D5BD",
    ink: "#433422",
    primary: "#8B5A2B",
    accent: "#A0522D",
    accentSoft: "#CD853F",
    success: "#556B2F",
    warning: "#B8860B",
    text: "#4E3629",
    muted: "#5C4033",
    subdued: "#8B7355",
    border: "rgba(91, 70, 50, 0.14)",
    overlay: "rgba(91, 70, 50, 0.4)",
    cardGradient: ["rgba(160,82,45,0.08)", "rgba(205,133,63,0.04)", "rgba(251,247,239,0.96)"]
  },
  contrast: {
    background: "#000000",
    surface: "#0A0A0A",
    card: "#121212",
    cardElevated: "#1E1E1E",
    ink: "#FFFFFF",
    primary: "#FFD60A",
    accent: "#4FD1FF",
    accentSoft: "#9BE7FF",
    success: "#3DDC84",
    warning: "#FFB020",
    text: "#FFFFFF",
    muted: "#E5E7EB",
    subdued: "#B6BCC6",
    border: "rgba(255, 255, 255, 0.45)",
    overlay: "rgba(0, 0, 0, 0.85)",
    cardGradient: ["rgba(255,255,255,0.04)", "rgba(255,255,255,0.02)", "rgba(18,18,18,0.98)"]
  },
  emerald: {
    background: "#062419",
    surface: "#0B3526",
    card: "#124835",
    cardElevated: "#1C5E47",
    ink: "#E6F4EA",
    primary: "#10B981",
    accent: "#34D399",
    accentSoft: "#6EE7B7",
    success: "#059669",
    warning: "#D97706",
    text: "#ECFDF5",
    muted: "#A7F3D0",
    subdued: "#34D399",
    border: "rgba(167, 243, 208, 0.14)",
    overlay: "rgba(6, 36, 25, 0.75)",
    cardGradient: ["rgba(52,211,153,0.12)", "rgba(16,185,129,0.06)", "rgba(18,72,53,0.95)"]
  }
};

export type ThemeType = keyof typeof themes;
/** What a person can pick: one of the themes, or "system" to follow the device's light/dark setting. */
export type ThemeChoice = ThemeType | "system";

/** Every choice with a plain name and swatch colours, in the order they are shown. Used by the appearance picker and the reader settings. */
export const THEME_OPTIONS: { key: ThemeChoice; name: string; hint: string; bg: string; fg: string; accent: string }[] = [
  { key: "dark", name: "Dark", hint: "Deep navy, easy at night", bg: "#030712", fg: "#FFFFFF", accent: "#3B82F6" },
  { key: "light", name: "Light", hint: "Clean and bright", bg: "#F8FAFC", fg: "#0F172A", accent: "#3B82F6" },
  { key: "system", name: "Match device", hint: "Follows your phone or computer", bg: "#F8FAFC", fg: "#0F172A", accent: "#030712" },
  { key: "nord", name: "Nord", hint: "Soft arctic blue-grey", bg: "#2E3440", fg: "#ECEFF4", accent: "#88C0D0" },
  { key: "sepia", name: "Sepia", hint: "Warm paper for long reading", bg: "#F5ECD7", fg: "#4E3629", accent: "#8B5A2B" },
  { key: "emerald", name: "Emerald", hint: "Dark green", bg: "#062419", fg: "#ECFDF5", accent: "#10B981" },
  { key: "contrast", name: "High contrast", hint: "Black and yellow, maximum legibility", bg: "#000000", fg: "#FFFFFF", accent: "#FFD60A" }
];

export const fontScaleNames = {
  small: 0.85,
  medium: 1.0,
  large: 1.15,
  xlarge: 1.3
};

export type FontScaleType = keyof typeof fontScaleNames;

/** Extra text scale for wide browser windows: 1 below 1024px, 1.06 from 1024px, 1.12 from 1440px. Always 1 on native. */
export function webWidthBoost(width: number, platform: string = Platform.OS): number {
  if (platform !== "web") return 1;
  return width >= 1440 ? 1.12 : width >= 1024 ? 1.06 : 1;
}

type ThemeContextType = {
  theme: ThemeType;
  colors: typeof themes["dark"];
  /** Pick a theme, or "system" to follow the device. */
  setTheme: (theme: ThemeChoice) => void;
  /** What the person picked (may be "system"); `theme` is the one actually showing. */
  themeChoice: ThemeChoice;
  fontSizeScale: number;
  fontScaleType: FontScaleType;
  setFontScale: (scale: FontScaleType) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>("dark");
  const [deviceScheme, setDeviceScheme] = useState<"dark" | "light">(Appearance.getColorScheme() === "light" ? "light" : "dark");
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => setDeviceScheme(colorScheme === "light" ? "light" : "dark"));
    return () => sub.remove();
  }, []);
  const theme: ThemeType = choice === "system" ? deviceScheme : choice;
  const [fontScaleType, setFontScaleState] = useState<FontScaleType>("medium");

  useEffect(() => {
    AsyncStorage.getItem("shords.theme").then((val) => {
      if (val && (val in themes || val === "system")) {
        setChoice(val as ThemeChoice);
      } else {
        setChoice("dark");
      }
    });
    AsyncStorage.getItem("shords.fontScale").then((val) => {
      if (val && val in fontScaleNames) {
        setFontScaleState(val as FontScaleType);
      }
    });
  }, []);

  const setTheme = async (newTheme: ThemeChoice) => {
    setChoice(newTheme);
    await AsyncStorage.setItem("shords.theme", newTheme);
  };

  const setFontScale = async (newScale: FontScaleType) => {
    setFontScaleState(newScale);
    await AsyncStorage.setItem("shords.fontScale", newScale);
  };

  const colors = themes[theme];
  // On wide web windows the fixed pixel sizes read small, so the scale grows gently with the window (phones and tablets are unchanged).
  const { width: winWidth } = useWindowDimensions();
  const fontSizeScale = fontScaleNames[fontScaleType] * webWidthBoost(winWidth);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        colors,
        setTheme,
        themeChoice: choice,
        fontSizeScale,
        fontScaleType,
        setFontScale
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
