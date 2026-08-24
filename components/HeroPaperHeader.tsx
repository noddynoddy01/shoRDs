import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/context/ThemeContext";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { Paper } from "@/types/models";

export interface HeroPaperHeaderProps {
  paper: Paper;
}

export function HeroPaperHeader({ paper }: HeroPaperHeaderProps) {
  const { colors, fontSizeScale, theme } = useTheme();
  const styles = getStyles(colors, fontSizeScale, theme);

  return (
    <View style={styles.heroBox}>
      <LinearGradient
        colors={["rgba(6, 182, 212, 0.18)", "rgba(139, 92, 246, 0.05)", "transparent"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.badgeRow}>
        <View style={styles.domainPill}>
          <Text style={styles.domainText}>{paper.domain.toUpperCase()}</Text>
        </View>
        <View style={styles.readTimeRow}>
          <Ionicons name="time-outline" size={12} color={colors.subdued} />
          <Text style={styles.readTimeText}>{paper.readingTime}</Text>
        </View>
      </View>

      <Text style={styles.titleText}>{paper.title}</Text>

      <Text style={styles.hookText} numberOfLines={2}>
        "{paper.summary}"
      </Text>

      <View style={styles.authorMeta}>
        <Text style={styles.authorName}>{paper.authorName}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.organizationText}>{paper.organization || "Academic Researcher"}</Text>
      </View>
    </View>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string) {
  return StyleSheet.create({
    heroBox: {
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      padding: spacing.md,
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden"
    },
    badgeRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between"
    },
    domainPill: {
      backgroundColor: colors.primary + "12",
      borderColor: colors.primary + "2C",
      borderWidth: 1,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill
    },
    domainText: {
      fontSize: 9 * scale,
      fontWeight: "800",
      color: colors.primary,
      letterSpacing: 1
    },
    readTimeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4
    },
    readTimeText: {
      fontSize: 10 * scale,
      color: colors.subdued,
      fontWeight: "700"
    },
    titleText: {
      fontSize: 22 * scale,
      fontWeight: "800",
      color: colors.text,
      lineHeight: 30 * scale
    },
    hookText: {
      fontSize: 13 * scale,
      lineHeight: 20 * scale,
      color: colors.muted,
      fontStyle: "italic"
    },
    authorMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 2
    },
    authorName: {
      fontSize: 12 * scale,
      fontWeight: "800",
      color: colors.text
    },
    metaDot: {
      color: colors.subdued
    },
    organizationText: {
      fontSize: 11 * scale,
      color: colors.subdued,
      fontWeight: "600"
    }
  });
}
