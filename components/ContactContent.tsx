import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Animated, Linking, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { GlassButton } from "@/components/GlassButton";
import { Logo } from "@/components/Logo";
import { useTheme } from "../context/ThemeContext";
import { colors as defaultColors, radius } from "../constants/theme";

export const contactDetails = {
  name: "ABHINAV PRAKASH",
  institute: "IIIT SURAT",
  phone: "8757674333",
  country: "INDIA"
};

type ContactContentProps = {
  showBack?: boolean;
  onBack?: () => void;
};

export function ContactContent({ showBack, onBack }: ContactContentProps) {
  const { colors, fontSizeScale, theme } = useTheme();
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(28)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 680, useNativeDriver: true }),
      Animated.spring(slide, { toValue: 0, friction: 8, tension: 42, useNativeDriver: true })
    ]).start();
  }, [fade, slide]);

  const styles = getStyles(colors, fontSizeScale);

  async function callContact() {
    await Linking.openURL(`tel:${contactDetails.phone}`);
  }

  async function shareContact() {
    await Share.share({
      title: "shoRDs Contact",
      message: `${contactDetails.name}\n${contactDetails.institute}\n${contactDetails.phone}\n${contactDetails.country}`
    });
  }

  const cardColors = theme === "light" || theme === "sepia"
    ? [colors.card, colors.cardElevated]
    : ["rgba(255,255,255,0.06)", "rgba(255,255,255,0.02)"];

  return (
    <Animated.View style={[styles.wrap, { opacity: fade, transform: [{ translateY: slide }] }]}>
      <View style={styles.topBar}>
        {showBack ? (
          <Pressable style={styles.iconButton} onPress={onBack}>
            <Ionicons name="arrow-back" color={colors.text} size={21} />
          </Pressable>
        ) : (
          <View style={styles.iconSpacer} />
        )}
        <Logo />
        <View style={styles.iconSpacer} />
      </View>

      <View style={styles.hero}>
        <LinearGradient
          colors={
            (theme === "light"
              ? ["rgba(6,182,212,0.12)", "rgba(124,58,237,0.06)", "transparent"]
              : ["rgba(6,182,212,0.22)", "rgba(124,58,237,0.12)", "rgba(255,255,255,0.03)"]) as any
          }
          style={StyleSheet.absoluteFill}
        />
        <Text style={styles.kicker}>Contact Us</Text>
        <Text style={styles.title}>Let research travel further — together.</Text>
        <Text style={styles.subtitle}>
          Reach shoRDs for paper uploads, mentoring, collaborations, and making science readable worldwide.
        </Text>
      </View>

      <View style={styles.card}>
        <LinearGradient
          colors={cardColors as any}
          style={StyleSheet.absoluteFill}
        />
        <Text style={styles.name}>{contactDetails.name}</Text>
        <View style={styles.detailRow}>
          <Ionicons name="school-outline" color={colors.accentSoft} size={18} />
          <Text style={styles.detail}>{contactDetails.institute}</Text>
        </View>
        <View style={styles.detailRow}>
          <Ionicons name="call-outline" color={colors.accentSoft} size={18} />
          <Text style={styles.detail}>{contactDetails.phone}</Text>
        </View>
        <View style={styles.detailRow}>
          <Ionicons name="location-outline" color={colors.accentSoft} size={18} />
          <Text style={styles.detail}>{contactDetails.country}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <GlassButton title="Call Now" icon="call-outline" onPress={callContact} />
        <GlassButton title="Share Contact" icon="share-social-outline" variant="quiet" onPress={shareContact} />
      </View>
    </Animated.View>
  );
}

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    wrap: {
      gap: 18
    },
    topBar: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center"
    },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    iconSpacer: {
      width: 44
    },
    hero: {
      minHeight: 210,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 22,
      justifyContent: "flex-end",
      overflow: "hidden",
      gap: 9
    },
    kicker: {
      color: colors.accentSoft,
      fontSize: 12 * scale,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 1.2
    },
    title: {
      color: colors.text,
      fontSize: 26 * scale,
      lineHeight: 32 * scale,
      fontWeight: "800"
    },
    subtitle: {
      color: colors.muted,
      fontSize: 14 * scale,
      lineHeight: 21 * scale
    },
    card: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 20,
      gap: 14,
      overflow: "hidden"
    },
    name: {
      color: colors.text,
      fontSize: 20 * scale,
      fontWeight: "800",
      letterSpacing: 0.6
    },
    detailRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10
    },
    detail: {
      color: colors.muted,
      fontSize: 14 * scale,
      fontWeight: "600"
    },
    actions: {
      gap: 12
    }
  });
}
