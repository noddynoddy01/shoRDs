import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/context/ThemeContext";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";

export interface AIActionMenuProps {
  visible: boolean;
  onClose: () => void;
  selectedText?: string;
  onActionSelect: (action: string) => void;
}

export function AIActionMenu({ visible, onClose, selectedText, onActionSelect }: AIActionMenuProps) {
  const { colors, fontSizeScale, theme } = useTheme();
  const styles = getStyles(colors, fontSizeScale, theme);

  const actions = [
    { id: "explain", label: "Explain Context", icon: "sparkles" },
    { id: "simplify", label: "Simplify Language", icon: "easel-outline" },
    { id: "compare", label: "Compare Results", icon: "git-compare-outline" },
    { id: "summarize", label: "Summarize", icon: "document-text-outline" },
    { id: "flashcards", label: "Generate Flashcards", icon: "card-outline" },
    { id: "podcast", label: "Create Audio Podcast", icon: "mic-outline" },
    { id: "experiments", label: "Design Experiments", icon: "flask-outline" }
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={styles.menuContainer}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Ionicons name="sparkles" size={16} color={colors.primary} />
              <Text style={styles.menuTitle}>shoRDs AI Contextual Engine</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={16} color={colors.subdued} />
            </Pressable>
          </View>

          {selectedText ? (
            <View style={styles.selectedSnippetBox}>
              <Text style={styles.selectedSnippetText} numberOfLines={2}>
                "{selectedText}"
              </Text>
            </View>
          ) : null}

          <ScrollView contentContainerStyle={styles.actionsGrid} showsVerticalScrollIndicator={false}>
            {actions.map((act) => (
              <Pressable
                key={act.id}
                style={styles.actionBtn}
                onPress={() => {
                  onActionSelect(act.id);
                  onClose();
                }}
              >
                <View style={styles.actionIconBg}>
                  <Ionicons name={act.icon as any} size={16} color={colors.primary} />
                </View>
                <Text style={styles.actionLabel}>{act.label}</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.subdued} style={{ marginLeft: "auto" }} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(2, 4, 10, 0.75)",
      justifyContent: "flex-end",
      padding: spacing.md
    },
    menuContainer: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.sm,
      maxHeight: "70%",
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.3,
      shadowRadius: 20,
      elevation: 8
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
    menuTitle: {
      fontSize: 13 * scale,
      fontWeight: "800",
      color: colors.text,
      letterSpacing: 0.5
    },
    closeBtn: {
      padding: 4
    },
    selectedSnippetBox: {
      backgroundColor: "rgba(255, 255, 255, 0.02)",
      borderRadius: radius.md,
      padding: spacing.xs,
      borderWidth: 1,
      borderColor: colors.border
    },
    selectedSnippetText: {
      fontSize: 11 * scale,
      color: colors.muted,
      fontStyle: "italic"
    },
    actionsGrid: {
      gap: 8
    },
    actionBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: "rgba(255, 255, 255, 0.015)",
      borderWidth: 1,
      borderColor: colors.border
    },
    actionIconBg: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.primary + "12",
      alignItems: "center",
      justifyContent: "center"
    },
    actionLabel: {
      fontSize: 12 * scale,
      fontWeight: "700",
      color: colors.text
    }
  });
}
