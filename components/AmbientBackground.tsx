import { PropsWithChildren, useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../context/ThemeContext";
import { colors as defaultColors } from "../constants/theme";

export function AmbientBackground({ children }: PropsWithChildren) {
  const { colors, theme } = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 3600,
          useNativeDriver: true
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 3600,
          useNativeDriver: true
        })
      ])
    ).start();
  }, [pulse]);

  const glowOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: theme === "light" || theme === "sepia" ? [0.18, 0.32] : [0.28, 0.52]
  });

  // Dynamic glow colors based on theme
  let glowColorLeft = "rgba(6, 182, 212, 0.42)";
  let glowColorRight = "rgba(124, 58, 237, 0.36)";

  if (theme === "light") {
    glowColorLeft = "rgba(6, 182, 212, 0.14)";
    glowColorRight = "rgba(124, 58, 237, 0.10)";
  } else if (theme === "sepia") {
    glowColorLeft = "rgba(160, 82, 45, 0.12)";
    glowColorRight = "rgba(205, 133, 63, 0.10)";
  } else if (theme === "nord") {
    glowColorLeft = "rgba(136, 192, 208, 0.22)";
    glowColorRight = "rgba(129, 161, 193, 0.18)";
  } else if (theme === "emerald") {
    glowColorLeft = "rgba(52, 211, 153, 0.20)";
    glowColorRight = "rgba(16, 185, 129, 0.15)";
  }

  const styles = getStyles(colors);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[colors.background, colors.surface, colors.background]}
        locations={[0, 0.48, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View style={[styles.glowLeft, { backgroundColor: glowColorLeft, opacity: glowOpacity }]} />
      <Animated.View
        style={[
          styles.glowRight,
          {
            backgroundColor: glowColorRight,
            opacity: glowOpacity,
            transform: [
              {
                scale: pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.96, 1.08]
                })
              }
            ]
          }
        ]}
      />
      {children}
    </View>
  );
}

function getStyles(colors: typeof defaultColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
      overflow: "hidden"
    },
    glowLeft: {
      position: "absolute",
      width: 260,
      height: 260,
      borderRadius: 130,
      top: -90,
      left: -100
    },
    glowRight: {
      position: "absolute",
      width: 300,
      height: 300,
      borderRadius: 150,
      bottom: -140,
      right: -120
    }
  });
}
