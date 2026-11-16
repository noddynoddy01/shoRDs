/**
 * The "what the automatic checks did" note shown above a cited analysis: how many statements were removed and why, and what the checks
 * cannot do. Text comes from services/evidenceModel.ts. Shown by AnalysisPanel.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@/constants/theme";
import { AnalysisView, EVIDENCE_COPY } from "@/services/evidenceModel";

export function EvidenceSummaryNote({ view }: { view: AnalysisView }) {
  const r = view.removed;
  return (
    <View style={styles.box}>
      {r ? <Text style={styles.strong}>{r.message}</Text> : null}
      {r && r.reasons.length > 0
        ? r.reasons.map((x) => (
            <Text key={x.code} style={styles.line}>
              {x.count} {x.count === 1 ? "statement" : "statements"} {x.label}.
            </Text>
          ))
        : null}
      {r && r.detailsRemoved > 0 ? (
        <Text style={styles.line}>{r.detailsRemoved} extra {r.detailsRemoved === 1 ? "detail was" : "details were"} taken out of results that were kept, because a number in them is not in the source.</Text>
      ) : null}
      {!view.aiUsed ? <Text style={styles.line}>{EVIDENCE_COPY.noAi}</Text> : null}
      {view.textWithheld ? <Text style={styles.line}>{EVIDENCE_COPY.textWithheldNote}</Text> : null}
      <Text style={styles.line}>{view.checkNote}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  strong: { fontSize: 14, fontWeight: "600", color: colors.text, marginBottom: 4 },
  line: { fontSize: 12, lineHeight: 17, color: colors.muted, marginTop: 4 }
});
