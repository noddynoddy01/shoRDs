import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs, router } from "expo-router";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PState } from "../../components/ui/Button";
import { tokens } from "../../constants/theme";
import { useProfile } from "../../context/ProfileContext";
import { useTheme } from "../../context/ThemeContext";
import { dockItems } from "../../services/nav/items";
import { breakpointFor, usesRail } from "../../services/ui/breakpoints";

/**
 * Phones and tablets: a solid bottom bar attached to the screen edge (not a floating pill), with labels, an unread badge on Mentors, and the
 * Assistant as its own destination (so there is no floating help button to overlap content, the keyboard or a message composer).
 * Laptop width and up: the left navigation rail (components/nav/AppRail, mounted in app/_layout.tsx) replaces the bar, so nothing is drawn here.
 */
function BottomBar({ state, navigation }: { state: { index: number; routes: { key: string; name: string }[] }; navigation: { emit: (e: unknown) => { defaultPrevented: boolean }; navigate: (name: string) => void } }) {
  const { colors, fontSizeScale: k } = useTheme();
  const { counters } = useProfile();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  if (usesRail(breakpointFor(width))) return null;
  const current = state.routes[state.index]?.name;
  const unread = counters.notifications + counters.messages;
  const nameOf: Record<string, string> = { dashboard: "dashboard", research: "index", explore: "explore", mentors: "mentors", profile: "profile" };
  return (
    <View style={[s.bar, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 6) }]} accessibilityRole="tablist">
      {dockItems().map((item) => {
        const routeName = nameOf[item.key];
        const focused = routeName ? current === routeName : false;
        const route = routeName ? state.routes.find((r) => r.name === routeName) : undefined;
        const onPress = () => {
          if (item.key === "assistant") { router.push("/assistant" as never); return; }
          if (!route) return;
          const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !e.defaultPrevented) navigation.navigate(route.name);
        };
        const badge = item.key === "mentors" ? unread : 0;
        return (
          <Pressable key={item.key} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: focused }} aria-selected={focused} accessibilityLabel={badge > 0 ? `${item.label}, ${badge} unread` : item.label}
            style={({ hovered, focused: f }: PState) => [s.tab, hovered && { backgroundColor: colors.surface }, f && { borderColor: tokens.focusRing, borderWidth: 2 }]}>
            <View>
              <Ionicons name={item.icon} size={22} color={focused ? colors.primary : colors.subdued} />
              {badge > 0 ? <View style={[s.badge, { backgroundColor: tokens.danger }]}><Text style={{ color: "#fff", fontSize: 10, fontWeight: tokens.weight.bold }}>{badge > 99 ? "99+" : badge}</Text></View> : null}
            </View>
            <Text numberOfLines={1} style={{ color: focused ? colors.primary : colors.subdued, fontSize: 10.5 * k, fontWeight: focused ? tokens.weight.bold : tokens.weight.medium }}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <BottomBar {...(props as unknown as Parameters<typeof BottomBar>[0])} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="dashboard" options={{ title: "Dashboard" }} />
      <Tabs.Screen name="index" options={{ title: "Research" }} />
      <Tabs.Screen name="explore" options={{ title: "Explore" }} />
      <Tabs.Screen name="mentors" options={{ title: "Mentors" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
      <Tabs.Screen name="upload" options={{ title: "Upload", href: null }} />
      <Tabs.Screen name="contact" options={{ title: "Contact", href: null }} />
    </Tabs>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", borderTopWidth: 1, paddingTop: 6 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, minHeight: 52, borderRadius: 10, borderWidth: 1, borderColor: "transparent", marginHorizontal: 2 },
  badge: { position: "absolute", top: -4, right: -10, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" }
});
