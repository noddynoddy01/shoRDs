import { router } from "expo-router";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Avatar, Badge, Banner, Btn, Card, Empty, Loading, Muted, Page } from "@/components/social/Ui";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { describeSocialError, timeAgo } from "@/services/social/format";
import { social } from "@/services/social/instance";
import type { ConversationSummary } from "@/services/social/types";

const POLL_MS = 8000;

/** Your conversations. This list refreshes by polling every few seconds while the screen is open; it is not a live push connection. */
export default function MessagesScreen() {
  const { colors, fontSizeScale: k } = useTheme();
  const { refreshCounters } = useProfile();
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (quiet: boolean, offset = 0) => {
    if (!quiet) setLoading(true);
    try {
      const r = await social.listConversations(offset);
      setItems((cur) => (offset === 0 ? r.items : [...cur, ...r.items])); setHasMore(r.hasMore); setError(null);
      void refreshCounters();
    } catch (e) { if (!quiet) setError(describeSocialError(e)); } finally { setLoading(false); }
  }, [refreshCounters]);

  useFocusEffect(useCallback(() => {
    void load(false);
    timer.current = setInterval(() => void load(true), POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]));

  return (
    <Page title="Messages" subtitle="Text only · refreshes every few seconds">
      {error ? <Banner text={error} action={{ label: "Retry", onPress: () => void load(false) }} /> : null}
      {loading ? <Loading /> : items.length === 0 && !error ? (
        <Empty icon="chatbubbles-outline" title="No conversations yet" text="A conversation opens when a mentor accepts a request, or when you message someone who accepts direct messages." action={<Btn kind="secondary" label="Browse mentors" onPress={() => router.push("/mentors" as never)} />} />
      ) : items.map((c) => (
        <Card key={c.conversationId} onPress={() => router.push(`/messages/${c.conversationId}` as never)} accessibilityLabel={`Conversation with ${c.other.displayName}${c.unreadCount ? `, ${c.unreadCount} unread` : ""}`}>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <Avatar name={c.other.displayName} uri={c.other.photoUrl} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: c.unreadCount ? "800" : "700", fontSize: 15 * k }} numberOfLines={1}>{c.other.displayName}</Text>
              <Text style={{ color: c.unreadCount ? colors.text : colors.muted, fontSize: 13 * k }} numberOfLines={1}>{c.lastMessage ? `${c.lastMessage.senderUid === c.other.uid ? "" : "You: "}${c.lastMessage.body}` : "No messages yet"}</Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text style={{ color: colors.subdued, fontSize: 11 * k }}>{timeAgo(c.lastActivityAt)}</Text>
              {c.unreadCount > 0 ? <Badge label={String(c.unreadCount)} tone="accent" /> : c.status === "CLOSED" ? <Badge label="Closed" /> : null}
            </View>
          </View>
        </Card>
      ))}
      {hasMore && <Pressable onPress={() => void load(false, items.length)} accessibilityRole="button"><Muted>Load more conversations</Muted></Pressable>}
    </Page>
  );
}
