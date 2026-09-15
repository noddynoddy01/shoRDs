import { PropsWithChildren } from "react";
import { StyleSheet, View, ViewStyle, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { layout } from "@/constants/theme";
import { AmbientBackground } from "./AmbientBackground";

type ScreenProps = PropsWithChildren<{
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  maxWidth?: number;
}>;

export function Screen({ children, style, contentStyle, maxWidth }: ScreenProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const resolvedMaxWidth = maxWidth || layout.maxContentWidth;

  return (
    <AmbientBackground>
      <SafeAreaView edges={["top", "left", "right"]} style={[styles.screen, style]}>
        {isWide ? (
          <View style={[styles.desktopWrapper, { maxWidth: resolvedMaxWidth }, contentStyle]}>
            {children}
          </View>
        ) : (
          children
        )}
      </SafeAreaView>
    </AmbientBackground>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "transparent"
  },
  desktopWrapper: {
    flex: 1,
    width: "100%",
    alignSelf: "center"
  }
});
