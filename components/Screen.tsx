import { PropsWithChildren } from "react";
import { StyleSheet, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/constants/theme";
import { AmbientBackground } from "./AmbientBackground";

type ScreenProps = PropsWithChildren<{
  style?: ViewStyle;
}>;

export function Screen({ children, style }: ScreenProps) {
  return (
    <AmbientBackground>
      <SafeAreaView edges={["top", "left", "right"]} style={[styles.screen, style]}>
        {children}
      </SafeAreaView>
    </AmbientBackground>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "transparent"
  }
});
