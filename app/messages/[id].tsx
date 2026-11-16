import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Banner, Btn, Card, Loading, Muted, Page } from "@/components/social/Ui";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { describeSocialError, timeAgo } from "@/services/social/format";
import { social } from "@/services/social/instance";
import type { ChatMessage, ConversationSummary } from "@/services/social/types";

const POLL_MS = 4000;
const MAX_LEN = 2000;

type Pending = { clientId: string; body: string; status: "sending" | "failed"; at: string; error?: string };
const newClientId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const cmp = (a: ChatMessage, b: ChatMessage) => { try { const x = BigInt(a.id), y = BigInt(b.id); return x < y ? -1 : x > y ? 1 : 0; } catch { return a.id.localeCompare(b.id); } };

/**
 * One conversation. Messages refresh by polling every 4 seconds while the screen is focused (this is NOT a live connection). Sending is
 * optimistic: your text appears immediately as "sending" and, if the network fails, as "failed" with a Retry that reuses the same clientId so the
 * server can never store it twice. Read receipts ("Seen") come from the server's record of what the other person has read.
 */
export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cid = String(id);
  const { colors, fontSizeScale: k } = useTheme();
  const { refreshCounters } = useProfile();
  const [conv, setConv] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const scroller = useRef<ScrollView>(null);
  const stick = useRef(true);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const merge = useCallback((incoming: ChatMessage[]) => {
    setMessages((cur) => { const map = new Map(cur.map((m) => [m.id, m])); incoming.forEach((m) => map.set(m.id, m)); return [...map.values()].sort(cmp); });
  }, []);

  const markRead = useCallback(async () => { try { await social.markConversationRead(cid); void refreshCounters(); } catch (_) { /* a missed read marker is retried on the next poll */ } }, [cid, refreshCounters]);

  const first = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [c, m] = await Promise.all([social.getConversation(cid), social.listMessages(cid, { limit: 30 })]);
      if (!alive.current) return;
      setConv(c); setMessages(m.messages.slice().sort(cmp)); setOlderCursor(m.nextBefore);
      void markRead();
    } catch (e) { if (alive.current) setError(describeSocialError(e)); } finally { if (alive.current) setLoading(false); }
  }, [cid, markRead]);

  const poll = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([social.getConversation(cid), social.listMessages(cid, { limit: 30 })]);
      if (!alive.current) return;
      setConv(c); merge(m.messages); setPollError(false);
      if (m.messages.some((x) => !x.mine)) void markRead();
    } catch (_) { if (alive.current) setPollError(true); }
  }, [cid, merge, markRead]);

  useFocusEffect(useCallback(() => {
    void first();
    const t = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(t);
  }, [first, poll]));

  useEffect(() => { if (stick.current) setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50); }, [messages.length, pending.length]);

  const send = async (p: Pending) => {
    setPending((cur) => cur.map((x) => (x.clientId === p.clientId ? { ...x, status: "sending", error: undefined } : x)));
    try {
      const m = await social.sendMessage(cid, p.body, p.clientId);
      merge([m]); setPending((cur) => cur.filter((x) => x.clientId !== p.clientId));
    } catch (e) {
      setPending((cur) => cur.map((x) => (x.clientId === p.clientId ? { ...x, status: "failed", error: describeSocialError(e) } : x)));
    }
  };
  const submit = () => {
    const body = text.trim();
    if (!body || body.length > MAX_LEN) return;
    const p: Pending = { clientId: newClientId(), body, status: "sending", at: new Date().toISOString() };
    setText(""); stick.current = true; setPending((cur) => [...cur, p]); void send(p);
  };

  const loadOlder = async () => {
    if (!olderCursor) return;
    try { const m = await social.listMessages(cid, { before: olderCursor, limit: 30 }); merge(m.messages); setOlderCursor(m.nextBefore); stick.current = false; }
    catch (e) { setNotice({ kind: "error", text: describeSocialError(e) }); }
  };

  const block = async () => {
    if (!conv) return;
    try { await social.blockUser(conv.other.uid); setNotice({ kind: "success", text: `${conv.other.displayName} is blocked. They can no longer send you messages.` }); await poll(); }
    catch (e) { setNotice({ kind: "error", text: describeSocialError(e) }); }
  };
  const unblock = async () => {
    if (!conv) return;
    try { await social.unblockUser(conv.other.uid); setNotice({ kind: "success", text: "Unblocked." }); await poll(); }
    catch (e) { setNotice({ kind: "error", text: describeSocialError(e) }); }
  };
  const report = async () => {
    if (reason.trim().length < 5) { setNotice({ kind: "error", text: "Say briefly what is wrong (at least 5 characters)." }); return; }
    try { await social.reportConversation(cid, reason.trim()); setReporting(false); setReason(""); setNotice({ kind: "success", text: "Report sent to the shoRDs administrators. They are the only people who can see it." }); }
    catch (e) { setNotice({ kind: "error", text: describeSocialError(e) }); }
  };

  const lastMineSeen = useMemo(() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].mine) return messages[i].readByOther === true ? messages[i].id : null; return null; }, [messages]);
  const lastMineId = useMemo(() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].mine) return messages[i].id; return null; }, [messages]);

  if (loading) return <Page title="Conversation"><Loading /></Page>;
  if (error || !conv) return <Page title="Conversation"><Banner text={error || "Conversation not found."} action={{ label: "Retry", onPress: () => void first() }} /></Page>;

  const closedReason = conv.blocked ? "Messaging is blocked between you and this person." : conv.status === "CLOSED" ? "This mentorship was completed, so the conversation is read-only." : !conv.canSend ? "You cannot send messages in this conversation." : null;

  const composer = (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ padding: 12, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.background, gap: 6 }}>
        {closedReason ? <Muted>{closedReason}</Muted> : (
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
            <TextInput value={text} onChangeText={setText} placeholder="Write a message" placeholderTextColor={colors.subdued} multiline maxLength={MAX_LEN} accessibilityLabel="Message"
              style={{ flex: 1, maxHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, backgroundColor: colors.surface, fontSize: 15 * k }} />
            <Pressable onPress={submit} disabled={!text.trim()} accessibilityRole="button" accessibilityLabel="Send message" style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, opacity: text.trim() ? 1 : 0.4 }}>
              <Ionicons name="send" size={18} color="#fff" />
            </Pressable>
          </View>
        )}
        {text.length > MAX_LEN - 200 ? <Muted>{text.length}/{MAX_LEN}</Muted> : null}
      </View>
    </KeyboardAvoidingView>
  );

  return (
    <Page title={conv.other.displayName} subtitle={conv.kind === "MENTORSHIP" ? "Mentorship" : "Direct message"} scroll={false} footer={composer}
      right={<Pressable onPress={() => router.push(`/profile/${conv.other.uid}` as never)} accessibilityRole="button" accessibilityLabel="View profile" hitSlop={10}><Ionicons name="person-circle-outline" size={26} color={colors.text} /></Pressable>}>
      {pollError ? <Banner text="Can't refresh right now. Retrying automatically." /> : null}
      {notice ? <Banner kind={notice.kind} text={notice.text} /> : null}
      <ScrollView ref={scroller} contentContainerStyle={{ gap: 8, paddingVertical: 8 }} onScroll={(e) => { const m = e.nativeEvent; stick.current = m.contentOffset.y + m.layoutMeasurement.height >= m.contentSize.height - 80; }} scrollEventThrottle={100} keyboardShouldPersistTaps="handled">
        {olderCursor ? <Btn kind="ghost" small label="Load earlier messages" onPress={() => void loadOlder()} /> : null}
        {messages.length === 0 && pending.length === 0 ? <Muted>No messages yet. Say hello.</Muted> : null}
        {messages.map((m) => (
          <Bubble key={m.id} mine={m.mine} body={m.body} meta={`${timeAgo(m.createdAt)}${m.mine && m.id === lastMineId ? (lastMineSeen === m.id ? " · Seen" : " · Sent") : ""}`} />
        ))}
        {pending.map((p) => (
          <View key={p.clientId}>
            <Bubble mine body={p.body} meta={p.status === "sending" ? "Sending…" : "Not sent"} dim />
            {p.status === "failed" && (
              <View style={{ alignItems: "flex-end", gap: 4, marginTop: 4 }}>
                <Text style={{ color: "#EF4444", fontSize: 12 * k }}>{p.error}</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Btn small label="Retry" onPress={() => void send(p)} />
                  <Btn small kind="ghost" label="Discard" onPress={() => { setPending((cur) => cur.filter((x) => x.clientId !== p.clientId)); setText((t) => t || p.body); }} />
                </View>
              </View>
            )}
          </View>
        ))}
      </ScrollView>
      <Card>
        {reporting ? (
          <>
            <TextInput value={reason} onChangeText={setReason} placeholder="What is wrong with this conversation?" placeholderTextColor={colors.subdued} multiline maxLength={500} accessibilityLabel="Report reason" style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, minHeight: 60, fontSize: 14 * k }} />
            <View style={{ flexDirection: "row", gap: 8 }}><Btn small label="Send report" onPress={() => void report()} /><Btn small kind="ghost" label="Cancel" onPress={() => setReporting(false)} /></View>
          </>
        ) : (
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Btn small kind="secondary" label="Report" icon="flag-outline" onPress={() => setReporting(true)} />
            {conv.blocked ? <Btn small kind="secondary" label="Unblock" onPress={() => void unblock()} /> : <Btn small kind="secondary" label="Block" icon="ban" onPress={() => void block()} />}
          </View>
        )}
      </Card>
    </Page>
  );
}

function Bubble({ mine, body, meta, dim }: { mine: boolean; body: string; meta: string; dim?: boolean }) {
  const { colors, fontSizeScale: k } = useTheme();
  return (
    <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", gap: 2, opacity: dim ? 0.6 : 1 }}>
      <View style={{ backgroundColor: mine ? colors.primary : colors.card, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, borderWidth: mine ? 0 : 1, borderColor: colors.border }}>
        <Text selectable style={{ color: mine ? "#fff" : colors.text, fontSize: 15 * k }}>{body}</Text>
      </View>
      <Text style={{ color: colors.subdued, fontSize: 11 * k, textAlign: mine ? "right" : "left" }}>{meta}</Text>
    </View>
  );
}
