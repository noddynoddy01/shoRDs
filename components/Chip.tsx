import { Pressable, StyleSheet, Text } from "react-native";
import { useTheme } from "../context/ThemeContext";
import { colors as defaultColors, radius } from "../constants/theme";

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
};

export function Chip({ label, selected, onPress }: ChipProps) {
  const { colors, fontSizeScale } = useTheme();
  const styles = getStyles(colors, fontSizeScale);

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

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    chip: {
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 13,
      paddingVertical: 7,
      backgroundColor: colors.card
    },
    selected: {
      backgroundColor: "rgba(124, 58, 237, 0.16)",
      borderColor: colors.primary
    },
    text: {
      color: colors.muted,
      fontSize: 12 * scale,
      fontWeight: "700"
    },
    textSelected: {
      color: colors.text
    }
  });
}
