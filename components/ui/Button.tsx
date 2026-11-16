import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, Pressable, PressableStateCallbackType, StyleSheet, Text } from "react-native";
import { radius, tokens } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import { webTransition } from "./motion";

export type IconName = keyof typeof Ionicons.glyphMap;
/** react-native-web adds hover and focus state to Pressable; the native types do not know about them, so both are optional here. */
export type PState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };
export type ButtonKind = "primary" | "secondary" | "danger" | "ghost";

/** The one button. 44px minimum touch height, visible focus ring on web, spinner while loading, never triggers while disabled or loading. */
export function Button({ label, onPress, kind = "primary", loading, disabled, icon, iconRight, small, fullWidth, accessibilityHint }: {
  label: string; onPress: () => void; kind?: ButtonKind; loading?: boolean; disabled?: boolean; icon?: IconName; iconRight?: IconName; small?: boolean; fullWidth?: boolean; accessibilityHint?: string;
}) {
  const { colors, fontSizeScale: k, theme } = useTheme();
  const bg = kind === "primary" ? colors.primary : kind === "danger" ? tokens.danger : "transparent";
  const fg = kind === "primary" || kind === "danger" ? (kind === "primary" && theme === "contrast" ? "#000000" : "#FFFFFF") : kind === "ghost" ? colors.accent : colors.text;
  const off = !!(disabled || loading);
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint} accessibilityState={{ disabled: off, busy: !!loading }} aria-disabled={off} aria-busy={!!loading}
      style={({ pressed, hovered, focused }: PState) => [
        s.btn, webTransition, small && s.small, fullWidth && { alignSelf: "stretch" },
        { backgroundColor: bg, borderColor: kind === "secondary" ? colors.border : bg, opacity: off ? 0.5 : pressed ? 0.88 : 1 },
        kind === "secondary" && hovered && !off && { backgroundColor: colors.surface },
        kind === "primary" && hovered && !off && { opacity: 0.94 },
        pressed && !off && { transform: [{ scale: 0.97 }] },
        hovered && !off && kind !== "ghost" && { transform: [{ translateY: -1 }] },
        focused && { borderColor: tokens.focusRing, borderWidth: 2 }
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={fg} /> : icon ? <Ionicons name={icon} size={small ? 15 : 17} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: tokens.weight.semibold, fontSize: (small ? tokens.fontSize.sm : tokens.fontSize.md) * k }}>{label}</Text>
      {iconRight && !loading ? <Ionicons name={iconRight} size={small ? 15 : 17} color={fg} /> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: 18, minHeight: tokens.minTouch, alignSelf: "flex-start" },
  small: { paddingVertical: 7, paddingHorizontal: 12, minHeight: 36 }
});
