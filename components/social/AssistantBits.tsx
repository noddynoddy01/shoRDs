import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef } from "react";
import { Animated, Easing, Text, View } from "react-native";
import { useReducedMotion } from "@/components/ui/motion";
import { useTheme } from "@/context/ThemeContext";
import { tokens } from "@/constants/theme";

/** The Assistant's identity mark, shown beside its answers so the reader can tell it apart from their own messages. */
export function AssistantMark({ size = 30 }: { size?: number }) {
  const { colors } = useTheme();
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <Ionicons name="sparkles-outline" size={size * 0.52} color={colors.accent} />
    </View>
  );
}

function Dot({ delay, still }: { delay: number; still: boolean }) {
  const { colors } = useTheme();
  const v = useRef(new Animated.Value(still ? 0.7 : 0.3)).current;
  useEffect(() => {
    if (still) { v.setValue(0.7); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: 380, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.3, duration: 380, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [still, delay, v]);
  return <Animated.View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent, opacity: v }} />;
}

/** Three softly pulsing dots with a text label; the dots stop moving when the person prefers reduced motion. */
export function ThinkingDots({ label = "Thinking" }: { label?: string }) {
  const { colors, fontSizeScale: k } = useTheme();
  const reduced = useReducedMotion();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }} accessibilityLiveRegion="polite" accessibilityLabel="The assistant is writing an answer">
      <View style={{ flexDirection: "row", gap: 5 }}><Dot delay={0} still={reduced} /><Dot delay={150} still={reduced} /><Dot delay={300} still={reduced} /></View>
      <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k }}>{label}…</Text>
    </View>
  );
}
