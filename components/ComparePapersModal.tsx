import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Paper } from "@/types/models";
import { compareSelectedPapers, PaperComparisonMatrix } from "@/services/stackGenerator";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";

type ComparePapersModalProps = {
  visible: boolean;
  onClose: () => void;
  papers: Paper[];
};

export function ComparePapersModal({ visible, onClose, papers }: ComparePapersModalProps) {
  const { colors, fontSizeScale } = useTheme();

  if (!papers || papers.length === 0) return null;

  const comparisonMatrix: PaperComparisonMatrix = compareSelectedPapers(papers);
  const styles = getStyles(colors, fontSizeScale);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Modal Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Paper Comparison Matrix</Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>

        <Text style={styles.subTitle}>Comparing {papers.length} Selected Manuscripts</Text>

        <ScrollView horizontal style={styles.horizontalScroll}>
          <ScrollView style={styles.verticalScroll}>
            {/* Paper Header Row */}
            <View style={styles.rowHeader}>
              <View style={styles.aspectCellHeader}>
                <Text style={styles.aspectHeaderText}>Comparison Dimension</Text>
              </View>
              {papers.map(p => (
                <View key={p.id} style={styles.paperCellHeader}>
                  <Text style={styles.paperTitleText} numberOfLines={2}>{p.title}</Text>
                  <Text style={styles.paperAuthorText}>{p.authorName} ({p.pubYear || 2026})</Text>
                </View>
              ))}
            </View>

            {/* Matrix Data Rows */}
            {comparisonMatrix.comparisonAspects.map((aspect, idx) => (
              <View key={idx} style={[styles.matrixRow, idx % 2 === 1 && styles.matrixRowAlt]}>
                <View style={styles.aspectCell}>
                  <Text style={styles.aspectNameText}>{aspect.aspectName}</Text>
                </View>

                {papers.map(p => (
                  <View key={p.id} style={styles.paperEvalCell}>
                    <Text style={styles.evalText}>
                      {aspect.evaluations[p.id] || "Extraction Failed"}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </ScrollView>
      </View>
    </Modal>
  );
}

function getStyles(colors: any, scale: number) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      paddingTop: spacing.md
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xs
    },
    headerTitle: {
      fontSize: 18 * scale,
      fontWeight: "800",
      color: colors.text
    },
    subTitle: {
      fontSize: 12 * scale,
      color: colors.muted,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.md
    },
    closeBtn: {
      padding: 4
    },
    horizontalScroll: {
      flex: 1
    },
    verticalScroll: {
      flex: 1
    },
    rowHeader: {
      flexDirection: "row",
      backgroundColor: colors.surface,
      borderBottomWidth: 2,
      borderBottomColor: colors.primary
    },
    aspectCellHeader: {
      width: 140,
      padding: spacing.sm,
      justifyContent: "center"
    },
    aspectHeaderText: {
      fontSize: 12 * scale,
      fontWeight: "700",
      color: colors.primary
    },
    paperCellHeader: {
      width: 220,
      padding: spacing.sm,
      borderLeftWidth: 1,
      borderLeftColor: colors.border
    },
    paperTitleText: {
      fontSize: 13 * scale,
      fontWeight: "700",
      color: colors.text
    },
    paperAuthorText: {
      fontSize: 11 * scale,
      color: colors.muted,
      marginTop: 2
    },
    matrixRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: colors.border
    },
    matrixRowAlt: {
      backgroundColor: colors.surface + "50"
    },
    aspectCell: {
      width: 140,
      padding: spacing.sm,
      justifyContent: "flex-start",
      backgroundColor: colors.surface
    },
    aspectNameText: {
      fontSize: 12 * scale,
      fontWeight: "700",
      color: colors.text
    },
    paperEvalCell: {
      width: 220,
      padding: spacing.sm,
      borderLeftWidth: 1,
      borderLeftColor: colors.border
    },
    evalText: {
      fontSize: 12 * scale,
      color: colors.subdued,
      lineHeight: 18
    }
  });
}
