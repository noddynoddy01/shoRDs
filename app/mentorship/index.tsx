import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Avatar, Badge, Banner, Btn, Card, Empty, Loading, Muted, Page, Row, Segmented } from "@/components/social/Ui";
import { useTheme } from "@/context/ThemeContext";
import { describeSocialError, timeAgo } from "@/services/social/format";
import { social } from "@/services/social/instance";
import type { Relationship } from "@/services/social/types";

/** Your mentorships, as mentor and as mentee. Either side can mark one completed; the server records who and when and notifies the other person. */
export default function MentorshipScreen() {
  const { colors, fontSizeScale: k } = useTheme();
  const [tab, setTab] = useState<"ACTIVE" | "COMPLETED">("ACTIVE");
  const [items, setItems] = useState<Relationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems((await social.listRelationships(tab)).items); } catch (e) { setError(describeSocialError(e)); } finally { setLoading(false); }
  }, [tab]);
  useEffect(() => { void load(); }, [load]);

  const complete = async (r: Relationship) => {
    if (armed !== r.relationshipId) { setArmed(r.relationshipId); return; }
    setBusy(r.relationshipId); setError(null);
    try { await social.completeRelationship(r.relationshipId); setArmed(null); await load(); } catch (e) { setError(describeSocialError(e)); } finally { setBusy(null); }
  };

  return (
    <Page title="My mentorships" right={<Btn small kind="secondary" label="Requests" icon="mail-outline" onPress={() => router.push("/mentorship/requests" as never)} />}>
      <Segmented value={tab} onChange={setTab} options={[{ value: "ACTIVE", label: "Active" }, { value: "COMPLETED", label: "Completed" }]} />
      {error ? <Banner text={error} action={{ label: "Retry", onPress: () => void load() }} /> : null}
      {loading ? <Loading /> : items.length === 0 ? (
        <Empty icon="people-circle-outline" title={tab === "ACTIVE" ? "No active mentorships" : "No completed mentorships"} text={tab === "ACTIVE" ? "A mentorship starts when a mentor accepts a request." : undefined} />
      ) : items.map((r) => {
        const other = r.role === "MENTOR" ? r.mentee : r.mentor;
        return (
          <Card key={r.relationshipId}>
            <Row>
              <Avatar name={other.displayName} uri={other.photoUrl} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 * k }} numberOfLines={1}>{other.displayName}</Text>
                <Muted>You are the {r.role === "MENTOR" ? "mentor" : "mentee"} · since {timeAgo(r.startedAt)}</Muted>
              </View>
              <Badge label={r.status === "ACTIVE" ? "Active" : "Completed"} tone={r.status === "ACTIVE" ? "good" : "neutral"} />
            </Row>
            <Row style={{ flexWrap: "wrap" }}>
              {r.conversationId ? <Btn small label="Open conversation" icon="chatbubble-outline" onPress={() => router.push(`/messages/${r.conversationId}` as never)} /> : null}
              <Btn small kind="secondary" label="Profile" onPress={() => router.push(`/profile/${other.uid}` as never)} />
              {r.status === "ACTIVE" && <Btn small kind={armed === r.relationshipId ? "danger" : "secondary"} label={armed === r.relationshipId ? "Tap again to confirm" : "Mark completed"} onPress={() => void complete(r)} loading={busy === r.relationshipId} />}
            </Row>
            {armed === r.relationshipId && <Muted>Completing closes the conversation for new messages. This cannot be undone.</Muted>}
          </Card>
        );
      })}
    </Page>
  );
}
