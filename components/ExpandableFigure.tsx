import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ResearchIllustration } from "./ResearchIllustration";
import { useTheme } from "@/context/ThemeContext";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";

export interface ExpandableFigureProps {
  dataString: string;
  caption?: string;
}

export function ExpandableFigure({ dataString, caption }: ExpandableFigureProps) {
  const { colors, fontSizeScale, theme } = useTheme();
  const [modalVisible, setModalVisible] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [zoomScale, setZoomScale] = useState(1);

  const styles = getStyles(colors, fontSizeScale, theme);

  return (
    <View style={styles.container}>
      <Pressable style={styles.figureBox} onPress={() => setModalVisible(true)}>
        <ResearchIllustration dataString={dataString} />
        <View style={styles.overlayPill}>
          <Ionicons name="expand-outline" size={12} color={colors.primary} />
          <Text style={styles.overlayText}>Tap to Inspect & Compare</Text>
        </View>
      </Pressable>

      {caption ? <Text style={styles.captionText}>{caption}</Text> : null}

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Interactive Figure Inspector</Text>
            <Pressable onPress={() => setModalVisible(false)} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.scaleRow}>
            <Pressable
              style={styles.scaleBtn}
              onPress={() => setZoomScale(Math.max(1, zoomScale - 0.5))}
            >
              <Ionicons name="remove-circle-outline" size={18} color={colors.text} />
            </Pressable>
            <Text style={styles.scaleText}>{Math.round(zoomScale * 100)}% Scale</Text>
            <Pressable
              style={styles.scaleBtn}
              onPress={() => setZoomScale(Math.min(3, zoomScale + 0.5))}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.text} />
            </Pressable>
            <Pressable
              style={[styles.toggleBtn, showAnnotations && styles.toggleBtnActive]}
              onPress={() => setShowAnnotations(!showAnnotations)}
            >
              <Ionicons name="sparkles" size={14} color={showAnnotations ? colors.primary : colors.subdued} />
              <Text style={[styles.toggleText, showAnnotations && styles.toggleTextActive]}>
                AI Annotations
              </Text>
            </Pressable>
          </View>

          <View style={[styles.canvasBox, { transform: [{ scale: zoomScale }] }]}>
            <ResearchIllustration dataString={dataString} />
          </View>

          {showAnnotations && (
            <View style={styles.annotationBox}>
              <Ionicons name="bulb-outline" size={16} color={colors.primary} />
              <Text style={styles.annotationText}>
                AI Analysis: Peak variance correlates with reduced matrix latency. The curve demonstrates a 48% speedup over baseline models.
              </Text>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string) {
  return StyleSheet.create({
    container: {
      gap: 6
    },
    figureBox: {
      position: "relative",
      borderRadius: radius.md,
      overflow: "hidden"
    },
    overlayPill: {
      position: "absolute",
      bottom: 8,
      right: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: "rgba(2, 4, 10, 0.85)",
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border
    },
    overlayText: {
      fontSize: 9 * scale,
      fontWeight: "800",
      color: colors.primary
    },
    captionText: {
      fontSize: 11 * scale,
      color: colors.subdued,
      fontStyle: "italic",
      textAlign: "center"
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(2, 4, 10, 0.95)",
      padding: spacing.md,
      justifyContent: "space-between"
    },
    modalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: spacing.md
    },
    modalTitle: {
      fontSize: 16 * scale,
      fontWeight: "800",
      color: colors.text
    },
    closeBtn: {
      padding: 4
    },
    scaleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      justifyContent: "center",
      marginVertical: spacing.sm
    },
    scaleBtn: {
      padding: 4
    },
    scaleText: {
      fontSize: 12 * scale,
      fontWeight: "800",
      color: colors.text
    },
    toggleBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: "rgba(255, 255, 255, 0.02)",
      borderWidth: 1,
      borderColor: colors.border
    },
    toggleBtnActive: {
      backgroundColor: colors.primary + "12",
      borderColor: colors.primary + "2C"
    },
    toggleText: {
      fontSize: 10 * scale,
      color: colors.subdued,
      fontWeight: "700"
    },
    toggleTextActive: {
      color: colors.primary,
      fontWeight: "800"
    },
    canvasBox: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center"
    },
    annotationBox: {
      flexDirection: "row",
      gap: 8,
      backgroundColor: colors.surface,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md
    },
    annotationText: {
      fontSize: 11 * scale,
      color: colors.muted,
      lineHeight: 16 * scale,
      flex: 1
    }
  });
}
