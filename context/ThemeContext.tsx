import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors as defaultColors } from "../constants/theme";

export const themes = {
  dark: {
    ...defaultColors,
    cardGradient: ["rgba(6,182,212,0.14)", "rgba(124,58,237,0.08)", "rgba(21,27,47,0.95)"]
  },
  light: {
    background: "#F8FAFC",
    surface: "#F1F5F9",
    card: "#FFFFFF",
    cardElevated: "#E2E8F0",
    ink: "#0F172A",
    primary: "#7C3AED",
    accent: "#0891B2",
    accentSoft: "#06B6D4",
    success: "#10B981",
    warning: "#D97706",
    text: "#0F172A",
    muted: "#475569",
    subdued: "#64748B",
    border: "rgba(15, 23, 42, 0.12)",
    overlay: "rgba(15, 23, 42, 0.45)",
    cardGradient: ["rgba(6,182,212,0.08)", "rgba(124,58,237,0.04)", "rgba(255,255,255,0.96)"]
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

export const fontScaleNames = {
  small: 0.85,
  medium: 1.0,
  large: 1.15,
  xlarge: 1.3
};

export type FontScaleType = keyof typeof fontScaleNames;

type ThemeContextType = {
  theme: ThemeType;
  colors: typeof themes["dark"];
  setTheme: (theme: ThemeType) => void;
  fontSizeScale: number;
  fontScaleType: FontScaleType;
  setFontScale: (scale: FontScaleType) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeType>("light");
  const [fontScaleType, setFontScaleState] = useState<FontScaleType>("medium");

  useEffect(() => {
    AsyncStorage.getItem("shords.theme").then((val) => {
      if (val && val in themes) {
        setThemeState(val as ThemeType);
      } else {
        setThemeState("light");
      }
    });
    AsyncStorage.getItem("shords.fontScale").then((val) => {
      if (val && val in fontScaleNames) {
        setFontScaleState(val as FontScaleType);
      }
    });
  }, []);

  const setTheme = async (newTheme: ThemeType) => {
    setThemeState(newTheme);
    await AsyncStorage.setItem("shords.theme", newTheme);
  };

  const setFontScale = async (newScale: FontScaleType) => {
    setFontScaleState(newScale);
    await AsyncStorage.setItem("shords.fontScale", newScale);
  };

  const colors = themes[theme];
  const fontSizeScale = fontScaleNames[fontScaleType];

  return (
    <ThemeContext.Provider
      value={{
        theme,
        colors,
        setTheme,
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
