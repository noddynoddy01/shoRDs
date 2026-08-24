import { Modal, Pressable, ScrollView, StyleSheet, Text, View, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";

type FigureViewerModalProps = {
  visible: boolean;
  onClose: () => void;
  figure: {
    title: string;
    caption: string;
    url?: string;
    aiExplanation?: string;
    simplifiedExplanation?: string;
    sectionLink?: string;
  } | null;
};

export function FigureViewerModal({ visible, onClose, figure }: FigureViewerModalProps) {
  const { colors, fontSizeScale } = useTheme();

  if (!figure) return null;

  const styles = getStyles(colors, fontSizeScale);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header Bar */}
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={1}>{figure.title}</Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Image Display */}
          <View style={styles.imageBox}>
            {figure.url ? (
              <Image source={{ uri: figure.url }} style={styles.image} resizeMode="contain" />
            ) : (
              <View style={styles.fallbackImageBox}>
                <Ionicons name="image-outline" size={64} color={colors.muted} />
                <Text style={styles.fallbackText}>High-Resolution Manuscript Figure</Text>
              </View>
            )}
          </View>

          {/* Caption */}
          <View style={styles.infoCard}>
            <Text style={styles.sectionTitle}>Original Caption</Text>
            <Text style={styles.bodyText}>{figure.caption}</Text>
          </View>

          {/* AI Explanation */}
          <View style={styles.infoCard}>
            <Text style={styles.sectionTitle}>AI Technical Explanation</Text>
            <Text style={styles.bodyText}>
              {figure.aiExplanation || "Illustrates key model architecture components, data flow pipelines, and evaluation metrics benchmarked in the manuscript."}
            </Text>
          </View>

          {/* Simplified Explanation */}
          <View style={styles.infoCard}>
            <Text style={styles.sectionTitle}>Simplified Summary</Text>
            <Text style={styles.bodyText}>
              {figure.simplifiedExplanation || "Shows how input data is processed step-by-step to produce high-precision output results."}
            </Text>
          </View>
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
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border
    },
    headerTitle: {
      fontSize: 16 * scale,
      fontWeight: "700",
      color: colors.text,
      flex: 1
    },
    closeBtn: {
      padding: 4
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: 60
    },
    imageBox: {
      width: "100%",
      height: 260,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden"
    },
    image: {
      width: "100%",
      height: "100%"
    },
    fallbackImageBox: {
      alignItems: "center"
    },
    fallbackText: {
      fontSize: 13 * scale,
      color: colors.muted,
      marginTop: spacing.xs
    },
    infoCard: {
      backgroundColor: colors.surface,
      padding: spacing.md,
      borderRadius: radius.md,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: colors.border
    },
    sectionTitle: {
      fontSize: 13 * scale,
      fontWeight: "700",
      color: colors.primary,
      marginBottom: spacing.xs
    },
    bodyText: {
      fontSize: 13 * scale,
      color: colors.subdued,
      lineHeight: 20
    }
  });
}
