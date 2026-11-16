import { View } from "react-native";
import { useTheme } from "@/context/ThemeContext";

/** A segmented progress bar for multi-step flows; announces "Step n of m". */
export function ProgressSteps({ total, current }: { total: number; current: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 6 }} accessibilityRole="progressbar" accessibilityLabel={`Step ${current + 1} of ${total}`} accessibilityValue={{ min: 1, max: total, now: current + 1 }}>
      {Array.from({ length: total }).map((_, i) => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= current ? colors.primary : colors.border }} />)}
    </View>
  );
}
