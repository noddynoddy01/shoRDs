import { PropsWithChildren, useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "@/constants/theme";

export function AmbientBackground({ children }: PropsWithChildren) {
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
    outputRange: [0.28, 0.52]
  });

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[colors.background, "#0C1729", colors.background]}
        locations={[0, 0.48, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View style={[styles.aquaGlow, { opacity: glowOpacity }]} />
      <Animated.View
        style={[
          styles.purpleGlow,
          {
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    overflow: "hidden"
  },
  aquaGlow: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    top: -90,
    left: -100,
    backgroundColor: "rgba(6, 182, 212, 0.42)"
  },
  purpleGlow: {
    position: "absolute",
    width: 300,
    height: 300,
    borderRadius: 150,
    bottom: -140,
    right: -120,
    backgroundColor: "rgba(124, 58, 237, 0.36)"
  }
});
