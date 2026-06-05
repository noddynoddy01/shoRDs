import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { GlassButton } from "@/components/GlassButton";
import { Logo } from "@/components/Logo";
import { Screen } from "@/components/Screen";
import { colors, radius } from "@/constants/theme";

const pillars = ["Upload papers", "AI simplifies", "Read like shorts"];

export default function SplashScreen() {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(24)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 760,
        useNativeDriver: true
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 760,
        useNativeDriver: true
      }),
      Animated.timing(progress, {
        toValue: 1,
        duration: 2600,
        useNativeDriver: false
      })
    ]).start();

    const timeout = setTimeout(() => router.replace("/auth"), 3600);
    return () => clearTimeout(timeout);
  }, [opacity, progress, translateY]);

  return (
    <Screen style={styles.screen}>
      <Animated.View style={[styles.content, { opacity, transform: [{ translateY }] }]}>
        <View style={styles.logoStage}>
          <LinearGradient
            colors={["rgba(6,182,212,0.22)", "rgba(124,58,237,0.10)", "transparent"]}
            style={StyleSheet.absoluteFill}
          />
          <Logo size="lg" />
        </View>

        <View style={styles.copy}>
          <Text style={styles.title}>Research made readable for everyone.</Text>
          <Text style={styles.subtitle}>
            shoRDs turns dense papers into clean, stack-wise briefs so students, builders, and curious readers can understand ideas faster.
          </Text>
        </View>

        <View style={styles.pillars}>
          {pillars.map((pillar) => (
            <View key={pillar} style={styles.pillar}>
              <Text style={styles.pillarText}>{pillar}</Text>
            </View>
          ))}
        </View>

        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progress,
              {
                width: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["8%", "100%"]
                })
              }
            ]}
          />
        </View>

        <GlassButton title="Enter shoRDs" icon="arrow-forward" onPress={() => router.replace("/auth")} />
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    justifyContent: "center",
    padding: 22
  },
  content: {
    gap: 22
  },
  logoStage: {
    height: 210,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(21, 27, 47, 0.62)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden"
  },
  copy: {
    gap: 10
  },
  title: {
    color: colors.text,
    fontSize: 32,
    lineHeight: 39,
    fontWeight: "800",
    textAlign: "center"
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center"
  },
  pillars: {
    flexDirection: "row",
    gap: 8
  },
  pillar: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8
  },
  pillarText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center"
  },
  progressTrack: {
    height: 3,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden"
  },
  progress: {
    height: 3,
    borderRadius: 4,
    backgroundColor: colors.accentSoft
  }
});
