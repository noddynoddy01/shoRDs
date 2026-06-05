import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius } from "@/constants/theme";

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
  const isPrimary = variant === "primary";

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
        colors={
          isPrimary
            ? ["rgba(6, 182, 212, 0.95)", "rgba(124, 58, 237, 0.98)"]
            : ["rgba(255,255,255,0.07)", "rgba(255,255,255,0.03)"]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.button, !isPrimary && styles.quiet]}
      >
        {icon ? <Ionicons name={icon} color={colors.text} size={19} /> : null}
        <Text style={styles.text}>{title}</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
    borderColor: "rgba(255,255,255,0.18)",
    shadowColor: colors.accent,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 }
  },
  quiet: {
    borderColor: colors.border,
    shadowOpacity: 0
  },
  text: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0
  }
});
