import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Banner, Btn, Card, Empty, Loading, Muted, Page, Segmented } from "@/components/social/Ui";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { describeSocialError, notificationTarget, timeAgo } from "@/services/social/format";
import { social } from "@/services/social/instance";
import type { AppNotification } from "@/services/social/types";

/** In-app notifications only (stored on the server, shown here). There are no emails and no push notifications. */
export default function NotificationsScreen() {
  const { colors, fontSizeScale: k } = useTheme();
  const { refreshCounters } = useProfile();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [items, setItems] = useState<AppNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (before?: string) => {
    if (before) setMore(true); else setLoading(true);
    setError(null);
    try {
      const r = await social.listNotifications({ unread: filter === "unread", before });
      setItems((cur) => (before ? [...cur, ...r.items] : r.items)); setCursor(r.nextBefore); setUnread(r.unreadCount);
    } catch (e) { setError(describeSocialError(e)); } finally { setLoading(false); setMore(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  const open = async (n: AppNotification) => {
    if (!n.read) {
      setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, read: true } : x))); setUnread((u) => Math.max(0, u - 1));
      try { await social.markNotificationRead(n.id); void refreshCounters(); } catch (e) { setError(describeSocialError(e)); setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, read: false } : x))); setUnread((u) => u + 1); return; }
    }
    const to = notificationTarget(n.type, n.data);
    if (to) router.push(to as never);
  };
  const readAll = async () => {
    try { await social.markAllNotificationsRead(); setItems((cur) => cur.map((x) => ({ ...x, read: true }))); setUnread(0); void refreshCounters(); }
    catch (e) { setError(describeSocialError(e)); }
  };

  return (
    <Page title="Notifications" subtitle={unread ? `${unread} unread` : "All caught up"} right={unread ? <Btn small kind="secondary" label="Mark all read" onPress={() => void readAll()} /> : undefined}>
      <Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "unread", label: "Unread", badge: unread || undefined }]} />
      {error ? <Banner text={error} action={{ label: "Retry", onPress: () => void load() }} /> : null}
      {loading ? <Loading /> : items.length === 0 && !error ? <Empty icon="notifications-off-outline" title={filter === "unread" ? "Nothing unread" : "No notifications yet"} text="You will see mentorship requests, replies, new messages and account updates here." /> : items.map((n) => (
        <Card key={n.id} onPress={() => void open(n)} accessibilityLabel={`${n.read ? "" : "Unread. "}${n.title}`} style={n.read ? undefined : { borderColor: colors.primary }}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Ionicons name={n.read ? "notifications-outline" : "notifications"} size={20} color={n.read ? colors.muted : colors.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.text, fontWeight: n.read ? "600" : "800", fontSize: 14 * k }}>{n.title}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 * k }}>{n.body}</Text>
              <Muted>{timeAgo(n.createdAt)}</Muted>
            </View>
          </View>
        </Card>
      ))}
      {cursor && <Btn kind="secondary" label="Load more" onPress={() => void load(cursor)} loading={more} />}
    </Page>
  );
}
