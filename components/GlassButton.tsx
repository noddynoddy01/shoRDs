import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../context/ThemeContext";
import { colors as defaultColors, radius } from "../constants/theme";

type GlassButtonProps = {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  variant?: "primary" | "quiet";
  style?: ViewStyle;
  disabled?: boolean;
};

export function GlassButton({
  title,
  icon,
  onPress,
  variant = "primary",
  style,
  disabled
}: GlassButtonProps) {
  const { colors, fontSizeScale, theme } = useTheme();
  const isPrimary = variant === "primary";

  const styles = getStyles(colors, fontSizeScale);

  const quietColors = theme === "light" || theme === "sepia"
    ? [colors.cardElevated, colors.card]
    : ["rgba(255,255,255,0.07)", "rgba(255,255,255,0.03)"];

  const primaryColors = theme === "light"
    ? ["#0E7490", "#6D28D9"] // Softer gradients for light theme
    : ["rgba(6, 182, 212, 0.95)", "rgba(124, 58, 237, 0.98)"];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.pressable,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style
      ]}
    >
      <LinearGradient
        colors={(isPrimary ? primaryColors : quietColors) as any}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.button, !isPrimary && styles.quiet]}
      >
        {icon ? <Ionicons name={icon} color={isPrimary ? "#FFFFFF" : colors.text} size={19} /> : null}
        <Text style={[styles.text, isPrimary && { color: "#FFFFFF" }]}>{title}</Text>
      </LinearGradient>
    </Pressable>
  );
}

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    pressable: {
      borderRadius: radius.md
    },
    pressed: {
      transform: [{ scale: 0.98 }],
      opacity: 0.9
    },
    disabled: {
      opacity: 0.58
    },
    button: {
      minHeight: 52,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 9,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: colors.accent,
      shadowOpacity: 0.15,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 }
    },
    quiet: {
      borderColor: colors.border,
      shadowOpacity: 0
    },
    text: {
      color: colors.text,
      fontSize: 14 * scale,
      fontWeight: "700",
      letterSpacing: 0
    }
  });
}
