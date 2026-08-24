import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/context/ThemeContext";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { Paper } from "@/types/models";

export interface PaperDebateModalProps {
  visible: boolean;
  onClose: () => void;
  paperA: Paper;
}

export function PaperDebateModal({ visible, onClose, paperA }: PaperDebateModalProps) {
  const { colors, fontSizeScale, theme } = useTheme();
  const styles = getStyles(colors, fontSizeScale, theme);

  const debateTopics = [
    {
      topic: "Latency Overhead vs Matrix Accuracy",
      stanceA: "Prioritizes 99.8% precision at the cost of high compute memory.",
      stanceB: "Prunes 40% weights for real-time edge streaming speedup.",
      verdict: "Paper A wins in high-security medical tasks; Paper B wins in mobile robotics."
    },
    {
      topic: "Scalability Across Unseen Datasets",
      stanceA: "Requires pre-training on 10B tokens.",
      stanceB: "Zero-shot adaptation via lightweight adapter layers.",
      verdict: "Paper B shows superior generalization across small domain sets."
    }
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheetContainer}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Ionicons name="git-compare" size={18} color={colors.primary} />
              <Text style={styles.titleText}>AI Scholarly Debate Simulator</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color={colors.text} />
            </Pressable>
          </View>

          <Text style={styles.subText}>
            Simulating thesis debate: <Text style={{ color: colors.primary }}>{paperA.title}</Text> vs <Text style={{ color: colors.text }}>Baseline Benchmarks</Text>
          </Text>

          <ScrollView contentContainerStyle={styles.debateScroll} showsVerticalScrollIndicator={false}>
            {debateTopics.map((item, idx) => (
              <View key={idx} style={styles.topicBox}>
                <Text style={styles.topicTitle}>{item.topic}</Text>

                <View style={styles.argumentRow}>
                  <View style={styles.stanceBox}>
                    <Text style={styles.stanceLabel}>THESIS A (This Paper)</Text>
                    <Text style={styles.stanceText}>{item.stanceA}</Text>
                  </View>
                  <View style={styles.stanceBox}>
                    <Text style={styles.stanceLabel}>THESIS B (Baseline)</Text>
                    <Text style={styles.stanceText}>{item.stanceB}</Text>
                  </View>
                </View>

                <View style={styles.verdictBox}>
                  <Ionicons name="ribbon-outline" size={14} color={colors.primary} />
                  <Text style={styles.verdictText}><Text style={{ fontWeight: "800" }}>Verdict:</Text> {item.verdict}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(2, 4, 10, 0.85)",
      justifyContent: "flex-end",
      padding: spacing.md
    },
    sheetContainer: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.sm,
      maxHeight: "80%"
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between"
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6
    },
    titleText: {
      fontSize: 14 * scale,
      fontWeight: "800",
      color: colors.text
    },
    closeBtn: {
      padding: 4
    },
    subText: {
      fontSize: 11 * scale,
      color: colors.muted,
      lineHeight: 16 * scale
    },
    debateScroll: {
      gap: spacing.md,
      paddingVertical: spacing.xs
    },
    topicBox: {
      backgroundColor: "rgba(255, 255, 255, 0.015)",
      borderRadius: radius.md,
      padding: spacing.md,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border
    },
    topicTitle: {
      fontSize: 13 * scale,
      fontWeight: "800",
      color: colors.text
    },
    argumentRow: {
      flexDirection: "row",
      gap: 8
    },
    stanceBox: {
      flex: 1,
      backgroundColor: "#02040A",
      padding: spacing.xs,
      borderRadius: radius.sm,
      gap: 4
    },
    stanceLabel: {
      fontSize: 8 * scale,
      fontWeight: "800",
      color: colors.primary
    },
    stanceText: {
      fontSize: 10 * scale,
      color: colors.muted,
      lineHeight: 14 * scale
    },
    verdictBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.primary + "12",
      padding: spacing.xs,
      borderRadius: radius.sm
    },
    verdictText: {
      fontSize: 10 * scale,
      color: colors.primary,
      flex: 1
    }
  });
}
