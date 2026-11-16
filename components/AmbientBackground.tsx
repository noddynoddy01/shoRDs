import { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../context/ThemeContext";

/**
 * The app background: one flat theme colour. Earlier builds drew two animated, pulsing colour glows and a gradient behind every screen; the
 * redesign removes them (calmer, easier to read, no continuous animation, nothing to switch off for reduced motion).
 */
export function AmbientBackground({ children }: PropsWithChildren) {
  const { colors } = useTheme();
  return <View style={[styles.root, { backgroundColor: colors.background }]}>{children}</View>;
}

const styles = StyleSheet.create({ root: { flex: 1, overflow: "hidden" } });
