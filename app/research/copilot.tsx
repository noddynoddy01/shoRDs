/**
 * Research Copilot: questions about ONE paper, answered from text the server retrieved from that paper.
 *
 * What this screen shows is exactly what POST /api/v1/copilot/query returned (see services/researchCopilotService.ts):
 *  - the answer, with the citations the model wrote as [chunkId], turned into numbered buttons;
 *  - the evidence excerpts the server selected, each openable in an inspector (section, page, chunk id, full excerpt);
 *  - the status the server computed (never "verified": the server's checks are mechanical), the coverage of the paper
 *    (full text / abstract only / metadata only / unavailable), whether an AI model was called, and any limitations.
 *
 * It sends only the question, the paper reference and the project id. Identity is decided by the server from the ID token.
 * Nothing here is invented: if there is no evidence, no evidence is shown; a failed request shows the error and a retry button.
 * The conversation is kept on this screen only (the server keeps no per-user thread for the Copilot).
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Badge, Banner, Button, Card, Input, Modal, Page } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import type { PState } from "@/components/ui/Button";
import { ThinkingDots } from "@/components/social/AssistantBits";
import { tokens } from "@/constants/theme";
import { useProject } from "@/context/ProjectContext";
import { useTheme } from "@/context/ThemeContext";
import { ResearchCopilotService } from "@/services/researchCopilotService";
import type { ResearchCopilotResponse } from "@/types/researchCopilot";
import { EXAMPLE_QUESTIONS, normalizePaperRef, splitAnswer } from "@/services/copilotView";

type Evidence = ResearchCopilotResponse["evidence"][number];
type Turn = { id: string; question: string; response: ResearchCopilotResponse | null };

const MAX_Q = 1000;

const STATUS_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  UNVERIFIED: { label: "Not independently verified", tone: "warn" },
  FALLBACK: { label: "No AI model used", tone: "neutral" },
  CONTENT_UNAVAILABLE: { label: "Paper text unavailable", tone: "bad" },
  METADATA_ONLY: { label: "Metadata only", tone: "warn" },
  NEEDS_CLARIFICATION: { label: "Needs a paper", tone: "neutral" },
  FAILED: { label: "Request failed", tone: "bad" }
};
const COVERAGE_LABEL: Record<string, string> = {
  FULL_TEXT: "Full text used",
  ABSTRACT_ONLY: "Abstract only",
  METADATA_ONLY: "Metadata only",
  CONTENT_UNAVAILABLE: "Text unavailable"
};

export default function ResearchCopilotScreen() {
  const { colors, fontSizeScale: k } = useTheme();
  const params = useLocalSearchParams<{ ref?: string; title?: string }>();
  const { phase, selection, active, error: projectError } = useProject();

  const initialRef = typeof params.ref === "string" ? normalizePaperRef(params.ref) : null;
  const [paperRef, setPaperRef] = useState<string | null>(initialRef);
  const [paperTitle, setPaperTitle] = useState<string>(typeof params.title === "string" ? params.title : "");
  const [refInput, setRefInput] = useState("");
  const [refError, setRefError] = useState<string | null>(null);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [inspect, setInspect] = useState<{ turn: Turn; index: number } | null>(null);
  const scroller = useRef<ScrollView>(null);
  const seq = useRef(0);

  // Opening the screen from another paper replaces the paper (and clears the thread: a thread belongs to one paper).
  useEffect(() => {
    const next = typeof params.ref === "string" ? normalizePaperRef(params.ref) : null;
    if (next && next !== paperRef) { setPaperRef(next); setPaperTitle(typeof params.title === "string" ? params.title : ""); setTurns([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.ref]);

  const projectId = active ? active.projectId : undefined;

  const run = useCallback(async (turnId: string, question: string) => {
    if (!paperRef) return;
    setPending(true);
    const response = await ResearchCopilotService.processCopilotRequest({ query: question, mode: "ASK", projectId, selectedPaperIds: [paperRef] });
    setTurns((t) => t.map((x) => (x.id === turnId ? { ...x, response } : x)));
    setPending(false);
  }, [paperRef, projectId]);

  const ask = useCallback((q: string) => {
    const question = q.trim().slice(0, MAX_Q);
    if (!question || pending || !paperRef) return;
    const id = `t${++seq.current}`;
    setTurns((t) => [...t, { id, question, response: null }]);
    setText("");
    void run(id, question);
  }, [pending, paperRef, run]);

  const retry = (turn: Turn) => {
    if (pending) return;
    setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, response: null } : x)));
    void run(turn.id, turn.question);
  };

  useEffect(() => { setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60); }, [turns.length, pending]);

  const usePaper = () => {
    const ref = normalizePaperRef(refInput);
    if (!ref) { setRefError("That does not look like a DOI (10.xxxx/…), a PubMed id (digits) or an arXiv id (e.g. 1706.03762)."); return; }
    setRefError(null); setPaperRef(ref); setPaperTitle(""); setTurns([]); setRefInput("");
  };
  const changePaper = () => { setPaperRef(null); setPaperTitle(""); setTurns([]); setText(""); setRefError(null); };

  const saveTarget = active ? `Saved to project “${active.name}”` : "Saved to your personal space";

  const composer = (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ padding: 12, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.background, gap: 6 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={paperRef ? "Ask a question about this paper" : "Choose a paper first"}
            placeholderTextColor={colors.subdued}
            multiline
            maxLength={MAX_Q}
            editable={!!paperRef && !pending}
            accessibilityLabel="Question about the paper"
            onSubmitEditing={() => ask(text)}
            style={{ flex: 1, maxHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, backgroundColor: colors.surface, fontSize: 15 * k }}
          />
          <Pressable onPress={() => ask(text)} disabled={!text.trim() || pending || !paperRef} accessibilityRole="button" accessibilityLabel="Ask the Copilot" style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, opacity: text.trim() && !pending && paperRef ? 1 : 0.4 }}>
            <Ionicons name="send" size={18} color="#fff" />
          </Pressable>
        </View>
        <Text style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k }}>Each question uses part of your daily AI allowance. Answers can be wrong; check the cited excerpts.</Text>
      </View>
    </KeyboardAvoidingView>
  );

  return (
    <Page
      title="Research Copilot"
      subtitle="Questions about one paper · answers cite text retrieved from it"
      scroll={false}
      footer={composer}
      wide
      right={turns.length > 0 ? <Button kind="ghost" small label="Clear" icon="trash-outline" onPress={() => setTurns([])} accessibilityHint="Clears the conversation on this screen" /> : undefined}
    >
      <ScrollView ref={scroller} contentContainerStyle={{ gap: 14, paddingVertical: 8 }} keyboardShouldPersistTaps="handled">
        {phase === "ERROR" ? <Banner text={projectError || "Could not load your projects. Questions will use your personal space."} /> : null}
        {phase === "READY" && selection.kind === "PICK" ? (
          <Banner kind="warning" text="You belong to several projects. Choose one so answers are saved to the right place; until then they use your personal space." action={{ label: "Choose project", onPress: () => router.push("/projects" as never) }} />
        ) : null}

        <Card>
          {paperRef ? (
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="document-text-outline" size={18} color={colors.accent} />
                <Text style={{ color: colors.muted, fontSize: tokens.fontSize.xs * k, fontWeight: "700", letterSpacing: 0.4 }}>PAPER</Text>
                <View style={{ flex: 1 }} />
                <Button kind="ghost" small label="Change paper" onPress={changePaper} />
              </View>
              {paperTitle ? <Text style={{ color: colors.text, fontSize: 16 * k, fontWeight: "800", lineHeight: 22 * k }} accessibilityRole="header">{paperTitle}</Text> : null}
              <Text selectable style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k, fontFamily: Platform.OS === "web" ? "ui-monospace, Menlo, monospace" : undefined }}>{paperRef}</Text>
              <Text style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k }}>{saveTarget}</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <Text style={{ color: colors.text, fontSize: 16 * k, fontWeight: "800" }} accessibilityRole="header">Which paper?</Text>
              <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k, lineHeight: 20 * k }}>
                Enter a DOI, a PubMed id or an arXiv id. The server finds the paper and retrieves its text. You can also open the Copilot from a paper in the feed or search.
              </Text>
              <Input label="Paper reference" value={refInput} onChangeText={(v: string) => { setRefInput(v); setRefError(null); }} placeholder="10.1038/s41586-020-2649-2 · 31452104 · 1706.03762" autoCapitalize="none" autoCorrect={false} maxLength={300} error={refError ?? undefined} />
              <Button label="Use this paper" onPress={usePaper} disabled={!refInput.trim()} />
              <Button kind="ghost" label="Find a paper in Explore" icon="compass-outline" onPress={() => router.push("/(tabs)/explore" as never)} />
            </View>
          )}
        </Card>

        {paperRef && turns.length === 0 ? (
          <Card>
            <Text style={{ color: colors.text, fontSize: 15 * k, fontWeight: "700" }} accessibilityRole="header">Try a question</Text>
            <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k }}>These only fill the question box.</Text>
            <View style={{ gap: 8, marginTop: 6 }}>
              {EXAMPLE_QUESTIONS.map((q) => <Button key={q} kind="secondary" label={q} onPress={() => setText(q)} />)}
            </View>
          </Card>
        ) : null}

        {turns.map((turn) => (
          <View key={turn.id} style={{ gap: 10 }}>
            <View style={{ alignSelf: "flex-end", maxWidth: "88%", backgroundColor: colors.primary, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 }}>
              <Text selectable style={{ color: "#fff", fontSize: 15 * k, lineHeight: 21 * k }}>{turn.question}</Text>
            </View>
            {turn.response ? (
              <AnswerCard turn={turn} onInspect={(index) => setInspect({ turn, index })} onRetry={() => retry(turn)} retryDisabled={pending} />
            ) : (
              <Card><ThinkingDots label="Reading the paper" /></Card>
            )}
          </View>
        ))}
      </ScrollView>

      <EvidenceInspector inspect={inspect} onClose={() => setInspect(null)} />
    </Page>
  );
}

function AnswerCard({ turn, onInspect, onRetry, retryDisabled }: { turn: Turn; onInspect: (index: number) => void; onRetry: () => void; retryDisabled: boolean }) {
  const { colors, fontSizeScale: k } = useTheme();
  const r = turn.response as ResearchCopilotResponse;
  const parts = useMemo(() => splitAnswer(r.answer, r.evidence), [r.answer, r.evidence]);
  const st = STATUS_LABEL[r.status] ?? { label: r.status, tone: "neutral" as BadgeTone };
  const failed = r.status === "FAILED" || r.status === "NEEDS_CLARIFICATION";
  const modelLine = r.aiCalled === true ? `Written by an AI model${r.model ? ` (${r.model})` : ""}` : r.aiCalled === false ? (r.cacheStatus === "HIT" ? "Reused an earlier answer; no new model call" : "No AI model was called") : null;

  return (
    <Card>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <Badge label={st.label} tone={st.tone} />
        {r.coverage ? <Badge label={COVERAGE_LABEL[r.coverage] ?? r.coverage} tone={r.coverage === "FULL_TEXT" ? "good" : "warn"} /> : null}
        {r.cacheStatus === "HIT" ? <Badge label="Cached" tone="neutral" /> : null}
      </View>

      {failed ? (
        <View style={{ gap: 8 }}>
          <Banner kind={r.status === "FAILED" ? "error" : "info"} text={r.answer} />
          {r.limitations.map((l, i) => <Text key={i} style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k }}>{l}</Text>)}
          {r.status === "FAILED" ? <Button kind="secondary" small label="Try again" icon="refresh" onPress={onRetry} disabled={retryDisabled} /> : null}
        </View>
      ) : (
        <>
          <View>
            <Text style={{ color: colors.muted, fontSize: tokens.fontSize.xs * k, fontWeight: "700", letterSpacing: 0.4, marginBottom: 4 }}>ANSWER{modelLine ? ` · ${modelLine.toUpperCase()}` : ""}</Text>
            <Text selectable style={{ color: colors.text, fontSize: 15 * k, lineHeight: 24 * k }}>
              {parts.map((p, i) =>
                p.kind === "text" ? (
                  <Text key={i}>{p.text}</Text>
                ) : (
                  <Text key={i}>
                    {p.indexes.map((ix, j) => (
                      <Text key={j} onPress={() => onInspect(ix)} accessibilityRole="button" accessibilityLabel={`Open evidence ${ix + 1}`} style={{ color: colors.accent, fontWeight: "800" }}>
                        {`[${ix + 1}]`}
                      </Text>
                    ))}
                  </Text>
                )
              )}
            </Text>
          </View>

          {r.limitations.length > 0 ? (
            <View style={{ gap: 4 }}>
              {r.limitations.map((l, i) => <Text key={i} style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k, lineHeight: 17 * k }}>• {l}</Text>)}
            </View>
          ) : null}

          {r.evidence.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: colors.muted, fontSize: tokens.fontSize.xs * k, fontWeight: "700", letterSpacing: 0.4 }}>EVIDENCE · {r.evidence.length} EXCERPT{r.evidence.length === 1 ? "" : "S"} FROM THE PAPER</Text>
              {r.evidence.map((e, i) => (
                <Pressable key={e.chunkId + i} onPress={() => onInspect(i)} accessibilityRole="button" accessibilityLabel={`Inspect evidence ${i + 1}, ${e.section || "excerpt"}`} style={({ hovered }: PState) => ({ flexDirection: "row", gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: hovered ? colors.surface : "transparent" })}>
                  <Text style={{ color: colors.accent, fontWeight: "800", fontSize: 13 * k, minWidth: 26 }}>{`[${i + 1}]`}</Text>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k }}>{[e.section, e.page != null ? `p. ${e.page}` : null].filter(Boolean).join(" · ") || "Excerpt"}</Text>
                    <Text numberOfLines={2} style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k, lineHeight: 19 * k }}>{e.text || "Excerpt text is not shown for this paper (licence)."}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.subdued} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      )}
    </Card>
  );
}

function EvidenceInspector({ inspect, onClose }: { inspect: { turn: Turn; index: number } | null; onClose: () => void }) {
  const { colors, fontSizeScale: k } = useTheme();
  const r = inspect?.turn.response ?? null;
  const e: Evidence | undefined = r && inspect ? r.evidence[inspect.index] : undefined;
  const paper = r?.sources[0];
  const doiUrl = paper?.doi ? `https://doi.org/${paper.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}` : null;
  return (
    <Modal visible={!!e} title={e && inspect ? `Evidence [${inspect.index + 1}]` : "Evidence"} onClose={onClose} actions={doiUrl ? <Button kind="secondary" label="Open the original paper" icon="open-outline" onPress={() => void Linking.openURL(doiUrl)} /> : undefined}>
      {e ? (
        <View style={{ gap: 10 }}>
          {paper?.title ? <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k }}>{paper.title}</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {e.section ? <Badge label={e.section} tone="accent" /> : null}
            {e.page != null ? <Badge label={`Page ${e.page}`} /> : null}
          </View>
          <Text style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k, fontWeight: "700", letterSpacing: 0.4 }}>EXCERPT FROM THE PAPER (VERBATIM)</Text>
          <Text selectable style={{ color: colors.text, fontSize: 15 * k, lineHeight: 24 * k }}>{e.text || "The text of this excerpt is not shown because the paper's licence does not clearly allow it. Open the original paper to read it."}</Text>
          <Text selectable style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k, fontFamily: Platform.OS === "web" ? "ui-monospace, Menlo, monospace" : undefined }}>{e.chunkId}</Text>
          <Text style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k, lineHeight: 17 * k }}>The server selected this excerpt as relevant to your question. That it matches the answer was checked mechanically, not by a person.</Text>
        </View>
      ) : null}
    </Modal>
  );
}
