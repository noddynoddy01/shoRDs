import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View, Clipboard, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/context/ThemeContext";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { Paper, CitationFormat } from "@/types/models";
import { formatCitation } from "@/services/citationService";

export interface BibtexExportModalProps {
  visible: boolean;
  onClose: () => void;
  paper: Paper;
}

export function BibtexExportModal({ visible, onClose, paper }: BibtexExportModalProps) {
  const { colors, fontSizeScale, theme } = useTheme();
  const [selectedFormat, setSelectedFormat] = useState<CitationFormat>("bibtex");
  const styles = getStyles(colors, fontSizeScale, theme);

  const formattedCode = formatCitation(paper, selectedFormat);

  const handleCopy = () => {
    Clipboard.setString(formattedCode);
    Alert.alert("Copied!", `Copied ${selectedFormat.toUpperCase()} citation to clipboard for Zotero / Mendeley / LaTeX.`);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={styles.sheetContainer}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Ionicons name="document-text-outline" size={18} color={colors.primary} />
              <Text style={styles.titleText}>Export Citation (BibTeX / Zotero)</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color={colors.text} />
            </Pressable>
          </View>

          {/* Format Selector Pills */}
          <View style={styles.formatsRow}>
            {(["bibtex", "ris", "apa", "ieee", "mla"] as CitationFormat[]).map((fmt) => {
              const isActive = selectedFormat === fmt;
              return (
                <Pressable
                  key={fmt}
                  style={[styles.fmtChip, isActive && styles.fmtChipActive]}
                  onPress={() => setSelectedFormat(fmt)}
                >
                  <Text style={[styles.fmtText, isActive && styles.fmtTextActive]}>
                    {fmt.toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Formatted Citation Block */}
          <View style={styles.codeBlock}>
            <Text style={styles.codeText}>{formattedCode}</Text>
          </View>

          <Pressable style={styles.copyBtn} onPress={handleCopy}>
            <Ionicons name="copy-outline" size={16} color="#FFFFFF" />
            <Text style={styles.copyBtnText}>Copy {selectedFormat.toUpperCase()} Citation</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(2, 4, 10, 0.8)",
      justifyContent: "center",
      padding: spacing.md
    },
    sheetContainer: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.sm
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
    formatsRow: {
      flexDirection: "row",
      gap: 6
    },
    fmtChip: {
      flex: 1,
      paddingVertical: 6,
      alignItems: "center",
      borderRadius: radius.pill,
      backgroundColor: "rgba(255, 255, 255, 0.02)",
      borderWidth: 1,
      borderColor: colors.border
    },
    fmtChipActive: {
      backgroundColor: colors.primary + "12",
      borderColor: colors.primary + "2C"
    },
    fmtText: {
      fontSize: 10 * scale,
      fontWeight: "700",
      color: colors.subdued
    },
    fmtTextActive: {
      color: colors.primary,
      fontWeight: "800"
    },
    codeBlock: {
      backgroundColor: "#02040A",
      borderRadius: radius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border
    },
    codeText: {
      fontFamily: "monospace",
      fontSize: 11 * scale,
      color: colors.primary,
      lineHeight: 16 * scale
    },
    copyBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.primary,
      height: 42,
      borderRadius: radius.md
    },
    copyBtnText: {
      fontSize: 12 * scale,
      fontWeight: "800",
      color: "#FFFFFF"
    }
  });
}
