import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";

type SubscriptionModalProps = {
  visible: boolean;
  onClose: () => void;
};

export function SubscriptionModal({ visible, onClose }: SubscriptionModalProps) {
  const { colors, fontSizeScale } = useTheme();
  const styles = getStyles(colors, fontSizeScale || 1);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Ionicons name="sparkles" size={24} color={colors.primary} />
            <Text style={styles.title}>Plans</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={colors.muted} />
            </Pressable>
          </View>

          <Text style={styles.subtitle}>
            You are on the Free plan.
          </Text>

          <Text style={styles.subtitle}>
            Paid plans are not available yet. No payment can be taken and your account is not changed.
          </Text>

        </View>
      </View>
    </Modal>
  );
}

function getStyles(colors: any, scale: number) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.7)",
      justifyContent: "flex-end"
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.md
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    title: {
      fontSize: 16 * scale,
      fontWeight: "800",
      color: colors.text,
      flex: 1
    },
    closeBtn: {
      padding: 4
    },
    subtitle: {
      fontSize: 13 * scale,
      color: colors.primary,
      fontWeight: "700"
    },
    benefitList: {
      gap: 10,
      marginVertical: spacing.xs
    },
    benefitRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    benefitText: {
      fontSize: 12 * scale,
      color: colors.text,
      flex: 1
    },
    upgradeBtn: {
      backgroundColor: colors.primary,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      alignItems: "center"
    },
    upgradeBtnText: {
      color: "#FFFFFF",
      fontWeight: "800",
      fontSize: 14 * scale
    }
  });
}
