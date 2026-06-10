import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { GlassButton } from "@/components/GlassButton";
import { Logo } from "@/components/Logo";
import { Screen } from "@/components/Screen";
import { useTheme } from "@/context/ThemeContext";
import { colors as defaultColors, radius } from "@/constants/theme";

const story = [
  {
    title: "Upload your research",
    body: "Drop a PDF and shoRDs prepares it for a global audience."
  },
  {
    title: "AI simplifies the science",
    body: "Dense papers become short, stack-wise cards anyone can understand."
  },
  {
    title: "Research for every corner",
    body: "Scroll like reels, learn like shorts, and foster curiosity worldwide."
  }
];

import AsyncStorage from "@react-native-async-storage/async-storage";

export default function SplashScreen() {
  const { colors, fontSizeScale } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(30)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const storyFade = useRef(new Animated.Value(0)).current;

  const styles = getStyles(colors, fontSizeScale);

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 700, useNativeDriver: true })
      ]),
      Animated.timing(storyFade, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(progress, { toValue: 1, duration: 2200, useNativeDriver: false })
    ]).start();
  }, [opacity, progress, storyFade, translateY]);

  const handleEnterApp = async () => {
    const user = await AsyncStorage.getItem("shords.currentUser");
    if (user) {
      router.replace("/(tabs)");
    } else {
      router.replace("/auth");
    }
  };

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

        <Animated.View style={[styles.storyList, { opacity: storyFade }]}>
          {story.map((item, index) => (
            <View key={item.title} style={styles.storyCard}>
              <Text style={styles.storyIndex}>{String(index + 1).padStart(2, "0")}</Text>
              <View style={styles.storyCopy}>
                <Text style={styles.storyTitle}>{item.title}</Text>
                <Text style={styles.storyBody}>{item.body}</Text>
              </View>
            </View>
          ))}
        </Animated.View>

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

        <GlassButton title="Enter shoRDs" icon="arrow-forward" onPress={handleEnterApp} />
      </Animated.View>
    </Screen>
  );
}

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    screen: {
      justifyContent: "center",
      padding: 22
    },
    content: {
      gap: 20
    },
    logoStage: {
      height: 190,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden"
    },
    copy: {
      gap: 10
    },
    title: {
      color: colors.text,
      fontSize: 26 * scale,
      lineHeight: 32 * scale,
      fontWeight: "800",
      textAlign: "center"
    },
    subtitle: {
      color: colors.muted,
      fontSize: 13 * scale,
      lineHeight: 20 * scale,
      textAlign: "center"
    },
    storyList: {
      gap: 10
    },
    storyCard: {
      flexDirection: "row",
      gap: 12,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 12
    },
    storyIndex: {
      color: colors.accentSoft,
      fontSize: 12 * scale,
      fontWeight: "800",
      marginTop: 2
    },
    storyCopy: {
      flex: 1,
      gap: 3
    },
    storyTitle: {
      color: colors.text,
      fontSize: 13 * scale,
      fontWeight: "800"
    },
    storyBody: {
      color: colors.muted,
      fontSize: 12 * scale,
      lineHeight: 18 * scale
    },
    progressTrack: {
      height: 3,
      borderRadius: 4,
      backgroundColor: colors.border,
      overflow: "hidden"
    },
    progress: {
      height: 3,
      borderRadius: 4,
      backgroundColor: colors.accentSoft
    }
  });
}
