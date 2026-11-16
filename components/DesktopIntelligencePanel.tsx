import React from "react";
import { StyleSheet, Text, View, ScrollView, Pressable, Linking } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Paper } from "@/types/models";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import { backendPaperRef } from "@/services/analysisClient";

interface DesktopIntelligencePanelProps {
  paper: Paper | null;
  onClose?: () => void;
}

export function DesktopIntelligencePanel({ paper }: DesktopIntelligencePanelProps) {
  const { colors, fontSizeScale } = useTheme();
  const styles = getStyles(colors, fontSizeScale);

  if (!paper) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="documents-outline" size={48} color={colors.subdued} />
        <Text style={styles.emptyTitle}>Select a Research Paper</Text>
        <Text style={styles.emptySubtitle}>
          Click on any paper in the feed to inspect structured intelligence, empirical evidence, and methodology.
        </Text>
      </View>
    );
  }

  // Sections come from the paper's own brief (built on this device by fixed rules from the abstract). A section is shown only when the brief
  // actually contains it; nothing is filled in with generic text.
  const fullText = paper.fullExplanation || paper.summary || "";
  const extractSection = (regex: RegExp): string | null => {
    const match = fullText.match(regex);
    const t = match && match[1] ? match[1].trim() : "";
    return t || null;
  };
  const contextText = extractSection(/(?:🔬\s*)?\[(?:Context|Background|Abstract)[^\]]*\]\s*([\s\S]*?)(?=(?:⚙️|📊|🔮|\[|$))/i);
  const methodText = extractSection(/(?:⚙️\s*)?\[(?:Technical Methodology|Methodology|Method|Approach)[^\]]*\]\s*([\s\S]*?)(?=(?:📊|🔮|\[|$))/i);
  const resultsText = extractSection(/(?:📊\s*)?\[(?:Key Results|Results|Findings)[^\]]*\]\s*([\s\S]*?)(?=(?:🔮|\[|$))/i);
  const limitationsText = extractSection(/(?:🔮\s*)?\[(?:Future Scope|Future|Horizons|Next Steps)[^\]]*\]\s*([\s\S]*?)(?=$)/i);
  const sections: { icon: React.ComponentProps<typeof Ionicons>["name"]; color: string; title: string; text: string }[] = [
    contextText && contextText !== paper.summary ? { icon: "search-outline" as const, color: "#06B6D4", title: "Problem and motivation", text: contextText } : null,
    methodText ? { icon: "cog-outline" as const, color: "#8B5CF6", title: "Method", text: methodText } : null,
    resultsText ? { icon: "bar-chart-outline" as const, color: "#10B981", title: "Results", text: resultsText } : null,
    limitationsText ? { icon: "telescope-outline" as const, color: "#EC4899", title: "Future work", text: limitationsText } : null
  ].filter((x): x is NonNullable<typeof x> => x !== null);

  const openSource = () => {
    if (paper.originalLink) {
      Linking.openURL(paper.originalLink).catch(() => {});
    }
  };

  const openCopilot = () => {
    router.push({
      pathname: "/research/copilot",
      params: { ref: backendPaperRef(paper) ?? "", title: paper.title }
    } as never);
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      {/* Header Badge Row */}
      <View style={styles.badgeRow}>
        <View style={styles.domainBadge}>
          <Text style={styles.domainText}>{paper.domain.toUpperCase()}</Text>
        </View>
        {paper.pubYear ? (
          <View style={styles.yearBadge}>
            <Text style={styles.yearText}>{paper.pubYear}</Text>
          </View>
        ) : null}
      </View>

      {/* Paper Title */}
      <Text style={styles.title}>{paper.title}</Text>

      {/* Author & Organization */}
      <View style={styles.authorRow}>
        <Ionicons name="person-outline" size={13} color={colors.subdued} />
        <Text style={styles.authorText}>
          {paper.authorName || "Authors not listed"}
          {paper.organization ? ` • ${paper.organization}` : ""}
        </Text>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionRow}>
        {backendPaperRef(paper) ? (
        <Pressable style={styles.copilotBtn} onPress={openCopilot}>
          <LinearGradient
            colors={["#06B6D4", "#6366F1"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.copilotGradient}
          >
            <Ionicons name="sparkles" size={14} color="#FFF" />
            <Text style={styles.copilotText}>Research Copilot</Text>
          </LinearGradient>
        </Pressable>
        ) : null}

        {paper.originalLink ? (
          <Pressable style={styles.sourceBtn} onPress={openSource}>
            <Ionicons name="open-outline" size={14} color={colors.primary} />
            <Text style={styles.sourceText}>Source</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Abstract preview */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Ionicons name="document-text-outline" size={16} color="#F59E0B" />
          <Text style={styles.sectionTitle}>Summary</Text>
        </View>
        <Text style={styles.bodyText}>{paper.summary}</Text>
      </View>

      {sections.map((sec) => (
        <View key={sec.title} style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name={sec.icon} size={16} color={sec.color} />
            <Text style={styles.sectionTitle}>{sec.title}</Text>
          </View>
          <Text style={styles.bodyText}>{sec.text}</Text>
        </View>
      ))}

      {/* Key Takeaways */}
      {paper.insights && paper.insights.length > 0 ? (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name="bulb-outline" size={16} color="#FBBF24" />
            <Text style={styles.sectionTitle}>Key points</Text>
          </View>
          {paper.insights.map((ins, idx) => (
            <View key={idx} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{ins}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={{ color: colors.subdued, fontSize: 11 * fontSizeScale, lineHeight: 16 * fontSizeScale, marginTop: spacing.md }}>
        Built on this device by fixed rules from the abstract. It is not an AI analysis and has not been checked against the full paper. Use the Research Copilot for questions that cite the paper's text.
      </Text>
    </ScrollView>
  );
}

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.card,
      borderLeftWidth: 1,
      borderColor: colors.border
    },
    content: {
      padding: spacing.lg,
      paddingBottom: spacing.xxl
    },
    emptyContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.xl,
      backgroundColor: colors.card,
      borderLeftWidth: 1,
      borderColor: colors.border
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 18 * scale,
      fontWeight: "700",
      marginTop: spacing.md,
      textAlign: "center"
    },
    emptySubtitle: {
      color: colors.subdued,
      fontSize: 13 * scale,
      marginTop: spacing.xs,
      textAlign: "center",
      lineHeight: 18 * scale
    },
    badgeRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: spacing.xs,
      marginBottom: spacing.sm
    },
    domainBadge: {
      backgroundColor: colors.primary + "18",
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.pill
    },
    domainText: {
      color: colors.primary,
      fontSize: 10 * scale,
      fontWeight: "800",
      letterSpacing: 0.6
    },
    yearBadge: {
      backgroundColor: colors.border,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.pill
    },
    yearText: {
      color: colors.text,
      fontSize: 10 * scale,
      fontWeight: "700"
    },
    verifiedBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      backgroundColor: "#10B98114",
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.pill
    },
    verifiedText: {
      color: "#10B981",
      fontSize: 9 * scale,
      fontWeight: "800",
      letterSpacing: 0.5
    },
    title: {
      color: colors.text,
      fontSize: 18 * scale,
      fontWeight: "800",
      lineHeight: 24 * scale,
      marginBottom: spacing.xs
    },
    authorRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginBottom: spacing.md
    },
    authorText: {
      color: colors.subdued,
      fontSize: 12 * scale
    },
    actionRow: {
      flexDirection: "row",
      gap: spacing.sm,
      marginBottom: spacing.lg
    },
    copilotBtn: {
      flex: 1,
      borderRadius: radius.md,
      overflow: "hidden"
    },
    copilotGradient: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: spacing.md
    },
    copilotText: {
      color: "#FFF",
      fontSize: 13 * scale,
      fontWeight: "700"
    },
    sourceBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background
    },
    sourceText: {
      color: colors.primary,
      fontSize: 13 * scale,
      fontWeight: "600"
    },
    sectionCard: {
      backgroundColor: colors.background,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: colors.border
    },
    resultsCard: {
      borderColor: "#10B98133",
      backgroundColor: colors.background
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginBottom: spacing.xs
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 13 * scale,
      fontWeight: "700"
    },
    bodyText: {
      color: colors.text,
      fontSize: 13 * scale,
      lineHeight: 20 * scale,
      opacity: 0.9
    },
    bulletRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 6,
      marginTop: 6
    },
    bulletDot: {
      color: colors.primary,
      fontSize: 14 * scale,
      fontWeight: "900"
    },
    bulletText: {
      color: colors.text,
      fontSize: 12 * scale,
      lineHeight: 18 * scale,
      flex: 1,
      opacity: 0.9
    }
  });
}
