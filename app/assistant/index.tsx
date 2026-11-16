import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { MarkdownText } from "@/components/social/MarkdownText";
import { copyText } from "@/components/social/copy";
import { AssistantMark, ThinkingDots } from "@/components/social/AssistantBits";
import { Banner, Btn, Card, Muted, Page } from "@/components/social/Ui";
import { useTheme } from "@/context/ThemeContext";
import { describeSocialError } from "@/services/social/format";
import { toPlainText } from "@/services/social/markdown";
import { social } from "@/services/social/instance";
import type { AssistantMessage } from "@/services/social/types";

const MAX_LEN = 1000;

/**
 * The shoRDs Assistant answers questions about USING the app (how things work, where to find them, what is planned). It is not the Research
 * Copilot, which discusses a paper. Answers come from a versioned help knowledge base through the same metered AI gateway as the rest of the app;
 * nothing here is canned, and if the AI is unavailable the app says so instead of inventing an answer.
 */
export default function AssistantScreen() {
  const { colors, fontSizeScale: k } = useTheme();
  const params = useLocalSearchParams<{ c?: string }>();
  const [convId, setConvId] = useState<string | null>(params.c ? String(params.c) : null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ q: string; error: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Open the conversation named in the route (from History), or start fresh.
  useEffect(() => {
    const wanted = params.c ? String(params.c) : null;
    setConvId(wanted); setFailed(null); setLoadError(null);
    if (!wanted) { setMessages([]); return; }
    social.getAssistantConversation(wanted).then((r) => { if (alive.current) setMessages(r.messages); }).catch((e) => { if (alive.current) setLoadError(describeSocialError(e)); });
  }, [params.c]);

  useEffect(() => { social.assistantSuggestions().then((s) => { if (alive.current) setSuggestions(s); }).catch(() => undefined); }, []);
  useEffect(() => { setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60); }, [messages.length, asking, failed]);

  const ask = useCallback(async (q: string) => {
    const question = q.trim();
    if (!question || asking) return;
    setAsking(question); setFailed(null); setText("");
    try {
      const r = await social.askAssistant(question, convId ?? undefined);
      if (!alive.current) return;
      setConvId(r.conversation.id);
      setMessages((cur) => [...cur, r.userMessage, r.assistantMessage]);
    } catch (e) { if (alive.current) setFailed({ q: question, error: describeSocialError(e) }); }
    finally { if (alive.current) setAsking(null); }
  }, [asking, convId]);

  const copy = async (m: AssistantMessage) => {
    const ok = await copyText(toPlainText(m.content));
    setCopyFailed(!ok); setCopied(ok ? m.id : null);
    if (ok) setTimeout(() => setCopied((c) => (c === m.id ? null : c)), 1800);
  };

  const fresh = () => { setConvId(null); setMessages([]); setFailed(null); setLoadError(null); setText(""); router.setParams({ c: undefined as never }); };

  const composer = (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ padding: 12, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.background, gap: 6 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
          <TextInput value={text} onChangeText={setText} placeholder="Ask how to use shoRDs" placeholderTextColor={colors.subdued} multiline maxLength={MAX_LEN} editable={!asking} accessibilityLabel="Ask the shoRDs Assistant"
            style={{ flex: 1, maxHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, backgroundColor: colors.surface, fontSize: 15 * k }} />
          <Pressable onPress={() => void ask(text)} disabled={!text.trim() || !!asking} accessibilityRole="button" accessibilityLabel="Send question" style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, opacity: text.trim() && !asking ? 1 : 0.4 }}>
            <Ionicons name="send" size={18} color="#fff" />
          </Pressable>
        </View>
        <Muted>Help about the app only. For questions about a paper, use the Research Copilot inside the paper.</Muted>
      </View>
    </KeyboardAvoidingView>
  );

  return (
    <Page title="shoRDs Assistant" subtitle="App help · not the Research Copilot" scroll={false} footer={composer}
      right={<View style={{ flexDirection: "row", gap: 6 }}>
        <Pressable onPress={() => router.push("/assistant/history" as never)} accessibilityRole="button" accessibilityLabel="Conversation history" hitSlop={8}><Ionicons name="time-outline" size={24} color={colors.text} /></Pressable>
        <Pressable onPress={fresh} accessibilityRole="button" accessibilityLabel="Start a new conversation" hitSlop={8}><Ionicons name="create-outline" size={24} color={colors.text} /></Pressable>
      </View>}>
      <ScrollView ref={scroller} contentContainerStyle={{ gap: 12, paddingVertical: 8 }} keyboardShouldPersistTaps="handled">
        {loadError ? <Banner text={loadError} /> : null}
        {messages.length === 0 && !asking && !loadError && (
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><AssistantMark size={36} /><Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 * k }} accessibilityRole="header">How can I help?</Text></View>
            <Muted>I explain how shoRDs works: finding papers, analysis, projects, mentorship, messages and your account. I say so when something is only planned. I cannot see your private messages or other people's profiles.</Muted>
            <View style={{ gap: 8, marginTop: 4 }}>
              {suggestions.map((s) => <Btn key={s} kind="secondary" label={s} onPress={() => void ask(s)} />)}
            </View>
          </Card>
        )}
        {messages.map((m) => m.role === "user" ? (
          <View key={m.id} style={{ alignSelf: "flex-end", maxWidth: "85%", backgroundColor: colors.primary, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Text selectable style={{ color: "#fff", fontSize: 15 * k }}>{m.content}</Text>
          </View>
        ) : (
          <View key={m.id} style={{ alignSelf: "flex-start", maxWidth: "95%", gap: 6, flexDirection: "row", alignItems: "flex-start" }}>
            <AssistantMark />
            <View style={{ flexShrink: 1, gap: 6 }}>
            <View style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 12, gap: 8 }}>
              <MarkdownText text={m.content} />
              {m.truncated ? <Muted>This answer was cut short. Ask a narrower question for the rest.</Muted> : null}
              {m.sources.length > 0 && <Muted>From help topics: {m.sources.map((s) => s.title).join(", ")}</Muted>}
            </View>
            <Pressable onPress={() => void copy(m)} accessibilityRole="button" accessibilityLabel="Copy answer" hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Ionicons name={copied === m.id ? "checkmark" : "copy-outline"} size={14} color={colors.muted} />
              <Text style={{ color: colors.muted, fontSize: 12 * k }}>{copied === m.id ? "Copied" : "Copy"}</Text>
            </Pressable>
            </View>
          </View>
        ))}
        {asking ? (
          <>
            <View style={{ alignSelf: "flex-end", maxWidth: "85%", backgroundColor: colors.primary, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, opacity: 0.7 }}><Text style={{ color: "#fff", fontSize: 15 * k }}>{asking}</Text></View>
            <View style={{ alignSelf: "flex-start", flexDirection: "row", gap: 8, alignItems: "center" }}>
              <AssistantMark />
              <View style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 }}><ThinkingDots /></View>
            </View>
          </>
        ) : null}
        {failed ? (
          <Card>
            <Banner text={failed.error} />
            <Muted>Your question: {failed.q}</Muted>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Btn small label="Retry" icon="refresh" onPress={() => void ask(failed.q)} />
              <Btn small kind="ghost" label="Edit question" onPress={() => { setText(failed.q); setFailed(null); }} />
            </View>
          </Card>
        ) : null}
        {copyFailed ? <Muted>Copying is not available here. Press and hold the answer text to select it.</Muted> : null}
      </ScrollView>
    </Page>
  );
}
