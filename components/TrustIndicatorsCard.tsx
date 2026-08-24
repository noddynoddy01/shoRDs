import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";

export type TrustIndicatorsPayload = {
  evidenceQuality: number; // 91%
  confidence: number; // 89%
  coverage: number; // 97%
  contradiction: number; // 12%
  recency: number; // 92%
  reproducibility: number; // 84%
};

type TrustIndicatorsCardProps = {
  indicators?: TrustIndicatorsPayload;
};

export function TrustIndicatorsCard({ indicators }: TrustIndicatorsCardProps) {
  const { colors, fontSizeScale } = useTheme();

  const data: TrustIndicatorsPayload = indicators || {
    evidenceQuality: 91,
    confidence: 89,
    coverage: 97,
    contradiction: 12,
    recency: 92,
    reproducibility: 84
  };

  const items = [
    { label: "Evidence Quality", value: data.evidenceQuality, color: "#10B981" },
    { label: "Synthesis Confidence", value: data.confidence, color: colors.primary },
    { label: "Provenance Coverage", value: data.coverage, color: "#3B82F6" },
    { label: "Contradiction Rate", value: data.contradiction, color: colors.warning },
    { label: "Recency Score", value: data.recency, color: "#8B5CF6" },
    { label: "Reproducibility Score", value: data.reproducibility, color: "#EC4899" }
  ];

  const styles = getStyles(colors, fontSizeScale);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
        <Text style={styles.cardTitle}>6-Dimension Scientific Trust Indicators</Text>
      </View>

      <View style={styles.grid}>
        {items.map((item, idx) => (
          <View key={idx} style={styles.itemBox}>
            <View style={styles.labelRow}>
              <Text style={styles.itemLabel}>{item.label}</Text>
              <Text style={[styles.itemValue, { color: item.color }]}>{item.value}%</Text>
            </View>
            {/* Visual Progress Bar */}
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${item.value}%`, backgroundColor: item.color }]} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function getStyles(colors: any, scale: number) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      padding: spacing.md,
      borderRadius: radius.md,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: colors.border
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing.sm,
      gap: 6
    },
    cardTitle: {
      fontSize: 14 * scale,
      fontWeight: "800",
      color: colors.text
    },
    grid: {
      gap: spacing.xs
    },
    itemBox: {
      marginVertical: 2
    },
    labelRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 2
    },
    itemLabel: {
      fontSize: 11 * scale,
      color: colors.subdued,
      fontWeight: "600"
    },
    itemValue: {
      fontSize: 11 * scale,
      fontWeight: "800"
    },
    track: {
      height: 6,
      backgroundColor: colors.background,
      borderRadius: 3,
      overflow: "hidden"
    },
    fill: {
      height: "100%",
      borderRadius: 3
    }
  });
}
