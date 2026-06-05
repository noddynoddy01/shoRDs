import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius } from "@/constants/theme";
import { Domain } from "@/types/models";

type DomainCardProps = {
  domain: Domain;
  count: number;
  selected?: boolean;
  onPress: () => void;
};

const iconByDomain: Record<Domain, keyof typeof Ionicons.glyphMap> = {
  "AI / ML": "sparkles-outline",
  Robotics: "hardware-chip-outline",
  Electronics: "flash-outline",
  Biotechnology: "leaf-outline",
  "Quantum Computing": "cube-outline",
  "Space Tech": "planet-outline",
  Cybersecurity: "shield-checkmark-outline",
  "Renewable Energy": "sunny-outline"
};

export function DomainCard({ domain, count, selected, onPress }: DomainCardProps) {
  return (
    <Pressable style={[styles.card, selected && styles.selected]} onPress={onPress}>
      <LinearGradient
        colors={
          selected
            ? ["rgba(6,182,212,0.16)", "rgba(124,58,237,0.18)"]
            : ["rgba(255,255,255,0.06)", "transparent"]
        }
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.iconWrap}>
        <Ionicons name={iconByDomain[domain]} color={selected ? colors.text : colors.accent} size={22} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.domain}>{domain}</Text>
        <Text style={styles.count}>{count} discoveries</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "48%",
    minHeight: 118,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
    justifyContent: "space-between",
    overflow: "hidden"
  },
  selected: {
    backgroundColor: "rgba(124, 58, 237, 0.24)",
    borderColor: colors.primary
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "rgba(6, 182, 212, 0.12)",
    alignItems: "center",
    justifyContent: "center"
  },
  copy: {
    gap: 4
  },
  domain: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  count: {
    color: colors.subdued,
    fontSize: 12,
    fontWeight: "700"
  }
});
