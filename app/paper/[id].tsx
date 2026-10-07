/**
 * Redesigned Research Brief & Reading Experience Screen for shoRDs Research Intelligence OS
 * Shows the on-device brief built from the paper record's own text, with its text basis stated plainly
 * (full text / abstract only / metadata only), and a device text-to-speech read-aloud of exactly that brief.
 * It never invents a paper: an unknown id shows "not found". Nothing here is labelled "verified" unless a
 * verification step actually ran.
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Linking,
  Alert
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius } from "@/constants/theme";

import { usePaperStore } from "@/services/papersStore";
import { SourceQualityCard } from "@/components/SourceQualityCard";
import { EvidenceInspectorDrawer } from "@/components/EvidenceInspectorDrawer";
import { OriginalFigureCard } from "@/components/OriginalFigureCard";
import { AudioBriefPlayer } from "@/components/AudioBriefPlayer";

import {
  generateGroundedResearchBriefAsync,
  GroundedResearchBrief
} from "@/services/paperSummarizer";
import { GroundedClaim } from "@/services/claimVerification";
import {
  generateNarrationScript,
  NarrationScriptPayload
} from "@/services/audioService";
import { Paper } from "@/types/models";

export default function PaperDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { papers, savePaper, isPaperSaved } = usePaperStore();

  const [brief, setBrief] = useState<GroundedResearchBrief | null>(null);
  const [narration, setNarration] = useState<NarrationScriptPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedClaim, setSelectedClaim] = useState<GroundedClaim | null>(null);
  const [selectedSection, setSelectedSection] = useState<{ title: string; content: string } | null>(null);
  const [inspectorVisible, setInspectorVisible] = useState(false);

  // An id that is not in the store is "not found". A made-up placeholder paper must never be shown as real.
  const paper: Paper | null = id ? papers.find((p: Paper) => p.id === id) || null : null;

  const isSaved = paper ? isPaperSaved(paper.id) : false;

  const cleanTitle = (paper?.title || "Untitled record")
    .replace(/\.pdf$/i, "")
    .replace(/[:.,;\-–—]$/, "")
    .trim();

  useEffect(() => {
    if (!paper) {
      setLoading(false);
      return;
    }
    async function loadResearchBrief() {
      if (!paper) return;
      setLoading(true);
      try {
        // A PDF link is not text, and "fullExplanation" is a summary. Only real paper text (fullTextRaw) makes a full-text brief.
        const hasFullText = Boolean((paper as any).fullTextRaw);
        const fullTextStatus = hasFullText ? "FULL_TEXT_PDF" : "ABSTRACT_ONLY";
        const briefData = await generateGroundedResearchBriefAsync({
          id: paper.id,
          title: cleanTitle,
          authors: paper.authorName ? [paper.authorName] : [],
          fullTextStatus,
          summary: paper.summary,
          fullTextRaw: (paper as any).fullTextRaw,
          pdfUri: paper.pdfUri,
          htmlUri: (paper as any).originalLink,
          doi: (paper as any).doi,
          domain: paper.domain
        });

        setBrief(briefData);
        const script = generateNarrationScript(briefData);
        setNarration(script.chapters.length > 0 ? script : null);
      } catch (err) {
        console.error("Error generating grounded research brief:", err);
      } finally {
        setLoading(false);
      }
    }
    loadResearchBrief();
  }, [paper?.id, paper?.pdfUri]);

  const handleOpenOriginalPaper = () => {
    if (!paper) return;
    const doi = (paper as any).doi;
    const targetUrl = paper.pdfUri || (paper as any).originalLink || (doi ? `https://doi.org/${doi}` : "");
    if (targetUrl && targetUrl.startsWith("http")) {
      Linking.openURL(targetUrl).catch(() => Alert.alert("Error", "Could not open original paper URL."));
    } else {
      Alert.alert("Notice", "Full manuscript URL is unavailable for this record.");
    }
  };

  const handleOpenInspector = (claim?: GroundedClaim, section?: { title: string; content: string }) => {
    setSelectedClaim(claim || null);
    setSelectedSection(section || null);
    setInspectorVisible(true);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Preparing the brief...</Text>
      </View>
    );
  }

  if (!paper) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>This paper was not found in your library.</Text>
        <Pressable style={[styles.primaryActionBtn, { marginTop: spacing.lg }]} onPress={() => router.back()}>
          <Text style={styles.primaryActionBtnText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const isAbstractOnly = brief?.summaryMode === "ABSTRACT_ONLY";
  const isMetadataOnly = brief?.summaryMode === "METADATA_ONLY";

  return (
    <View style={styles.container}>
      {/* Header Bar */}
      <View style={styles.topHeader}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="arrow-back" size={20} color={colors.text || "#FFF"} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Research Brief</Text>
        <Pressable onPress={() => savePaper(paper.id)} style={styles.iconBtn}>
          <Ionicons name={isSaved ? "bookmark" : "bookmark-outline"} size={20} color={colors.primary || "#818CF8"} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.desktopReaderWrapper}>
        {/* Abstract-Only / Metadata Notice Banner */}
        {isAbstractOnly && (
          <View style={styles.noticeBanner}>
            <Ionicons name="information-circle" size={16} color="#F59E0B" />
            <Text style={styles.noticeText}>Full text was not available, so this brief is limited to the abstract.</Text>
          </View>
        )}

        {isMetadataOnly && (
          <View style={[styles.noticeBanner, { backgroundColor: "rgba(239, 68, 68, 0.12)" }]}>
            <Ionicons name="alert-circle" size={16} color="#EF4444" />
            <Text style={[styles.noticeText, { color: "#EF4444" }]}>Full text was not available, so this brief is limited to metadata.</Text>
          </View>
        )}

        {/* 30-Second Understanding Top Card */}
        <View style={styles.card}>
          <View style={styles.badgeRow}>
            <View style={styles.provenanceBadge}>
              <Ionicons name="information-circle-outline" size={12} color={colors.muted} />
              <Text style={styles.provenanceBadgeText}>
                {isMetadataOnly
                  ? "BASED ON: METADATA ONLY"
                  : isAbstractOnly
                    ? "BASED ON: ABSTRACT ONLY"
                    : "BASED ON: FULL TEXT SUPPLIED WITH THIS RECORD"}
              </Text>
            </View>
            <View style={styles.readingTimeChip}>
              <Ionicons name="time-outline" size={12} color={colors.muted} />
              <Text style={styles.readingTimeText}>{brief ? `${brief.readingTimeMinutes} MIN READ` : ""}</Text>
            </View>
          </View>

          {paper.domain ? <Text style={styles.domainTag}>[{paper.domain}]</Text> : null}

          {/* Clean Title */}
          <Text style={styles.cleanTitle}>{cleanTitle}</Text>

          {/* Authors & Venue */}
          {paper.authorName ? <Text style={styles.authorText}>{paper.authorName}</Text> : null}
          {(() => {
            const line = [(paper as any).venue || paper.organization, paper.pubYear].filter(Boolean).join(" • ");
            return line ? <Text style={styles.venueText}>{line}</Text> : null;
          })()}

          {/* Primary Action Button: Read Original Paper */}
          <Pressable style={styles.primaryActionBtn} onPress={handleOpenOriginalPaper}>
            <Ionicons name="document-text" size={16} color="#FFF" />
            <Text style={styles.primaryActionBtnText}>Read Original Paper ({paper.pdfUri ? "PDF" : "Web"})</Text>
          </Pressable>
        </View>

        {/* Device text-to-speech of the brief shown below */}
        {narration && <AudioBriefPlayer narration={narration} />}

        {/* Collapsible Source & Technical Metadata Drawer */}
        <SourceQualityCard
          venue={(paper as any).venue || paper.organization || "Not provided"}
          publisher={(paper as any).publisher || paper.organization || "Not provided"}
          metadataSource={(paper as any).metadataSource || "Not recorded"}
          resolvedFormat={brief?.summaryMode === "FULL_TEXT" ? "FULL_TEXT_PDF" : brief?.summaryMode === "ABSTRACT_ONLY" ? "ABSTRACT_ONLY" : "METADATA_ONLY"}
          doi={(paper as any).doi}
        />

        {/* 9-Section Grounded Editorial Research Brief */}
        {brief?.sections.map((sec, idx) => (
          <View key={sec.sectionId || idx} style={styles.sectionCard}>
            <View style={styles.secHeaderRow}>
              <Text style={styles.secTitle}>{sec.title}</Text>
              <Pressable
                style={styles.inspectBtn}
                onPress={() => handleOpenInspector(sec.claims[0], { title: sec.title, content: sec.content })}
              >
                <Ionicons name="search-outline" size={13} color={colors.primary || "#818CF8"} />
                <Text style={styles.inspectBtnText}>Evidence</Text>
              </Pressable>
            </View>

            <Text style={styles.secContent}>{sec.content}</Text>

            {/* Embed Original Figures under Section 05: The Evidence */}
            {sec.title.includes("05") && brief.figures && brief.figures.length > 0 && (
              <View style={styles.figuresSection}>
                {brief.figures.map(fig => (
                  <OriginalFigureCard key={fig.id} figure={fig} />
                ))}
              </View>
            )}

            {/* Claims & Provenance Links */}
            {sec.claims.map((claim, cIdx) => (
              <Pressable
                key={claim.claimId || cIdx}
                style={styles.claimLinkBox}
                onPress={() => handleOpenInspector(claim)}
              >
                <Ionicons name="link-outline" size={12} color={colors.primary || "#818CF8"} />
                <Text style={styles.claimLinkText}>
                  {claim.evidence && claim.evidence.length > 0 ? `Source passage: ${claim.evidence[0].chunkId}` : "No source passage recorded"}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}

        {/* Section 06 · Key Numbers (extracted from the text, not independently checked) */}
        <View style={styles.keyNumbersCard}>
          <Text style={styles.secTitle}>06 · Key Numbers</Text>
          {brief?.keyNumbers && brief.keyNumbers.length > 0 ? (
            <View style={styles.numbersGrid}>
              {brief.keyNumbers.map((num, nIdx) => (
                <View key={nIdx} style={styles.numberBox}>
                  <Text style={styles.numberValue}>{num.value}</Text>
                  <Text style={styles.numberLabel}>{num.label}</Text>
                  <Text style={styles.numberContext}>{num.context}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.secContent, { fontStyle: "italic", marginTop: spacing.xs, color: colors.muted }]}>
              No quantitative result was found in the text available for this record.
            </Text>
          )}
        </View>

        {/* Section 09 · What to Remember Takeaways */}
        {brief?.takeaways && brief.takeaways.length > 0 && (
          <View style={styles.takeawaysCard}>
            <Text style={styles.secTitle}>09 · What to Remember</Text>
            {brief.takeaways.map((takeaway, tIdx) => (
              <View key={tIdx} style={styles.takeawayRow}>
                <Text style={styles.takeawayNum}>{`0${tIdx + 1}`}</Text>
                <Text style={styles.takeawayText}>{takeaway}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Bottom CTA Button */}
        <Pressable style={[styles.primaryActionBtn, { marginVertical: spacing.lg }]} onPress={handleOpenOriginalPaper}>
          <Ionicons name="open-outline" size={16} color="#FFF" />
          <Text style={styles.primaryActionBtnText}>Read Complete Original Manuscript</Text>
        </Pressable>
        </View>
      </ScrollView>

      {/* Interactive Evidence Inspector Drawer */}
      <EvidenceInspectorDrawer
        visible={inspectorVisible}
        onClose={() => setInspectorVisible(false)}
        claim={selectedClaim}
        sectionTitle={selectedSection?.title}
        sectionContent={selectedSection?.content}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background || "#0F172A"
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background || "#0F172A",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: 14,
    color: colors.muted || "#94A3B8",
    textAlign: "center"
  },
  topHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border || "rgba(255, 255, 255, 0.08)"
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text || "#FFF",
    flex: 1,
    textAlign: "center",
    marginHorizontal: spacing.sm
  },
  iconBtn: {
    padding: spacing.xs
  },
  scrollContent: {
    padding: spacing.md,
    alignItems: "center"
  },
  desktopReaderWrapper: {
    width: "100%",
    maxWidth: 880
  },
  noticeBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    padding: spacing.sm + 2,
    borderRadius: radius.sm,
    marginBottom: spacing.md
  },
  noticeText: {
    fontSize: 12,
    color: "#F59E0B",
    marginLeft: 8,
    flex: 1,
    fontWeight: "500"
  },
  card: {
    backgroundColor: colors.card || "#1E293B",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border || "rgba(255, 255, 255, 0.08)"
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs
  },
  provenanceBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs
  },
  provenanceBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#10B981",
    marginLeft: 4,
    letterSpacing: 0.5
  },
  readingTimeChip: {
    flexDirection: "row",
    alignItems: "center"
  },
  readingTimeText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted || "#94A3B8",
    marginLeft: 4
  },
  domainTag: {
    fontSize: 11,
    color: colors.primary || "#818CF8",
    fontWeight: "700",
    textTransform: "uppercase",
    marginVertical: 4
  },
  cleanTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.text || "#FFF",
    marginVertical: spacing.xs,
    lineHeight: 26
  },
  authorText: {
    fontSize: 13,
    color: colors.text || "#E2E8F0",
    fontWeight: "600",
    marginTop: 2
  },
  venueText: {
    fontSize: 12,
    color: colors.muted || "#94A3B8",
    marginBottom: spacing.md
  },
  primaryActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary || "#818CF8",
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.sm
  },
  primaryActionBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFF",
    marginLeft: 8
  },
  sectionCard: {
    backgroundColor: colors.card || "#1E293B",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border || "rgba(255, 255, 255, 0.08)"
  },
  secHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs + 2
  },
  secTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.primary || "#818CF8"
  },
  inspectBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(129, 140, 248, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs
  },
  inspectBtnText: {
    fontSize: 11,
    color: colors.primary || "#818CF8",
    fontWeight: "600",
    marginLeft: 4
  },
  secContent: {
    fontSize: 14,
    color: colors.text || "#E2E8F0",
    lineHeight: 22
  },
  figuresSection: {
    marginTop: spacing.sm
  },
  claimLinkBox: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xs + 4,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)"
  },
  claimLinkText: {
    fontSize: 11,
    color: colors.primary || "#818CF8",
    marginLeft: 4,
    fontWeight: "500"
  },
  keyNumbersCard: {
    backgroundColor: colors.card || "#1E293B",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border || "rgba(255, 255, 255, 0.08)"
  },
  numbersGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: spacing.xs
  },
  numberBox: {
    width: "48%",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginBottom: spacing.xs
  },
  numberValue: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.primary || "#818CF8"
  },
  numberLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text || "#FFF",
    marginTop: 2
  },
  numberContext: {
    fontSize: 10,
    color: colors.muted || "#94A3B8",
    marginTop: 2
  },
  takeawaysCard: {
    backgroundColor: colors.card || "#1E293B",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border || "rgba(255, 255, 255, 0.08)"
  },
  takeawayRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: spacing.xs + 2
  },
  takeawayNum: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.primary || "#818CF8",
    marginRight: 8,
    width: 22
  },
  takeawayText: {
    fontSize: 13,
    color: colors.text || "#E2E8F0",
    flex: 1,
    lineHeight: 19
  }
});
