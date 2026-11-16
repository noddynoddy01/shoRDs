import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from "react-native";
import { Screen } from "@/components/Screen";
import { spacing, tokens } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import type { PState } from "./Button";
import { Card } from "./Surface";
import { FadeIn } from "./motion";

/** A screen title row: optional back button, title, subtitle, right-hand actions. One heading per screen. */
export function PageHeader({ title, subtitle, right, onBack, back = true }: { title: string; subtitle?: string; right?: ReactNode; onBack?: () => void; back?: boolean }) {
  const { colors, fontSizeScale: k } = useTheme();
  const go = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/dashboard" as never);
  };
  return (
    <View style={s.header}>
      {back ? (
        <Pressable onPress={go} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={10} style={({ hovered }: PState) => [s.iconBtn, { borderColor: colors.border, backgroundColor: hovered ? colors.surface : colors.card }]}>
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: tokens.fontSize.xl * k, fontWeight: tokens.weight.heavy, letterSpacing: -0.2 }} numberOfLines={1} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={{ color: colors.muted, fontSize: tokens.fontSize.xs * k, marginTop: 1 }} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** A section within a screen: small title, optional link/action on the right. */
export function SectionHeader({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  const { colors, fontSizeScale: k } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: tokens.fontSize.lg * k, fontWeight: tokens.weight.bold }}>{title}</Text>
      {action ? <Pressable onPress={action.onPress} accessibilityRole="link" hitSlop={8}><Text style={{ color: colors.accent, fontSize: tokens.fontSize.sm * k, fontWeight: tokens.weight.semibold }}>{action.label}</Text></Pressable> : null}
    </View>
  );
}

/** A community screen: header + scrolling body with a readable maximum width on large screens. */
export function Page({ title, subtitle, right, children, scroll = true, onBack, footer, wide, back = true }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode; scroll?: boolean; onBack?: () => void; footer?: ReactNode; wide?: boolean; back?: boolean }) {
  return (
    <Screen maxWidth={wide ? 1080 : 860}>
      <PageHeader title={title} subtitle={subtitle} right={right} onBack={onBack} back={back} />
      {scroll ? (
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><FadeIn style={{ gap: spacing.md }}>{children}</FadeIn></ScrollView>
      ) : (
        <View style={[s.body, { flex: 1 }]}>{children}</View>
      )}
      {footer}
    </Screen>
  );
}

/** Two columns from tablet width up, one column below; children share the width equally. */
export function Columns({ children, gap = spacing.md, style }: { children: ReactNode; gap?: number; style?: ViewStyle }) {
  const { width } = useWindowDimensions();
  const wide = width >= tokens.breakpoints.tablet;
  return <View style={[{ flexDirection: wide ? "row" : "column", gap, alignItems: wide ? "stretch" : "stretch", flexWrap: "wrap" }, style]}>{children}</View>;
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: spacing.sm }, style]}>{children}</View>;
}

/** A figure with a caption (counts, completion). Shows "—" rather than a made-up number when the value is unknown. */
export function Stat({ label, value, hint, onPress }: { label: string; value: number | string | null; hint?: string; onPress?: () => void }) {
  const { colors, fontSizeScale: k } = useTheme();
  return (
    <Card onPress={onPress} accessibilityLabel={`${label}: ${value ?? "unknown"}`} style={{ flex: 1, minWidth: 140 }}>
      <Text style={{ color: colors.muted, fontSize: tokens.fontSize.xs * k, fontWeight: tokens.weight.semibold, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: tokens.fontSize.xxl * k, fontWeight: tokens.weight.heavy }}>{value === null ? "—" : value}</Text>
      {hint ? <Text style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k }}>{hint}</Text> : null}
    </Card>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: spacing.md, paddingBottom: 120 }
});
