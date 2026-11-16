import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Logo } from "@/components/Logo";
import { Avatar, Dropdown } from "@/components/ui";
import type { PState } from "@/components/ui/Button";
import { radius, spacing, tokens } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { NavKey, activeKey, railItems } from "@/services/nav/items";
import { PERSONA_LABEL } from "@/services/social/format";

/** The desktop navigation: a fixed left rail with every destination, unread badges, and the profile menu. Shown from laptop width up. */
export function AppRail({ segments }: { segments: readonly string[] }) {
  const { colors, fontSizeScale: k } = useTheme();
  const { counters, isAdmin, profile } = useProfile();
  const { user, logout } = useAuth();
  const active: NavKey | null = activeKey(segments);
  const name = profile?.displayName || user?.displayName || user?.email || "Account";
  return (
    <SafeAreaView edges={["top", "bottom", "left"]} style={[s.rail, { backgroundColor: colors.surface, borderRightColor: colors.border }]} role="navigation" aria-label="Main navigation">
      <Pressable onPress={() => router.push("/(tabs)/dashboard" as never)} accessibilityRole="link" accessibilityLabel="shoRDs home" style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.md, alignSelf: "flex-start" }}><Logo showName inline /></Pressable>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: spacing.sm, gap: 2 }} showsVerticalScrollIndicator={false}>
        {railItems(isAdmin).map((i) => {
          const on = i.key === active;
          const count = i.badge ? counters[i.badge] : 0;
          return (
            <Pressable key={i.key} onPress={() => router.push(i.route as never)} accessibilityRole="link" accessibilityState={{ selected: on }} aria-current={on ? "page" : undefined} accessibilityLabel={count > 0 ? `${i.label}, ${count} unread` : i.label}
              style={({ hovered, focused }: PState) => [s.item, on && { backgroundColor: colors.primary + "1A" }, !on && hovered && { backgroundColor: colors.card }, focused && { borderColor: tokens.focusRing }]}>
              <Ionicons name={i.icon} size={19} color={on ? colors.primary : colors.muted} />
              <Text style={{ flex: 1, color: on ? colors.text : colors.muted, fontWeight: on ? tokens.weight.bold : tokens.weight.medium, fontSize: tokens.fontSize.sm * k }}>{i.label}</Text>
              {count > 0 ? <View style={[s.badge, { backgroundColor: tokens.danger }]}><Text style={{ color: "#fff", fontSize: 11, fontWeight: tokens.weight.bold }}>{count > 99 ? "99+" : count}</Text></View> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={{ padding: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Dropdown align="left" accessibilityLabel="Account menu"
          trigger={<View style={s.account}><Avatar name={name} uri={profile?.photoUrl} size={34} /><View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: colors.text, fontWeight: tokens.weight.semibold, fontSize: tokens.fontSize.sm * k }}>{name}</Text><Text numberOfLines={1} style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k }}>{profile?.verifiedMentor ? "Verified mentor" : isAdmin ? "Administrator" : profile?.persona ? PERSONA_LABEL[profile.persona] : "Member"}</Text></View><Ionicons name="chevron-up" size={16} color={colors.muted} /></View>}
          items={[
            { label: "View profile", icon: "person-outline", onPress: () => router.push("/(tabs)/profile" as never) },
            { label: "Edit profile", icon: "create-outline", onPress: () => router.push("/profile/edit" as never) },
            { label: "Contact", icon: "mail-outline", onPress: () => router.push("/(tabs)/contact" as never) },
            { label: "Sign out", icon: "log-out-outline", danger: true, onPress: () => { void logout(); } }
          ]}
        />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  rail: { width: tokens.rail.width, borderRightWidth: 1 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, minHeight: 42, borderRadius: radius.md, borderWidth: 1, borderColor: "transparent" },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  account: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 6, width: tokens.rail.width - 2 * spacing.sm - 4 }
});
