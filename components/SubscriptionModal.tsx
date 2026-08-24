import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import { getUserSubscriptionAsync, upgradeToProAsync, UserSubscription } from "@/services/subscriptionService";

type SubscriptionModalProps = {
  visible: boolean;
  onClose: () => void;
};

export function SubscriptionModal({ visible, onClose }: SubscriptionModalProps) {
  const { colors, fontSizeScale } = useTheme();
  const [sub, setSub] = useState<UserSubscription | null>(null);

  useEffect(() => {
    if (visible) {
      getUserSubscriptionAsync().then(setSub);
    }
  }, [visible]);

  const handleUpgrade = async () => {
    const updated = await upgradeToProAsync();
    setSub(updated);
    onClose();
  };

  const styles = getStyles(colors, fontSizeScale || 1);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Ionicons name="sparkles" size={24} color={colors.primary} />
            <Text style={styles.title}>shoRDs Pro Research Operating System</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={colors.muted} />
            </Pressable>
          </View>

          <Text style={styles.subtitle}>
            {sub?.plan === "pro" 
              ? "Your Pro Research Pass is Active! Enjoy Unlimited AI Stacks."
              : `Free Plan Quota: ${sub?.usageCount || 0} / ${sub?.monthlyLimit || 5} Monthly AI Stacks Used.`}
          </Text>

          <View style={styles.benefitList}>
            <View style={styles.benefitRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
              <Text style={styles.benefitText}>Unlimited 18-Part Scientific AI Stacks & Deep Summaries</Text>
            </View>
            <View style={styles.benefitRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
              <Text style={styles.benefitText}>Multi-Provider Gateway: OpenAlex, Crossref, arXiv, CORE, Europe PMC</Text>
            </View>
            <View style={styles.benefitRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
              <Text style={styles.benefitText}>Full PDF Layout Parsing & Equation Derivation Engines</Text>
            </View>
            <View style={styles.benefitRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
              <Text style={styles.benefitText}>Audio Narrator & 10-Scene Explainer Video Generator</Text>
            </View>
          </View>

          {sub?.plan !== "pro" && (
            <Pressable style={styles.upgradeBtn} onPress={handleUpgrade}>
              <Text style={styles.upgradeBtnText}>Upgrade to Pro Pass • $9.99 / Mo</Text>
            </Pressable>
          )}
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
