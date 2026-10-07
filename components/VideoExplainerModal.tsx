import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";
import { radius, spacing } from "../constants/theme";
import { Paper } from "@/types/models";

type VideoExplainerModalProps = {
  visible: boolean;
  onClose: () => void;
  paper: Paper;
  selectedLang?: "en" | "hi" | "es";
};

/**
 * Video explainers are not built. The earlier version played a timer-driven "video" whose narration wrapped the paper's text in
 * invented sentences ("the researchers designed a custom framework", "the experimental evaluation demonstrated that"), so it is
 * replaced by an honest notice. The `paper` and `selectedLang` props are kept so callers do not change.
 */
export function VideoExplainerModal({ visible, onClose }: VideoExplainerModalProps) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="videocam-off-outline" size={28} color={colors.muted} />
          <Text style={[styles.badge, { color: colors.muted }]}>NOT AVAILABLE YET</Text>
          <Text style={[styles.body, { color: colors.text }]}>
            Video explainers are not built yet, so nothing is generated. The written brief on the paper page is available.
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" style={[styles.btn, { borderColor: colors.border }]}>
            <Text style={{ color: colors.text, fontWeight: "700" }}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: spacing.lg },
  sheet: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, alignItems: "flex-start" },
  badge: { fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  body: { fontSize: 15, lineHeight: 22 },
  btn: { borderWidth: 1, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 18 }
});
