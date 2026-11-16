import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { radius, spacing, tokens } from "@/constants/theme";
import { THEME_OPTIONS, fontScaleNames, useTheme } from "@/context/ThemeContext";
import type { FontScaleType } from "@/context/ThemeContext";
import type { PState } from "./Button";
import { Modal } from "./Overlay";
import { webTransition } from "./motion";

const SIZES: { key: FontScaleType; label: string }[] = [{ key: "small", label: "A-" }, { key: "medium", label: "Aa" }, { key: "large", label: "A+" }, { key: "xlarge", label: "A++" }];

/** The appearance choices: seven colour themes (including "Match device") and the text size. The choice is remembered on this device. */
export function ThemePicker() {
  const { colors, themeChoice, setTheme, fontScaleType, setFontScale, fontSizeScale: k } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Colour theme" style={{ gap: spacing.xs }}>
        {THEME_OPTIONS.map((o) => {
          const on = themeChoice === o.key;
          return (
            <Pressable key={o.key} onPress={() => setTheme(o.key)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${o.name}. ${o.hint}`}
              style={({ hovered, focused }: PState) => [{ flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? colors.primary : colors.border, backgroundColor: hovered ? colors.surface : "transparent", minHeight: tokens.minTouch }, webTransition, focused && { borderColor: tokens.focusRing }]}>
              <View style={{ width: 46, height: 32, borderRadius: 8, backgroundColor: o.bg, borderWidth: 1, borderColor: colors.border, overflow: "hidden", justifyContent: "center", paddingLeft: 7, gap: 4 }}>
                <View style={{ width: 22, height: 5, borderRadius: 3, backgroundColor: o.fg }} />
                <View style={{ width: 13, height: 5, borderRadius: 3, backgroundColor: o.accent }} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: tokens.weight.bold, fontSize: tokens.fontSize.md * k }}>{o.name}</Text>
                <Text style={{ color: colors.muted, fontSize: tokens.fontSize.xs * k }}>{o.hint}</Text>
              </View>
              {on ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={{ gap: spacing.xs }}>
        <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k, fontWeight: tokens.weight.semibold }}>Text size</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Text size" style={{ flexDirection: "row", gap: spacing.xs }}>
          {SIZES.filter((z) => z.key in fontScaleNames).map((z) => {
            const on = fontScaleType === z.key;
            return (
              <Pressable key={z.key} onPress={() => setFontScale(z.key)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`Text size ${z.label}`}
                style={{ flex: 1, minHeight: tokens.minTouch, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary + "1A" : "transparent" }}>
                <Text style={{ color: colors.text, fontWeight: tokens.weight.bold, fontSize: tokens.fontSize.md * k }}>{z.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

/** A palette button that opens the appearance dialog. `label` adds a text label (used in the desktop rail). */
export function ThemeButton({ label }: { label?: string }) {
  const { colors, fontSizeScale: k } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Appearance: theme and text size" hitSlop={8}
        style={({ hovered, focused }: PState) => [{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: label ? 42 : 36, minWidth: 36, paddingHorizontal: label ? 12 : 6, borderRadius: radius.md, justifyContent: "center", borderWidth: 1, borderColor: "transparent" }, hovered && { backgroundColor: colors.card }, focused && { borderColor: tokens.focusRing }]}>
        <Ionicons name="color-palette-outline" size={label ? 19 : 22} color={label ? colors.muted : colors.text} />
        {label ? <Text style={{ flex: 1, color: colors.muted, fontWeight: tokens.weight.medium, fontSize: tokens.fontSize.sm * k }}>{label}</Text> : null}
      </Pressable>
      <Modal visible={open} title="Appearance" onClose={() => setOpen(false)}><ThemePicker /></Modal>
    </>
  );
}
