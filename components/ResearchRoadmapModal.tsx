import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/context/ThemeContext";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { Paper } from "@/types/models";

export interface ResearchRoadmapModalProps {
  visible: boolean;
  onClose: () => void;
  paper: Paper;
}

export function ResearchRoadmapModal({ visible, onClose, paper }: ResearchRoadmapModalProps) {
  const { colors, fontSizeScale, theme } = useTheme();
  const styles = getStyles(colors, fontSizeScale, theme);

  const phases = [
    {
      step: "Phase 1: Foundations",
      title: "Mathematical Background",
      desc: "Review linear algebra matrix decompositions and probability distributions required for initial model parameters.",
      time: "2 Days"
    },
    {
      step: "Phase 2: Prerequisites",
      title: "PyTorch Pipeline Setup",
      desc: "Clone baseline model repositories and configure synthetic tensor benchmarks.",
      time: "3 Days"
    },
    {
      step: "Phase 3: Core Implementation",
      title: "Model Pruning & Attention Tuning",
      desc: "Implement custom adapter layers as specified in Section 2 of this paper.",
      time: "1 Week"
    },
    {
      step: "Phase 4: Experimental Frontiers",
      title: "Real-World Edge Deployment",
      desc: "Deploy compiled model weights onto embedded hardware targets.",
      time: "2 Weeks"
    }
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheetContainer}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Ionicons name="map-outline" size={18} color={colors.primary} />
              <Text style={styles.titleText}>AI Research Roadmap Builder</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color={colors.text} />
            </Pressable>
          </View>

          <Text style={styles.subText}>
            Step-by-step implementation guide for <Text style={{ color: colors.primary }}>{paper.title}</Text>
          </Text>

          <ScrollView contentContainerStyle={styles.roadmapScroll} showsVerticalScrollIndicator={false}>
            {phases.map((item, idx) => (
              <View key={idx} style={styles.phaseCard}>
                <View style={styles.phaseHeader}>
                  <Text style={styles.phaseStep}>{item.step}</Text>
                  <Text style={styles.phaseTime}>{item.time}</Text>
                </View>
                <Text style={styles.phaseTitle}>{item.title}</Text>
                <Text style={styles.phaseDesc}>{item.desc}</Text>
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
    roadmapScroll: {
      gap: 10,
      paddingVertical: spacing.xs
    },
    phaseCard: {
      backgroundColor: "rgba(255, 255, 255, 0.015)",
      borderRadius: radius.md,
      padding: spacing.md,
      gap: 4,
      borderWidth: 1,
      borderColor: colors.border
    },
    phaseHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center"
    },
    phaseStep: {
      fontSize: 9 * scale,
      fontWeight: "800",
      color: colors.primary,
      letterSpacing: 0.5
    },
    phaseTime: {
      fontSize: 9 * scale,
      fontWeight: "700",
      color: colors.subdued
    },
    phaseTitle: {
      fontSize: 13 * scale,
      fontWeight: "800",
      color: colors.text
    },
    phaseDesc: {
      fontSize: 11 * scale,
      color: colors.muted,
      lineHeight: 16 * scale
    }
  });
}
