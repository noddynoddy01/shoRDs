import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Banner, Btn, Card, Empty, Loading, Muted, Page } from "@/components/social/Ui";
import { useTheme } from "@/context/ThemeContext";
import { describeSocialError, timeAgo } from "@/services/social/format";
import { social } from "@/services/social/instance";
import type { AssistantConversation } from "@/services/social/types";

/** Your own Assistant conversations. Only you can list, open or delete them; deleting removes them from the server permanently. */
export default function AssistantHistory() {
  const { colors, fontSizeScale: k } = useTheme();
  const [items, setItems] = useState<AssistantConversation[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (offset = 0) => {
    if (offset === 0) setLoading(true);
    setError(null);
    try { const r = await social.listAssistantConversations(offset); setItems((cur) => (offset === 0 ? r.items : [...cur, ...r.items])); setHasMore(r.hasMore); }
    catch (e) { setError(describeSocialError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(0); }, [load]);

  const remove = async (id: string) => {
    if (armed !== id) { setArmed(id); return; }
    setBusy(true);
    try { await social.deleteAssistantConversation(id); setArmed(null); setItems((cur) => cur.filter((c) => c.id !== id)); }
    catch (e) { setError(describeSocialError(e)); } finally { setBusy(false); }
  };
  const clearAll = async () => {
    if (armed !== "ALL") { setArmed("ALL"); return; }
    setBusy(true);
    try { await social.clearAssistantHistory(); setArmed(null); setItems([]); setHasMore(false); }
    catch (e) { setError(describeSocialError(e)); } finally { setBusy(false); }
  };

  return (
    <Page title="Assistant history" right={items.length > 0 ? <Btn small kind={armed === "ALL" ? "danger" : "secondary"} label={armed === "ALL" ? "Confirm clear all" : "Clear all"} onPress={() => void clearAll()} loading={busy && armed === "ALL"} /> : undefined}>
      {armed ? <Banner kind="info" text="Deleting is permanent. Tap the same button again to confirm." action={{ label: "Cancel", onPress: () => setArmed(null) }} /> : null}
      {error ? <Banner text={error} action={{ label: "Retry", onPress: () => void load(0) }} /> : null}
      {loading ? <Loading /> : items.length === 0 && !error ? (
        <Empty icon="chatbubble-ellipses-outline" title="No conversations yet" text="Your questions to the shoRDs Assistant are saved here, privately." action={<Btn kind="secondary" label="Ask something" onPress={() => router.replace("/assistant" as never)} />} />
      ) : items.map((c) => (
        <Card key={c.id}>
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 * k }} numberOfLines={2}>{c.title}</Text>
          <Muted>{c.messageCount !== undefined ? `${c.messageCount} messages · ` : ""}{timeAgo(c.updatedAt)}</Muted>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Btn small label="Open" onPress={() => router.replace({ pathname: "/assistant", params: { c: c.id } } as never)} />
            <Btn small kind={armed === c.id ? "danger" : "secondary"} label={armed === c.id ? "Confirm delete" : "Delete"} onPress={() => void remove(c.id)} loading={busy && armed === c.id} />
          </View>
        </Card>
      ))}
      {hasMore && <Btn kind="secondary" label="Load more" onPress={() => void load(items.length)} />}
    </Page>
  );
}
