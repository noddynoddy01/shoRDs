import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { Screen } from "@/components/Screen";
import {
  executeRefinedResearchReviewQuery,
  exportReview,
  RefinedResearchReviewResult
} from "@/services/researchReviewClient";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";

export default function ResearchReviewScreen() {
  const { colors, fontSizeScale } = useTheme();

  const [query, setQuery] = useState("What are the current approaches to low-power edge AI?");
  const [isLoading, setIsLoading] = useState(false);
  const [reviewResult, setReviewResult] = useState<RefinedResearchReviewResult | null>(null);
  const [selectedReadingTab, setSelectedReadingTab] = useState<"beginner" | "researcher" | "sota" | "implementation">("researcher");

  const handleExecuteReview = async () => {
    if (!query.trim()) return;
    setIsLoading(true);
    const result = await executeRefinedResearchReviewQuery(query);
    setReviewResult(result);
    setIsLoading(false);
  };

  const handleExport = (format: "pdf" | "docx" | "markdown" | "bibtex" | "latex_bib" | "csl_json") => {
    if (!reviewResult) return;
    const content = exportReview(format, reviewResult);
    Alert.alert(`Exported as ${format.toUpperCase()}`, content.slice(0, 200) + "...");
  };

  const styles = getStyles(colors, fontSizeScale);

  return (
    <Screen style={styles.container}>
      {/* Header Bar */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerSubtitle}>SCIENTIFIC LITERATURE SYNTHESIS</Text>
          <Text style={styles.headerTitle}>Research Review Mode</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Research Question Input Box */}
        <View style={styles.queryCard}>
          <Text style={styles.queryLabel}>Enter Open Research Question:</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="e.g. What are the current approaches to low-power edge AI?"
              placeholderTextColor={colors.muted}
            />
            <Pressable style={styles.runBtn} onPress={handleExecuteReview}>
              <Ionicons name="sparkles" size={18} color="#FFF" />
            </Pressable>
          </View>
        </View>

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Computing dynamic 9-signal evidence score & domain shifts...</Text>
          </View>
        ) : reviewResult ? (
          <View>
            {/* Dynamic Multi-Signal Evidence Score Card */}
            <View style={styles.scoreCard}>
              <View style={styles.scoreHeaderRow}>
                <View style={styles.scoreBadge}>
                  <Text style={styles.scoreNum}>{reviewResult.evidence_quality_score.score}</Text>
                  <Text style={styles.scoreMax}>/ 100</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.scoreTitle}>Dynamic Evidence Quality Score</Text>
                  <Text style={styles.scoreSub}>Evaluated dynamically across 9 scientific rigor signals.</Text>
                </View>
              </View>

              {/* Contributors Checklist */}
              <View style={styles.contributorsBox}>
                {reviewResult.evidence_quality_score.contributors.map((contrib, idx) => (
                  <Text key={idx} style={styles.contribText}>{contrib}</Text>
                ))}
              </View>
            </View>

            {/* Evidence Composition Breakdown */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionHeader}>Evidence Composition</Text>
              <View style={styles.compositionRow}>
                {Object.entries(reviewResult.evidence_composition).map(([key, pct]) => (
                  <View key={key} style={styles.compPill}>
                    <Text style={styles.compLabel}>{key}</Text>
                    <Text style={styles.compVal}>{pct}%</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Domain-Shift Contradiction Analysis */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="git-compare-outline" size={20} color={colors.warning} />
                <Text style={styles.sectionHeader}>Domain-Shift Contradiction Cause Analysis</Text>
              </View>
              {reviewResult.contradiction_causes.map((item, idx) => (
                <View key={idx} style={styles.contradictionBox}>
                  <Text style={styles.contradictionIssue}>{item.issue}</Text>
                  <Text style={styles.contradictionPapers}>{item.paper_a} vs. {item.paper_b}</Text>
                  <Text style={styles.contradictionExp}><Text style={{ fontWeight: "700", color: colors.warning }}>Root Cause Analysis:</Text> {item.explanation}</Text>
                </View>
              ))}
            </View>

            {/* Interactive Benchmark Evolution Table */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="stats-chart-outline" size={20} color={colors.primary} />
                <Text style={styles.sectionHeader}>Interactive Benchmark Evolution Table</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  <View style={styles.tableRowHeader}>
                    <Text style={[styles.cell, { width: 50, fontWeight: "800" }]}>Year</Text>
                    <Text style={[styles.cell, { width: 140, fontWeight: "800" }]}>Method</Text>
                    <Text style={[styles.cell, { width: 80, fontWeight: "800" }]}>Accuracy</Text>
                    <Text style={[styles.cell, { width: 70, fontWeight: "800" }]}>Latency</Text>
                    <Text style={[styles.cell, { width: 70, fontWeight: "800" }]}>Memory</Text>
                    <Text style={[styles.cell, { width: 130, fontWeight: "800" }]}>Improvement Delta</Text>
                  </View>
                  {reviewResult.benchmark_table.map((row, idx) => (
                    <View key={idx} style={[styles.tableRow, row.delta.includes("SOTA") && styles.sotaRow]}>
                      <Text style={[styles.cell, { width: 50 }]}>{row.year}</Text>
                      <Text style={[styles.cell, { width: 140, fontWeight: "700" }]}>{row.method}</Text>
                      <Text style={[styles.cell, { width: 80 }]}>{row.accuracy}</Text>
                      <Text style={[styles.cell, { width: 70 }]}>{row.latency}</Text>
                      <Text style={[styles.cell, { width: 70 }]}>{row.memory}</Text>
                      <Text style={[styles.cell, { width: 130, color: colors.primary, fontWeight: "700" }]}>{row.delta}</Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* Multi-Track Reading Paths */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="map-outline" size={20} color={colors.primary} />
                <Text style={styles.sectionHeader}>Multi-Track Reading Paths</Text>
              </View>

              <View style={styles.tabRow}>
                {(["beginner", "researcher", "sota", "implementation"] as const).map(tab => (
                  <Pressable
                    key={tab}
                    style={[styles.tabBtn, selectedReadingTab === tab && styles.tabBtnActive]}
                    onPress={() => setSelectedReadingTab(tab)}
                  >
                    <Text style={[styles.tabBtnText, selectedReadingTab === tab && styles.tabBtnTextActive]}>
                      {tab.toUpperCase()}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {selectedReadingTab === "implementation" ? (
                reviewResult.reading_paths.implementation.map((res, idx) => (
                  <Pressable key={idx} style={styles.implRow} onPress={() => Linking.openURL(res.url)}>
                    <Ionicons name="code-slash-outline" size={16} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.implTitle}>[{res.type}] {res.title}</Text>
                      <Text style={styles.implUrl}>{res.url}</Text>
                    </View>
                  </Pressable>
                ))
              ) : (
                reviewResult.reading_paths[selectedReadingTab].map((step, idx) => (
                  <View key={idx} style={styles.readingStepRow}>
                    <View style={styles.stepCircle}><Text style={styles.stepNum}>{step.step}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stepTitle}>{step.title}</Text>
                      <Text style={styles.stepReason}>{step.reason}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* Review Statistics Block */}
            <View style={styles.statsCard}>
              <Text style={styles.statsTitle}>Review Statistics & Audit Meta</Text>
              <Text style={styles.statsRow}>• Papers Analysed: {reviewResult.review_statistics.papers_analysed} ({reviewResult.review_statistics.full_text_processed} full-text, {reviewResult.review_statistics.abstract_only} abstract-only)</Text>
              <Text style={styles.statsRow}>• Years Covered: {reviewResult.review_statistics.years_covered}</Text>
              <Text style={styles.statsRow}>• Peer-Reviewed / Top-Tier: {reviewResult.review_statistics.peer_reviewed_pct} | Preprints: {reviewResult.review_statistics.preprints_pct}</Text>
              <Text style={styles.statsRow}>• Review Confidence: {reviewResult.review_statistics.review_confidence}</Text>
            </View>

            {/* Export Buttons */}
            <View style={styles.exportRow}>
              <Pressable style={styles.exportBtn} onPress={() => handleExport("pdf")}>
                <Ionicons name="download-outline" size={15} color="#FFF" />
                <Text style={styles.exportBtnText}>PDF</Text>
              </Pressable>

              <Pressable style={styles.exportBtn} onPress={() => handleExport("docx")}>
                <Ionicons name="document-text-outline" size={15} color="#FFF" />
                <Text style={styles.exportBtnText}>DOCX</Text>
              </Pressable>

              <Pressable style={styles.exportBtn} onPress={() => handleExport("bibtex")}>
                <Ionicons name="journal-outline" size={15} color="#FFF" />
                <Text style={styles.exportBtnText}>BibTeX (.bib)</Text>
              </Pressable>

              <Pressable style={styles.exportBtn} onPress={() => handleExport("markdown")}>
                <Ionicons name="logo-markdown" size={15} color="#FFF" />
                <Text style={styles.exportBtnText}>Markdown</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={styles.startBanner} onPress={handleExecuteReview}>
            <Ionicons name="compass-outline" size={32} color={colors.primary} style={{ marginBottom: 6 }} />
            <Text style={styles.startBannerTitle}>Synthesize State of the Field</Text>
            <Text style={styles.startBannerDesc}>Tap to execute 9-stage literature review, dynamic evidence scoring, and domain-shift contradiction analysis.</Text>
          </Pressable>
        )}
      </ScrollView>
    </Screen>
  );
}

function getStyles(colors: any, scale: number) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
    backBtn: { padding: 4, marginRight: spacing.sm },
    headerSubtitle: { fontSize: 10 * scale, fontWeight: "800", color: colors.primary, letterSpacing: 1 },
    headerTitle: { fontSize: 16 * scale, fontWeight: "800", color: colors.text },
    scrollContent: { padding: spacing.md, paddingBottom: 60 },
    queryCard: { backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
    queryLabel: { fontSize: 12 * scale, fontWeight: "700", color: colors.primary, marginBottom: spacing.xs },
    inputRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    input: { flex: 1, backgroundColor: colors.background, color: colors.text, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs + 2, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, fontSize: 13 * scale },
    runBtn: { backgroundColor: colors.primary, padding: spacing.xs + 4, borderRadius: radius.sm, justifyContent: "center", alignItems: "center" },
    loadingBox: { padding: spacing.xl, alignItems: "center" },
    loadingText: { marginTop: spacing.md, color: colors.muted, fontSize: 13 * scale },
    scoreCard: { backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.primary },
    scoreHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm },
    scoreBadge: { backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
    scoreNum: { fontSize: 24 * scale, fontWeight: "900", color: "#FFF" },
    scoreMax: { fontSize: 10 * scale, color: "#FFF", opacity: 0.8 },
    scoreTitle: { fontSize: 15 * scale, fontWeight: "800", color: colors.text },
    scoreSub: { fontSize: 11 * scale, color: colors.muted },
    contributorsBox: { backgroundColor: colors.background, padding: spacing.xs + 4, borderRadius: radius.sm },
    contribText: { fontSize: 11 * scale, color: colors.subdued, marginVertical: 1 },
    sectionCard: { backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm, gap: 6 },
    sectionHeader: { fontSize: 14 * scale, fontWeight: "800", color: colors.text },
    compositionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
    compPill: { backgroundColor: colors.background, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
    compLabel: { fontSize: 10 * scale, color: colors.muted },
    compVal: { fontSize: 12 * scale, fontWeight: "800", color: colors.primary },
    contradictionBox: { backgroundColor: colors.background, padding: spacing.sm, borderRadius: radius.sm, borderLeftWidth: 3, borderLeftColor: colors.warning },
    contradictionIssue: { fontSize: 13 * scale, fontWeight: "800", color: colors.text },
    contradictionPapers: { fontSize: 11 * scale, color: colors.muted, marginVertical: 2 },
    contradictionExp: { fontSize: 12 * scale, color: colors.subdued, lineHeight: 18 },
    tableRowHeader: { flexDirection: "row", backgroundColor: colors.background, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 4 },
    tableRow: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
    sotaRow: { backgroundColor: colors.primary + "10" },
    cell: { fontSize: 11 * scale, color: colors.text },
    tabRow: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.sm },
    tabBtn: { flex: 1, paddingVertical: 6, alignItems: "center", borderRadius: radius.sm, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    tabBtnText: { fontSize: 10 * scale, fontWeight: "700", color: colors.muted },
    tabBtnTextActive: { color: "#FFF" },
    implRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
    implTitle: { fontSize: 12 * scale, fontWeight: "700", color: colors.text },
    implUrl: { fontSize: 10 * scale, color: colors.primary },
    readingStepRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.xs, gap: spacing.sm },
    stepCircle: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, justifyContent: "center", alignItems: "center" },
    stepNum: { color: "#FFF", fontWeight: "800", fontSize: 11 * scale },
    stepTitle: { fontSize: 12 * scale, fontWeight: "700", color: colors.text },
    stepReason: { fontSize: 11 * scale, color: colors.muted },
    statsCard: { backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
    statsTitle: { fontSize: 13 * scale, fontWeight: "800", color: colors.text, marginBottom: 4 },
    statsRow: { fontSize: 11 * scale, color: colors.subdued, marginVertical: 1 },
    exportRow: { flexDirection: "row", gap: spacing.xs, justifyContent: "space-between" },
    exportBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, paddingVertical: spacing.xs + 2, borderRadius: radius.sm, gap: 4 },
    exportBtnText: { color: "#FFF", fontWeight: "700", fontSize: 11 * scale },
    startBanner: { backgroundColor: colors.surface, padding: spacing.xl, borderRadius: radius.md, alignItems: "center", borderWidth: 1, borderColor: colors.border },
    startBannerTitle: { fontSize: 16 * scale, fontWeight: "800", color: colors.text, marginBottom: 4 },
    startBannerDesc: { fontSize: 12 * scale, color: colors.subdued, textAlign: "center", lineHeight: 18 }
  });
}
