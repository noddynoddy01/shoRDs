import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Screen } from "@/components/Screen";
import { useTheme } from "@/context/ThemeContext";
import { radius, spacing } from "@/constants/theme";

type FeatureUnavailableProps = {
  title: string;
  /** What the feature will do once it exists. Plain description, no results. */
  description: string;
};

/**
 * Honest placeholder for features that are not built yet. It deliberately shows no sample output:
 * a screen that returned a canned answer would present invented content as a real result.
 */
export function FeatureUnavailable({ title, description }: FeatureUnavailableProps) {
  const { colors } = useTheme();
  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      </View>
      <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Ionicons name="construct-outline" size={28} color={colors.muted} />
        <Text style={[styles.badge, { color: colors.muted }]}>NOT AVAILABLE YET</Text>
        <Text style={[styles.body, { color: colors.text }]}>{description}</Text>
        <Text style={[styles.body, { color: colors.muted }]}>
          This feature is not built yet, so nothing is generated here.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  title: { fontSize: 20, fontWeight: "700", flex: 1 },
  card: {
    margin: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.lg,
    gap: spacing.md,
    alignItems: "flex-start"
  },
  badge: { fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  body: { fontSize: 15, lineHeight: 22 }
});
