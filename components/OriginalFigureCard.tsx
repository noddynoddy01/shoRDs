/**
 * Original Figure & Table Visual Component for shoRDs Research Intelligence OS
 * Displays authentic original paper figures/tables with explicit provenance badges,
 * caption expansion, full-screen zoom, and contextual "What this shows / Why it matters" analysis.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  Pressable,
  Modal,
  Linking,
  ScrollView
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/constants/theme";
import { ResearchFigure } from "@/services/figureExtractionService";

interface Props {
  figure: ResearchFigure;
}

export function OriginalFigureCard({ figure }: Props) {
  const [modalVisible, setModalVisible] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);

  const isOriginal = figure.originalFigure;
  const provenanceLabel = isOriginal
    ? `SOURCE FIGURE · ${figure.provenance.provider} · ${figure.figureNumber || "Figure"} · Page ${figure.pageNumber || "N/A"}`
    : `EXPLANATORY VISUAL · Grounded Intelligence`;

  const handleOpenSource = () => {
    if (figure.sourceUrl && figure.sourceUrl.startsWith("http")) {
      Linking.openURL(figure.sourceUrl);
    }
  };

  return (
    <View style={styles.cardContainer}>
      {/* Visual Provenance Badge */}
      <View style={styles.badgeHeader}>
        <Ionicons
          name={isOriginal ? "document-text" : "sparkles"}
          size={13}
          color={isOriginal ? "#10B981" : colors.primary || "#818CF8"}
        />
        <Text style={[styles.badgeText, { color: isOriginal ? "#10B981" : colors.primary }]}>
          {provenanceLabel}
        </Text>
      </View>

      {/* Figure Title */}
      {figure.title ? <Text style={styles.figureTitle}>{figure.title}</Text> : null}

      {/* Main Image Display */}
      {figure.imageUrl ? (
        <Pressable
          onPress={() => setModalVisible(true)}
          style={styles.imageWrapper}
          accessibilityRole="button"
          accessibilityLabel={`Enlarge original figure ${figure.figureNumber || ""}`}
        >
          <Image
            source={{ uri: figure.imageUrl }}
            style={styles.figureImage}
            resizeMode="cover"
          />
          <View style={styles.zoomHintChip}>
            <Ionicons name="expand-outline" size={12} color="#FFF" />
            <Text style={styles.zoomHintText}>Tap to Enlarge</Text>
          </View>
        </Pressable>
      ) : (
        <View style={styles.unavailableBox}>
          <Ionicons name="image-outline" size={24} color={colors.muted} />
          <Text style={styles.unavailableTitle}>Original figure unavailable</Text>
          <Text style={styles.unavailableDesc}>
            The paper contains visual evidence that could not be retrieved from the available open access source.
          </Text>
        </View>
      )}

      {/* Original Caption */}
      {figure.caption ? (
        <View style={styles.captionBox}>
          <Text
            style={styles.captionText}
            numberOfLines={captionExpanded ? undefined : 3}
          >
            <Text style={styles.captionPrefix}>{figure.figureNumber || "Figure"}: </Text>
            {figure.caption}
          </Text>
          {figure.caption.length > 120 && (
            <Pressable onPress={() => setCaptionExpanded(!captionExpanded)} style={styles.toggleBtn}>
              <Text style={styles.toggleBtnText}>{captionExpanded ? "Show Less" : "Show Full Caption"}</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* Contextual Analysis: What this shows & Why it matters */}
      {figure.explanation ? (
        <View style={styles.analysisBox}>
          <View style={styles.analysisRow}>
            <Text style={styles.analysisHeader}>What this shows:</Text>
            <Text style={styles.analysisBody}>{figure.explanation.whatItShows}</Text>
          </View>
          <View style={[styles.analysisRow, { marginTop: spacing.xs }]}>
            <Text style={styles.analysisHeader}>Why it matters:</Text>
            <Text style={styles.analysisBody}>{figure.explanation.whyItMatters}</Text>
          </View>
        </View>
      ) : null}

      {/* Source Citation & Link */}
      {figure.sourceUrl ? (
        <Pressable onPress={handleOpenSource} style={styles.sourceFooter}>
          <Ionicons name="link-outline" size={13} color={colors.muted} />
          <Text style={styles.sourceFooterText}>View in original paper ({figure.provenance.provider})</Text>
        </Pressable>
      ) : null}

      {/* Modal Full-Screen Zoom */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalCloseBtn} onPress={() => setModalVisible(false)}>
            <Ionicons name="close-circle" size={32} color="#FFF" />
          </Pressable>

          <ScrollView contentContainerStyle={styles.modalScroll}>
            {figure.imageUrl && (
              <Image
                source={{ uri: figure.imageUrl }}
                style={styles.fullImage}
                resizeMode="contain"
              />
            )}
            <View style={styles.modalCaptionContainer}>
              <Text style={styles.modalFigureNumber}>{figure.figureNumber || "Figure"}</Text>
              <Text style={styles.modalCaptionText}>{figure.caption}</Text>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    backgroundColor: colors.card || "#1E293B",
    borderRadius: radius.md,
    padding: spacing.md,
    marginVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border || "rgba(255, 255, 255, 0.08)"
  },
  badgeHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xs
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    marginLeft: 6,
    letterSpacing: 0.5
  },
  figureTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text || "#FFF",
    marginBottom: spacing.xs,
    lineHeight: 20
  },
  imageWrapper: {
    position: "relative",
    width: "100%",
    height: 190,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: "#000",
    marginVertical: spacing.xs
  },
  figureImage: {
    width: "100%",
    height: "100%"
  },
  zoomHintChip: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs,
    flexDirection: "row",
    alignItems: "center"
  },
  zoomHintText: {
    fontSize: 10,
    color: "#FFF",
    marginLeft: 4,
    fontWeight: "600"
  },
  unavailableBox: {
    padding: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: radius.sm,
    marginVertical: spacing.xs
  },
  unavailableTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.muted || "#94A3B8",
    marginTop: 6
  },
  unavailableDesc: {
    fontSize: 11,
    color: colors.muted || "#64748B",
    textAlign: "center",
    marginTop: 4
  },
  captionBox: {
    backgroundColor: "rgba(0, 0, 0, 0.25)",
    padding: spacing.xs + 2,
    borderRadius: radius.xs,
    marginTop: spacing.xs
  },
  captionPrefix: {
    fontWeight: "700",
    color: colors.primary || "#818CF8"
  },
  captionText: {
    fontSize: 12,
    color: colors.text || "#E2E8F0",
    lineHeight: 17
  },
  toggleBtn: {
    marginTop: 4
  },
  toggleBtnText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.primary || "#818CF8"
  },
  analysisBox: {
    borderLeftWidth: 2,
    borderLeftColor: colors.primary || "#818CF8",
    paddingLeft: spacing.xs + 4,
    marginTop: spacing.xs + 2
  },
  analysisRow: {},
  analysisHeader: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.primary || "#818CF8",
    textTransform: "uppercase"
  },
  analysisBody: {
    fontSize: 12,
    color: colors.text || "#E2E8F0",
    lineHeight: 17,
    marginTop: 2
  },
  sourceFooter: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xs + 4
  },
  sourceFooterText: {
    fontSize: 11,
    color: colors.muted || "#94A3B8",
    marginLeft: 4,
    textDecorationLine: "underline"
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.92)",
    justifyContent: "center"
  },
  modalCloseBtn: {
    position: "absolute",
    top: 40,
    right: 20,
    zIndex: 10
  },
  modalScroll: {
    alignItems: "center",
    paddingVertical: 80,
    paddingHorizontal: 20
  },
  fullImage: {
    width: "100%",
    height: 350,
    borderRadius: radius.sm
  },
  modalCaptionContainer: {
    marginTop: 20,
    maxWidth: 500
  },
  modalFigureNumber: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.primary || "#818CF8"
  },
  modalCaptionText: {
    fontSize: 14,
    color: "#FFF",
    lineHeight: 20,
    marginTop: 6
  }
});
