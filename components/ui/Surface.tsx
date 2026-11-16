import Ionicons from "@expo/vector-icons/Ionicons";
import { ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";
import { radius, spacing, tokens } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import { initials } from "@/services/social/format";
import type { IconName, PState } from "./Button";
import { usePulse, webTransition } from "./motion";

/** A bordered content surface. Flat (no gradient, no blur); with `onPress` it is a button with hover and focus states. */
export function Card({ children, style, onPress, accessibilityLabel, padded = true }: { children: ReactNode; style?: ViewStyle; onPress?: () => void; accessibilityLabel?: string; padded?: boolean }) {
  const { colors } = useTheme();
  const base: ViewStyle[] = [{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, gap: spacing.sm }, padded ? { padding: spacing.md } : {}, style ?? {}];
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
        style={({ pressed, hovered, focused }: PState) => [...base, webTransition, hovered && { borderColor: colors.primary + "66", transform: [{ translateY: -2 }] }, pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] }, focused && { borderColor: tokens.focusRing, borderWidth: 2 }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={base}>{children}</View>;
}

export function Avatar({ name, uri, size = 44 }: { name: string; uri?: string | null; size?: number }) {
  const { colors } = useTheme();
  return uri && /^https:\/\//.test(uri) ? (
    <Image source={{ uri }} accessibilityLabel={name} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.cardElevated }} />
  ) : (
    <View accessibilityLabel={name} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primary + "22", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.primary, fontWeight: tokens.weight.heavy, fontSize: size * 0.36 }}>{initials(name)}</Text>
    </View>
  );
}

export type BadgeTone = "neutral" | "good" | "warn" | "bad" | "accent";
export function Badge({ label, tone = "neutral", icon }: { label: string; tone?: BadgeTone; icon?: IconName }) {
  const { colors, fontSizeScale: k } = useTheme();
  const c = tone === "good" ? colors.success : tone === "warn" ? colors.warning : tone === "bad" ? tokens.danger : tone === "accent" ? colors.accent : colors.muted;
  return (
    <View style={[s.badge, { borderColor: c + "55", backgroundColor: c + "14" }]}>
      {icon ? <Ionicons name={icon} size={12} color={c} /> : null}
      <Text style={{ color: c, fontSize: 11 * k, fontWeight: tokens.weight.bold }}>{label}</Text>
    </View>
  );
}

export function Pills({ items, tone }: { items: string[]; tone?: "accent" }) {
  const { colors, fontSizeScale: k } = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {items.map((t) => (
        <View key={t} style={[s.pill, { borderColor: colors.border, backgroundColor: tone === "accent" ? colors.accent + "14" : colors.surface }]}>
          <Text style={{ color: colors.text, fontSize: tokens.fontSize.xs * k }}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

export function EmptyState({ icon = "file-tray-outline", title, text, action }: { icon?: IconName; title: string; text?: string; action?: ReactNode }) {
  const { colors, fontSizeScale: k } = useTheme();
  return (
    <View style={s.empty}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={26} color={colors.muted} />
      </View>
      <Text style={{ color: colors.text, fontSize: tokens.fontSize.lg * k, fontWeight: tokens.weight.bold, textAlign: "center" }}>{title}</Text>
      {text ? <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k, lineHeight: 20 * k, textAlign: "center", maxWidth: 420 }}>{text}</Text> : null}
      {action ? <View style={{ alignSelf: "center", marginTop: spacing.xs }}>{action}</View> : null}
    </View>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  const { colors, fontSizeScale: k } = useTheme();
  return (
    <View style={s.empty} accessibilityLabel={label} accessibilityRole="progressbar">
      <ActivityIndicator color={colors.accent} />
      <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k }}>{label}</Text>
    </View>
  );
}

/** Placeholder blocks shown while content loads (they pulse, or stay still under reduced motion). */
export function Skeleton({ height = 16, width = "100%", radiusPx = 8, style }: { height?: number; width?: number | `${number}%`; radiusPx?: number; style?: ViewStyle }) {
  const { colors } = useTheme();
  const v = usePulse();
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={style}><AnimatedBlock v={v} height={height} width={width} radiusPx={radiusPx} color={colors.cardElevated} /></View>;
}
import { Animated } from "react-native";
function AnimatedBlock({ v, height, width, radiusPx, color }: { v: Animated.Value; height: number; width: number | `${number}%`; radiusPx: number; color: string }) {
  return <Animated.View style={{ height, width, borderRadius: radiusPx, backgroundColor: color, opacity: v }} />;
}

/** A stack of card-shaped skeletons for list screens. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <View style={{ gap: spacing.md }} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: rows }).map((_, i) => (
        <Card key={i}>
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
            <Skeleton width={44} height={44} radiusPx={22} />
            <View style={{ flex: 1, gap: 8 }}><Skeleton height={14} width="55%" /><Skeleton height={12} width="35%" /></View>
          </View>
          <Skeleton height={12} /><Skeleton height={12} width="80%" />
        </Card>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  empty: { alignItems: "center", gap: 10, padding: spacing.xl }
});
