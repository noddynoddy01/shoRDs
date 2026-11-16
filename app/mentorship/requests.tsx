import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Avatar, Badge, Banner, Btn, Card, Empty, Field, Loading, Muted, Page, Row, Segmented } from "@/components/social/Ui";
import { useTheme } from "@/context/ThemeContext";
import { STATUS_LABEL, describeSocialError, timeAgo } from "@/services/social/format";
import { social } from "@/services/social/instance";
import type { MentorshipRequest } from "@/services/social/types";

type Box = "incoming" | "outgoing";

/** Requests you received (as a mentor) and requests you sent (as a mentee). Every transition is validated by the server; the buttons only reflect what it allows. */
export default function RequestsScreen() {
  const { colors, fontSizeScale: k } = useTheme();
  const [box, setBox] = useState<Box>("incoming");
  const [items, setItems] = useState<MentorshipRequest[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async (offset = 0) => {
    if (offset === 0) setLoading(true);
    setError(null);
    try {
      const r = await social.listRequests(box, undefined, offset);
      setItems((cur) => (offset === 0 ? r.items : [...cur, ...r.items])); setHasMore(r.hasMore);
    } catch (e) { setError(describeSocialError(e)); } finally { setLoading(false); }
  }, [box]);
  useEffect(() => { void load(0); }, [load]);

  const act = async (r: MentorshipRequest, action: "ACCEPT" | "REJECT" | "CANCEL") => {
    setBusy(r.requestId); setNotice(null);
    try {
      const out = await social.respondToRequest(r.requestId, action, notes[r.requestId]?.trim() || undefined);
      setNotice({ kind: "success", text: action === "ACCEPT" ? "Accepted. A conversation with your mentee is open." : action === "REJECT" ? "Declined. The mentee has been notified." : "Request cancelled." });
      if (action === "ACCEPT" && out.conversationId) router.push(`/messages/${out.conversationId}` as never);
      await load(0);
    } catch (e) { setNotice({ kind: "error", text: describeSocialError(e) }); await load(0); } finally { setBusy(null); }
  };

  return (
    <Page title="Mentorship requests">
      <Segmented value={box} onChange={setBox} options={[{ value: "incoming", label: "Received" }, { value: "outgoing", label: "Sent" }]} />
      {notice ? <Banner kind={notice.kind} text={notice.text} /> : null}
      {error ? <Banner text={error} action={{ label: "Retry", onPress: () => void load(0) }} /> : null}
      {loading ? <Loading /> : items.length === 0 && !error ? (
        <Empty icon="mail-outline" title={box === "incoming" ? "No requests received" : "No requests sent"} text={box === "incoming" ? "When someone asks you to mentor them it will appear here, and you will get a notification." : "Find a verified mentor in the Mentors tab and send a request."} action={box === "outgoing" ? <Btn kind="secondary" label="Browse mentors" onPress={() => router.push("/mentors" as never)} /> : undefined} />
      ) : items.map((r) => {
        const other = box === "incoming" ? r.mentee : r.mentor;
        return (
          <Card key={r.requestId}>
            <Row>
              <Avatar name={other.displayName} uri={other.photoUrl} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 * k }} numberOfLines={1}>{other.displayName}</Text>
                <Muted>{r.domain} · {timeAgo(r.createdAt)}</Muted>
              </View>
              <Badge label={STATUS_LABEL[r.status]} tone={r.status === "ACCEPTED" ? "good" : r.status === "PENDING" ? "warn" : r.status === "REJECTED" ? "bad" : "neutral"} />
            </Row>
            <Text style={{ color: colors.muted, fontSize: 12 * k }}>Interests</Text>
            <Text style={{ color: colors.text, fontSize: 13 * k }} selectable>{r.interests}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 * k }}>Guidance needed</Text>
            <Text style={{ color: colors.text, fontSize: 13 * k }} selectable>{r.guidanceNeeded}</Text>
            {r.responseNote ? <Muted>Reply: {r.responseNote}</Muted> : null}
            {r.status === "PENDING" && box === "incoming" && (
              <>
                <Field label="Reply note (optional)" value={notes[r.requestId] ?? ""} onChangeText={(v) => setNotes((n) => ({ ...n, [r.requestId]: v }))} maxLength={500} />
                <Row>
                  <Btn label="Accept" icon="checkmark" onPress={() => void act(r, "ACCEPT")} loading={busy === r.requestId} disabled={busy !== null} />
                  <Btn kind="secondary" label="Decline" onPress={() => void act(r, "REJECT")} disabled={busy !== null} />
                </Row>
              </>
            )}
            {r.status === "PENDING" && box === "outgoing" && <Btn kind="secondary" small label="Cancel request" onPress={() => void act(r, "CANCEL")} loading={busy === r.requestId} disabled={busy !== null} />}
            <Btn kind="ghost" small label={`View ${other.displayName}'s profile`} onPress={() => router.push(`/profile/${other.uid}` as never)} />
          </Card>
        );
      })}
      {hasMore && <Btn kind="secondary" label="Load more" onPress={() => void load(items.length)} />}
    </Page>
  );
}
