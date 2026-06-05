import { Pressable, StyleSheet, Text } from "react-native";
import { colors, radius } from "@/constants/theme";

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
};

export function Chip({ label, selected, onPress }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.selected]}
      accessibilityRole={onPress ? "button" : undefined}
    >
      <Text style={[styles.text, selected && styles.textSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.03)"
  },
  selected: {
    backgroundColor: "rgba(124, 58, 237, 0.22)",
    borderColor: colors.primary
  },
  text: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600"
  },
  textSelected: {
    color: colors.text
  }
});
