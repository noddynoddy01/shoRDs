import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius } from "@/constants/theme";

interface SourceQualityCardProps {
  venue: string;
  publisher: string;
  metadataSource: string;
  resolvedFormat: string;
  confidenceScore?: number;
  figureCount?: number;
  tableCount?: number;
  equationCount?: number;
  hasCode?: boolean;
  doi?: string;
}

export const SourceQualityCard: React.FC<SourceQualityCardProps> = ({
  venue,
  publisher,
  metadataSource,
  resolvedFormat,
  confidenceScore = 98,
  figureCount = 4,
  tableCount = 3,
  equationCount = 8,
  hasCode = false,
  doi
}) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.cardContainer}>
      {/* Collapsible Header */}
      <Pressable style={styles.headerRow} onPress={() => setExpanded(!expanded)}>
        <View style={styles.titleRow}>
          <Ionicons name="information-circle-outline" size={16} color={colors.primary || "#818CF8"} />
          <Text style={styles.headerTitle}>ⓘ Source & Technical Metadata</Text>
        </View>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.subdued || "#94A3B8"} />
      </Pressable>

      {/* Collapsible Details Drawer */}
      {expanded && (
        <View style={styles.drawerBody}>
          <View style={styles.metaRow}>
            <Text style={styles.label}>Publishing Venue:</Text>
            <Text style={styles.value}>{venue}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.label}>Academic Publisher:</Text>
            <Text style={styles.value}>{publisher}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.label}>Discovery Gateway:</Text>
            <Text style={styles.value}>{metadataSource}</Text>
          </View>

          {doi && (
            <View style={styles.metaRow}>
              <Text style={styles.label}>Digital Object Identifier:</Text>
              <Text style={[styles.value, { color: colors.primary }]}>{doi}</Text>
            </View>
          )}

          <View style={styles.statsGrid}>
            <View style={styles.statPill}>
              <Text style={styles.statValue}>{resolvedFormat}</Text>
              <Text style={styles.statLabel}>Format</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statValue}>{tableCount}</Text>
              <Text style={styles.statLabel}>Tables</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statValue}>{figureCount}</Text>
              <Text style={styles.statLabel}>Figures</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statValue}>{equationCount}</Text>
              <Text style={styles.statLabel}>Equations</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: radius.md || 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    marginTop: spacing.sm || 8,
    marginBottom: spacing.md || 16,
    overflow: "hidden"
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.sm || 12
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted || "#CBD5E1"
  },
  drawerBody: {
    paddingHorizontal: spacing.sm || 12,
    paddingBottom: spacing.sm || 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
    paddingTop: spacing.xs || 8
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6
  },
  label: {
    fontSize: 12,
    color: colors.subdued || "#94A3B8"
  },
  value: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.text || "#F1F5F9",
    maxWidth: "60%",
    textAlign: "right"
  },
  statsGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    gap: 4
  },
  statPill: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 6,
    paddingVertical: 6,
    alignItems: "center"
  },
  statValue: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.primary || "#818CF8"
  },
  statLabel: {
    fontSize: 10,
    color: colors.subdued || "#94A3B8"
  }
});
