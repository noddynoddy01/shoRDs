import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Screen } from "@/components/Screen";
import { MentorCard } from "@/components/social/MentorCard";
import { Banner, Btn, Card, Empty, Loading, Row, Segmented } from "@/components/social/Ui";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { spacing } from "@/constants/theme";
import { describeSocialError } from "@/services/social/format";
import { social } from "@/services/social/instance";
import type { Availability, Profile } from "@/services/social/types";

const PAGE = 12;
type Sort = "recent" | "name" | "availability";

/** The verified-mentor directory. Everything shown comes from the server; only mentors an admin approved are ever returned. */
export default function MentorsScreen() {
  const { colors, fontSizeScale: k } = useTheme();
  const { counters, isAdmin, profile } = useProfile();
  const [q, setQ] = useState("");
  const [domain, setDomain] = useState("");
  const [availability, setAvailability] = useState<"ALL" | Availability>("ALL");
  const [sort, setSort] = useState<Sort>("recent");
  const [items, setItems] = useState<Profile[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (offset: number) => {
    const mine = ++seq.current;
    if (offset === 0) setLoading(true); else setMore(true);
    setError(null);
    try {
      const r = await social.searchMentors({ q: q.trim() || undefined, domain: domain.trim() || undefined, availability: availability === "ALL" ? undefined : availability, sort, limit: PAGE, offset });
      if (mine !== seq.current) return;
      setItems((cur) => (offset === 0 ? r.items : [...cur, ...r.items]));
      setHasMore(r.hasMore);
    } catch (e) { if (mine === seq.current) setError(describeSocialError(e)); }
    finally { if (mine === seq.current) { setLoading(false); setMore(false); } }
  }, [q, domain, availability, sort]);

  useEffect(() => { const t = setTimeout(() => void load(0), 300); return () => clearTimeout(t); }, [load]);

  // With the desktop rail, Messages, Notifications and Mentorship are already one click away; do not repeat them here.
  const { width: vw } = useWindowDimensions();
  const wide = vw >= 1024;
  const hub: { label: string; icon: keyof typeof Ionicons.glyphMap; to: string; badge?: number }[] = [
    { label: "Messages", icon: "chatbubbles-outline", to: "/messages", badge: counters.messages },
    { label: "Notifications", icon: "notifications-outline", to: "/notifications", badge: counters.notifications },
    { label: "Mentorship requests", icon: "mail-unread-outline", to: "/mentorship/requests" },
    { label: "My mentorships", icon: "people-circle-outline", to: "/mentorship" },
    { label: profile?.verifiedMentor ? "Mentor status" : "Become a mentor", icon: "ribbon-outline", to: "/mentor/application" },
    ...(isAdmin ? [{ label: "Review mentor applications", icon: "shield-checkmark-outline" as const, to: "/mentor/review" }] : [])
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.text, fontSize: 26 * k, fontWeight: "800" }} accessibilityRole="header">Mentors</Text>
        <Row style={{ flexWrap: "wrap" }}>
          {hub.filter((h) => !wide || !["/messages", "/notifications", "/mentorship"].includes(h.to)).map((h) => (
            <Pressable key={h.to} onPress={() => router.push(h.to as never)} accessibilityRole="button" accessibilityLabel={h.badge ? `${h.label}, ${h.badge} unread` : h.label}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
              <Ionicons name={h.icon} size={16} color={colors.text} />
              <Text style={{ color: colors.text, fontSize: 13 * k, fontWeight: "600" }}>{h.label}</Text>
              {h.badge ? <View style={{ backgroundColor: "#DC2626", borderRadius: 9, minWidth: 18, paddingHorizontal: 5, alignItems: "center" }}><Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{h.badge > 99 ? "99+" : h.badge}</Text></View> : null}
            </Pressable>
          ))}
        </Row>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <View style={{ flex: 2, minWidth: 260, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, backgroundColor: colors.surface }}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search by name, expertise or institution" placeholderTextColor={colors.subdued} accessibilityLabel="Search mentors" style={{ flex: 1, color: colors.text, paddingVertical: 12, fontSize: 15 * k }} returnKeyType="search" />
        </View>
        <TextInput value={domain} onChangeText={setDomain} placeholder="Filter by research domain" placeholderTextColor={colors.subdued} accessibilityLabel="Filter by research domain" style={{ flex: 1, minWidth: 220, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, backgroundColor: colors.surface, fontSize: 15 * k }} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 280 }}><Segmented value={availability} onChange={setAvailability} options={[{ value: "ALL", label: "Any" }, { value: "AVAILABLE", label: "Available" }, { value: "LIMITED", label: "Limited" }]} /></View>
        <View style={{ flex: 1, minWidth: 280 }}><Segmented value={sort} onChange={setSort} options={[{ value: "recent", label: "Recently active" }, { value: "name", label: "Name" }, { value: "availability", label: "Availability" }]} /></View>
        </View>

        {error ? <Banner text={error} action={{ label: "Retry", onPress: () => void load(0) }} /> : null}
        {loading ? <Loading label="Finding mentors…" /> : items.length === 0 && !error ? (
          <Empty icon="people-outline" title="No verified mentors match" text={q || domain || availability !== "ALL" ? "Try clearing a filter." : "No mentor has been approved yet. Mentors appear here only after an administrator reviews their application."} action={!profile?.verifiedMentor ? <Btn kind="secondary" label="Apply to be a mentor" onPress={() => router.push("/mentor/application" as never)} /> : undefined} />
        ) : (
          <>
            {items.map((m) => <MentorCard key={m.uid} m={m} />)}
            {hasMore && <Btn kind="secondary" label="Load more" onPress={() => void load(items.length)} loading={more} />}
          </>
        )}
        <Card><Text style={{ color: colors.muted, fontSize: 12 * k }}>Only mentors approved by a shoRDs administrator are listed. Mentorship is a conversation between people; shoRDs does not guarantee a reply.</Text></Card>
      </ScrollView>
    </Screen>
  );
}
