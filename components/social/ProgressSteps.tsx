import { View } from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { GrowBar } from "@/components/ui/motion";

/** A segmented progress bar for multi-step flows; each segment fills smoothly as you advance. Announces "Step n of m". */
export function ProgressSteps({ total, current }: { total: number; current: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 6 }} accessibilityRole="progressbar" accessibilityLabel={`Step ${current + 1} of ${total}`} accessibilityValue={{ min: 1, max: total, now: current + 1 }}>
      {Array.from({ length: total }).map((_, i) => <GrowBar key={i} fraction={i <= current ? 1 : 0} color={colors.primary} track={colors.border} />)}
    </View>
  );
}
