import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/context/ThemeContext";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";

export interface NodeItem {
  id: string;
  label: string;
  type: "topic" | "author" | "citation";
  count?: number;
}

export interface PerplexitySearchGraphProps {
  query: string;
  onNodeSelect: (label: string) => void;
}

export function PerplexitySearchGraph({ query, onNodeSelect }: PerplexitySearchGraphProps) {
  const { colors, fontSizeScale, theme } = useTheme();
  const styles = getStyles(colors, fontSizeScale, theme);

  const nodes: NodeItem[] = [
    { id: "1", label: "Attention Mechanisms", type: "topic", count: 42 },
    { id: "2", label: "Qwen2-VL", type: "topic", count: 18 },
    { id: "3", label: "Vaswani et al.", type: "author", count: 140 },
    { id: "4", label: "arXiv:2401.0821", type: "citation", count: 9 },
    { id: "5", label: "IIIT Surat AI Lab", type: "author", count: 24 }
  ];

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Ionicons name="git-network-outline" size={16} color={colors.primary} />
        <Text style={styles.graphTitle}>Semantic Knowledge Map</Text>
      </View>

      <View style={styles.graphCanvas}>
        {nodes.map((node) => {
          const isTopic = node.type === "topic";
          const isAuthor = node.type === "author";
          return (
            <Pressable
              key={node.id}
              style={[
                styles.nodeChip,
                isTopic && styles.topicNode,
                isAuthor && styles.authorNode
              ]}
              onPress={() => onNodeSelect(node.label)}
            >
              <Ionicons
                name={isTopic ? "sparkles-outline" : isAuthor ? "person-outline" : "document-text-outline"}
                size={12}
                color={isTopic ? colors.primary : colors.muted}
              />
              <Text style={styles.nodeLabel}>{node.label}</Text>
              {node.count && <Text style={styles.nodeBadge}>{node.count}</Text>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string) {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6
    },
    graphTitle: {
      fontSize: 12 * scale,
      fontWeight: "800",
      color: colors.text,
      letterSpacing: 0.5
    },
    graphCanvas: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8
    },
    nodeChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: "rgba(255, 255, 255, 0.02)",
      borderWidth: 1,
      borderColor: colors.border
    },
    topicNode: {
      backgroundColor: colors.primary + "12",
      borderColor: colors.primary + "2C"
    },
    authorNode: {
      backgroundColor: "rgba(139, 92, 246, 0.08)",
      borderColor: "rgba(139, 92, 246, 0.2)"
    },
    nodeLabel: {
      fontSize: 11 * scale,
      fontWeight: "700",
      color: colors.text
    },
    nodeBadge: {
      fontSize: 9 * scale,
      fontWeight: "800",
      color: colors.subdued,
      backgroundColor: "rgba(255, 255, 255, 0.05)",
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: radius.pill
    }
  });
}
