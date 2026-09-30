import React from "react";
import { StyleSheet, Text, View, Pressable, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Paper } from "@/types/models";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";

interface DesktopPaperCardProps {
  paper: Paper;
  isSelectedForIntelligence: boolean;
  onSelectForIntelligence: () => void;
  isChecked: boolean;
  onToggleCheck: () => void;
}

export function DesktopPaperCard({
  paper,
  isSelectedForIntelligence,
  onSelectForIntelligence,
  isChecked,
  onToggleCheck
}: DesktopPaperCardProps) {
  const { colors, fontSizeScale } = useTheme();
  const styles = getStyles(colors, fontSizeScale, isSelectedForIntelligence);

  const openSource = (e: any) => {
    e?.stopPropagation?.();
    if (paper.originalLink) {
      Linking.openURL(paper.originalLink).catch(() => {});
    }
  };

  const openCopilot = (e: any) => {
    e?.stopPropagation?.();
    router.push({
      pathname: "/research/copilot",
      params: { paperId: paper.id, title: paper.title }
    } as never);
  };

  const openPaperDetail = (e: any) => {
    e?.stopPropagation?.();
    router.push({
      pathname: `/paper/${paper.id}`,
      params: { paper: JSON.stringify(paper) }
    } as never);
  };

  return (
    <Pressable
      style={styles.card}
      onPress={onSelectForIntelligence}
    >
      {/* Top Meta Header */}
      <View style={styles.topRow}>
        <View style={styles.metaLeft}>
          <Pressable onPress={onToggleCheck} style={styles.checkbox}>
            <Ionicons
              name={isChecked ? "checkbox" : "square-outline"}
              size={18}
              color={isChecked ? colors.primary : colors.subdued}
            />
          </Pressable>
          <View style={styles.domainBadge}>
            <Text style={styles.domainText}>{paper.domain.toUpperCase()}</Text>
          </View>
          {paper.pubYear ? (
            <Text style={styles.yearText}>• {paper.pubYear}</Text>
          ) : null}
          <View style={styles.verifiedTag}>
            <Ionicons name="shield-checkmark" size={11} color="#10B981" />
            <Text style={styles.verifiedTagText}>Peer-Grounded</Text>
          </View>
        </View>

        <View style={styles.metaRight}>
          <Text style={styles.readingTimeText}>
            <Ionicons name="time-outline" size={12} color={colors.subdued} /> {paper.readingTime || "3 min read"}
          </Text>
        </View>
      </View>

      {/* Title */}
      <Text style={styles.title} numberOfLines={2}>
        {paper.title}
      </Text>

      {/* Authors & Organization */}
      <Text style={styles.authors} numberOfLines={1}>
        <Ionicons name="people-outline" size={12} color={colors.subdued} /> {paper.authorName || "Research Team"}
        {paper.organization ? ` • ${paper.organization}` : ""}
      </Text>

      {/* TL;DR Summary */}
      <Text style={styles.summary} numberOfLines={3}>
        {paper.summary}
      </Text>

      {/* Empirical Highlights */}
      {paper.insights && paper.insights.length > 0 ? (
        <View style={styles.insightBox}>
          <Ionicons name="analytics-outline" size={14} color="#06B6D4" />
          <Text style={styles.insightText} numberOfLines={2}>
            {paper.insights[0]}
          </Text>
        </View>
      ) : null}

      {/* Action Footer */}
      <View style={styles.footerRow}>
        <View style={styles.footerLeft}>
          <Pressable style={styles.detailBtn} onPress={openPaperDetail}>
            <Text style={styles.detailBtnText}>Full Breakdown</Text>
            <Ionicons name="arrow-forward" size={13} color={colors.primary} />
          </Pressable>

          <Pressable style={styles.actionIconBtn} onPress={openCopilot}>
            <Ionicons name="sparkles" size={14} color="#6366F1" />
            <Text style={styles.actionIconBtnText}>Copilot</Text>
          </Pressable>

          {paper.originalLink ? (
            <Pressable style={styles.actionIconBtn} onPress={openSource}>
              <Ionicons name="document-text-outline" size={14} color={colors.subdued} />
              <Text style={styles.actionIconBtnText}>PDF Source</Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable
          style={[styles.inspectBtn, isSelectedForIntelligence && styles.inspectBtnActive]}
          onPress={onSelectForIntelligence}
        >
          <Ionicons
            name={isSelectedForIntelligence ? "eye" : "eye-outline"}
            size={14}
            color={isSelectedForIntelligence ? "#FFF" : colors.primary}
          />
          <Text style={[styles.inspectBtnText, isSelectedForIntelligence && styles.inspectBtnTextActive]}>
            {isSelectedForIntelligence ? "Inspecting" : "Inspect"}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, isSelected: boolean) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
      borderWidth: 1.5,
      borderColor: isSelected ? colors.primary : colors.border,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 3,
      elevation: 1
    },
    topRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: spacing.xs
    },
    metaLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs
    },
    checkbox: {
      marginRight: 4
    },
    domainBadge: {
      backgroundColor: colors.primary + "18",
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.pill
    },
    domainText: {
      color: colors.primary,
      fontSize: 10 * scale,
      fontWeight: "800",
      letterSpacing: 0.5
    },
    yearText: {
      color: colors.subdued,
      fontSize: 11 * scale,
      fontWeight: "600"
    },
    verifiedTag: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      backgroundColor: "#10B98114",
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radius.pill
    },
    verifiedTagText: {
      color: "#10B981",
      fontSize: 9 * scale,
      fontWeight: "700"
    },
    metaRight: {
      flexDirection: "row",
      alignItems: "center"
    },
    readingTimeText: {
      color: colors.subdued,
      fontSize: 11 * scale
    },
    title: {
      color: colors.text,
      fontSize: 16 * scale,
      fontWeight: "800",
      lineHeight: 22 * scale,
      marginTop: spacing.xs,
      marginBottom: spacing.xs
    },
    authors: {
      color: colors.subdued,
      fontSize: 12 * scale,
      marginBottom: spacing.sm
    },
    summary: {
      color: colors.text,
      fontSize: 13 * scale,
      lineHeight: 19 * scale,
      opacity: 0.88,
      marginBottom: spacing.sm
    },
    insightBox: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.xs,
      backgroundColor: colors.background,
      padding: spacing.sm,
      borderRadius: radius.sm,
      borderLeftWidth: 3,
      borderLeftColor: "#06B6D4",
      marginBottom: spacing.sm
    },
    insightText: {
      color: colors.text,
      fontSize: 12 * scale,
      lineHeight: 17 * scale,
      flex: 1,
      opacity: 0.9
    },
    footerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: spacing.xs,
      paddingTop: spacing.xs,
      borderTopWidth: 1,
      borderColor: colors.border + "88"
    },
    footerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm
    },
    detailBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: 4
    },
    detailBtnText: {
      color: colors.primary,
      fontSize: 12 * scale,
      fontWeight: "700"
    },
    actionIconBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: radius.sm,
      backgroundColor: colors.background
    },
    actionIconBtnText: {
      color: colors.text,
      fontSize: 11 * scale,
      fontWeight: "500"
    },
    inspectBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.background
    },
    inspectBtnActive: {
      backgroundColor: colors.primary
    },
    inspectBtnText: {
      color: colors.primary,
      fontSize: 11 * scale,
      fontWeight: "700"
    },
    inspectBtnTextActive: {
      color: "#FFF"
    }
  });
}
