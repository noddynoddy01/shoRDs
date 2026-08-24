import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";

type ResearchTutorModalProps = {
  visible: boolean;
  onClose: () => void;
  onUnderstand: () => void;
  onExplainAgain: () => void;
  questionText: string;
  explanationText: string;
};

export function ResearchTutorModal({
  visible,
  onClose,
  onUnderstand,
  onExplainAgain,
  questionText,
  explanationText
}: ResearchTutorModalProps) {
  const { colors, fontSizeScale } = useTheme();

  const styles = getStyles(colors, fontSizeScale);

  return (
    <Modal visible={visible} animationType="fade" transparent={true} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Ionicons name="school-outline" size={20} color={colors.primary} />
            <Text style={styles.headerTitle}>RESEARCH TUTOR CHECK-IN</Text>
          </View>

          <Text style={styles.questionText}>{questionText}</Text>

          <View style={styles.explanationBox}>
            <Ionicons name="bulb-outline" size={16} color={colors.primary} />
            <Text style={styles.explanationText}>{explanationText}</Text>
          </View>

          <View style={styles.buttonRow}>
            <Pressable style={styles.btnSecondary} onPress={onExplainAgain}>
              <Ionicons name="refresh-outline" size={16} color={colors.primary} />
              <Text style={styles.btnSecondaryText}>Explain Again</Text>
            </Pressable>

            <Pressable style={styles.btnPrimary} onPress={onUnderstand}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#FFF" />
              <Text style={styles.btnPrimaryText}>I Understand</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function getStyles(colors: any, scale: number) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.6)",
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.md
    },
    card: {
      width: "100%",
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginBottom: spacing.xs
    },
    headerTitle: {
      fontSize: 11 * scale,
      fontWeight: "800",
      color: colors.primary,
      letterSpacing: 1
    },
    questionText: {
      fontSize: 15 * scale,
      fontWeight: "800",
      color: colors.text,
      marginBottom: spacing.xs
    },
    explanationBox: {
      flexDirection: "row",
      backgroundColor: colors.background,
      padding: spacing.sm,
      borderRadius: radius.sm,
      marginBottom: spacing.md,
      gap: 8,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary
    },
    explanationText: {
      fontSize: 12 * scale,
      color: colors.subdued,
      flex: 1,
      lineHeight: 18
    },
    buttonRow: {
      flexDirection: "row",
      gap: spacing.xs
    },
    btnSecondary: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary + "15",
      paddingVertical: spacing.xs + 2,
      borderRadius: radius.sm,
      gap: 4
    },
    btnSecondaryText: {
      fontSize: 12 * scale,
      fontWeight: "700",
      color: colors.primary
    },
    btnPrimary: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
      paddingVertical: spacing.xs + 2,
      borderRadius: radius.sm,
      gap: 4
    },
    btnPrimaryText: {
      fontSize: 12 * scale,
      fontWeight: "700",
      color: "#FFF"
    }
  });
}
