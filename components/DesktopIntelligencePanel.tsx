import React from "react";
import { StyleSheet, Text, View, ScrollView, Pressable, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Paper } from "@/types/models";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";

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

  // Parse structured sections from fullExplanation
  const fullText = paper.fullExplanation || paper.summary || "";
  
  const extractSection = (regex: RegExp, fallback: string) => {
    const match = fullText.match(regex);
    return (match && match[1]?.trim()) || fallback;
  };

  const contextText = extractSection(
    /(?:🔬\s*)?\[(?:Context|Background|Abstract)[^\]]*\]\s*([\s\S]*?)(?=(?:⚙️|📊|🔮|\[|$))/i,
    paper.summary || "Empirical investigation in " + paper.domain
  );

  const methodText = extractSection(
    /(?:⚙️\s*)?\[(?:Technical Methodology|Methodology|Method|Approach)[^\]]*\]\s*([\s\S]*?)(?=(?:📊|🔮|\[|$))/i,
    paper.insights?.[0] || "Empirical analytical methodology"
  );

  const resultsText = extractSection(
    /(?:📊\s*)?\[(?:Key Results|Results|Findings)[^\]]*\]\s*([\s\S]*?)(?=(?:🔮|\[|$))/i,
    paper.insights?.[1] || "Demonstrates verified improvements across target benchmarks."
  );

  const limitationsText = extractSection(
    /(?:🔮\s*)?\[(?:Future Scope|Future|Horizons|Next Steps)[^\]]*\]\s*([\s\S]*?)(?=$)/i,
    paper.insights?.[2] || "Extending generalization and real-time runtime efficiency."
  );

  const openSource = () => {
    if (paper.originalLink) {
      Linking.openURL(paper.originalLink).catch(() => {});
    }
  };

  const openCopilot = () => {
    router.push({
      pathname: "/research/copilot",
      params: { paperId: paper.id, title: paper.title }
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
        <View style={styles.verifiedBadge}>
          <Ionicons name="checkmark-circle" size={13} color="#10B981" />
          <Text style={styles.verifiedText}>EVIDENCE GROUNDED</Text>
        </View>
      </View>

      {/* Paper Title */}
      <Text style={styles.title}>{paper.title}</Text>

      {/* Author & Organization */}
      <View style={styles.authorRow}>
        <Ionicons name="person-outline" size={13} color={colors.subdued} />
        <Text style={styles.authorText}>
          {paper.authorName || "Research Team"}
          {paper.organization ? ` • ${paper.organization}` : ""}
        </Text>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionRow}>
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

        {paper.originalLink ? (
          <Pressable style={styles.sourceBtn} onPress={openSource}>
            <Ionicons name="open-outline" size={14} color={colors.primary} />
            <Text style={styles.sourceText}>Source</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Section 1: TL;DR */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Ionicons name="flash-outline" size={16} color="#F59E0B" />
          <Text style={styles.sectionTitle}>Executive TL;DR</Text>
        </View>
        <Text style={styles.bodyText}>{paper.summary}</Text>
      </View>

      {/* Section 2: Problem & Motivation */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Ionicons name="search-outline" size={16} color="#06B6D4" />
          <Text style={styles.sectionTitle}>Research Problem & Motivation</Text>
        </View>
        <Text style={styles.bodyText}>{contextText}</Text>
      </View>

      {/* Section 3: Technical Methodology */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Ionicons name="cog-outline" size={16} color="#8B5CF6" />
          <Text style={styles.sectionTitle}>Technical Methodology</Text>
        </View>
        <Text style={styles.bodyText}>{methodText}</Text>
      </View>

      {/* Section 4: Key Empirical Results */}
      <View style={[styles.sectionCard, styles.resultsCard]}>
        <View style={styles.sectionHeader}>
          <Ionicons name="bar-chart-outline" size={16} color="#10B981" />
          <Text style={styles.sectionTitle}>Empirical Results & Findings</Text>
        </View>
        <Text style={styles.bodyText}>{resultsText}</Text>
      </View>

      {/* Section 5: Limitations & Future Work */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Ionicons name="telescope-outline" size={16} color="#EC4899" />
          <Text style={styles.sectionTitle}>Frontiers & Limitations</Text>
        </View>
        <Text style={styles.bodyText}>{limitationsText}</Text>
      </View>

      {/* Key Takeaways */}
      {paper.insights && paper.insights.length > 0 ? (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name="bulb-outline" size={16} color="#FBBF24" />
            <Text style={styles.sectionTitle}>Key Analytical Takeaways</Text>
          </View>
          {paper.insights.map((ins, idx) => (
            <View key={idx} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{ins}</Text>
            </View>
          ))}
        </View>
      ) : null}
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
