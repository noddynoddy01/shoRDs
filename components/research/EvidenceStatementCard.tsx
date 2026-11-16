/**
 * One statement from the backend's cited analysis, with the sentence of the paper it points to.
 *
 * Shown by AnalysisPanel on the paper screen, after the user asks for an analysis. The wording and states come from
 * services/evidenceModel.ts, which is covered by tests; this component only draws them.
 *
 * What it shows, and what it refuses to show:
 *  - the sentence is fetched on demand from the evidence endpoint, which applies the paper's licence; when the licence does not allow it the
 *    card says so and offers the original paper instead of a quotation;
 *  - a statement with no matching sentence says so;
 *  - a note appears when the source is more cautious or more limited than the statement;
 *  - nothing on the card says or implies that the statement has been verified.
 */
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, radius, spacing } from "@/constants/theme";
import { api } from "@/services/auth/firebaseSession";
import { describeApiError, ApiError } from "@/services/auth/apiClient";
import { EVIDENCE_COPY, EvidenceSpan, SentenceResult, StatementView, loadSentence } from "@/services/evidenceModel";

type Props = {
  paperId: string;
  statement: StatementView;
  /** Link to the original paper (DOI or source page); null when the paper has none. */
  paperUrl: string | null;
  /** Test/preview seams only: replace the network loader, or start already expanded with known answers. The app passes neither. */
  loader?: (span: EvidenceSpan) => Promise<SentenceResult>;
  preview?: { results: { span: EvidenceSpan; result: SentenceResult }[] };
};

const isNotFound = (e: unknown) => e instanceof ApiError && e.kind === "NOT_FOUND";

export function EvidenceStatementCard({ paperId, statement, paperUrl, loader, preview }: Props) {
  const [open, setOpen] = useState(Boolean(preview));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ span: EvidenceSpan; result: SentenceResult }[] | null>(preview ? preview.results : null);

  const load = useCallback(async () => {
    setBusy(true);
    const out: { span: EvidenceSpan; result: SentenceResult }[] = [];
    for (const span of statement.spans) {
      out.push({ span, result: loader ? await loader(span) : await loadSentence(api, paperId, span, describeApiError, isNotFound) });
    }
    setResults(out);
    setBusy(false);
  }, [paperId, statement.spans, loader]);

  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    if (next && !results) void load();
  }, [open, results, load]);

  const openPaper = useCallback(() => {
    if (paperUrl) Linking.openURL(paperUrl).catch(() => undefined);
  }, [paperUrl]);

  const hasError = !!results && results.some((r) => r.result.state === "ERROR");

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{statement.label}</Text>
      <Text style={styles.text}>{statement.text}</Text>
      {statement.basis === "INFERRED" ? <Text style={styles.note}>{EVIDENCE_COPY.inferred}</Text> : null}
      {statement.qualifiers.map((q) => (
        <View key={q.key} style={styles.qualifier}>
          <Ionicons name="alert-circle-outline" size={14} color={colors.warning} />
          <Text style={styles.qualifierText}>{q.note}</Text>
        </View>
      ))}

      {statement.spans.length === 0 ? (
        <Text style={styles.note}>{EVIDENCE_COPY.noSpan}</Text>
      ) : (
        <Pressable accessibilityRole="button" onPress={toggle} style={styles.toggle}>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color={colors.primary} />
          <Text style={styles.toggleText}>{open ? EVIDENCE_COPY.hideSentence : EVIDENCE_COPY.showSentence}</Text>
        </Pressable>
      )}

      {open && busy ? (
        <View style={styles.row}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.note}>{EVIDENCE_COPY.loading}</Text>
        </View>
      ) : null}

      {open && results
        ? results.map(({ span, result }, i) => (
            <View key={`${span.chunkId}:${span.start}:${i}`} style={styles.quoteBox}>
              {result.state === "AVAILABLE" ? (
                <>
                  <Text style={styles.quote}>{result.text}</Text>
                  <Text style={styles.note}>
                    {[result.section, result.source.title, result.source.license ? `Licence: ${result.source.license}` : null, result.source.attributionRequired ? "Attribution required" : null].filter(Boolean).join(" · ")}
                  </Text>
                </>
              ) : result.state === "LICENSE_WITHHELD" ? (
                <Text style={styles.note}>{EVIDENCE_COPY.licenseWithheld}</Text>
              ) : result.state === "NOT_FOUND" ? (
                <Text style={styles.note}>{EVIDENCE_COPY.notFound}</Text>
              ) : (
                <Text style={styles.note}>{result.message}</Text>
              )}
            </View>
          ))
        : null}

      {open && hasError ? (
        <Pressable accessibilityRole="button" onPress={load} style={styles.toggle}>
          <Text style={styles.toggleText}>{EVIDENCE_COPY.retry}</Text>
        </Pressable>
      ) : null}

      {paperUrl ? (
        <Pressable accessibilityRole="link" onPress={openPaper} style={styles.toggle}>
          <Ionicons name="open-outline" size={14} color={colors.primary} />
          <Text style={styles.toggleText}>{EVIDENCE_COPY.openPaper}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  label: { fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  text: { fontSize: 15, lineHeight: 22, color: colors.text },
  note: { fontSize: 12, lineHeight: 17, color: colors.muted, marginTop: 6 },
  qualifier: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 6 },
  qualifierText: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.warning },
  toggle: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  toggleText: { fontSize: 13, fontWeight: "600", color: colors.primary },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  quoteBox: { marginTop: spacing.sm, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.primary },
  quote: { fontSize: 14, lineHeight: 20, color: colors.ink, fontStyle: "italic" }
});
