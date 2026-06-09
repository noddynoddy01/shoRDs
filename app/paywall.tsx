import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Screen } from "@/components/Screen";
import { GlassButton } from "@/components/GlassButton";
import { useTheme } from "@/context/ThemeContext";
import { colors as defaultColors, radius } from "@/constants/theme";
import { getCurrentUser, purchaseSubscription, PRICING_PLANS } from "@/services/subscriptionService";

export default function PaywallScreen() {
  const { colors, fontSizeScale } = useTheme();
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "yearly">("monthly");
  const [currency, setCurrency] = useState<"USD" | "INR">("USD");
  const [loading, setLoading] = useState(false);

  const styles = getStyles(colors, fontSizeScale);

  useEffect(() => {
    getCurrentUser().then((user) => {
      if (user) {
        const isIndia = user.phoneNumber?.startsWith("+91") || user.country === "India";
        setCurrency(isIndia ? "INR" : "USD");
      }
    });
  }, []);

  const plans = PRICING_PLANS[currency];

  async function handlePurchase() {
    setLoading(true);
    const updated = await purchaseSubscription(selectedPlan);
    setLoading(false);
    if (updated) {
      Alert.alert(
        "Subscription Activated!",
        `You are now a shoRDs Premium member. Welcome to full academic access!`,
        [{ text: "Awesome", onPress: () => router.replace("/(tabs)") }]
      );
    } else {
      Alert.alert("Error", "Could not complete purchase. Please log in first.");
    }
  }

  const features = [
    { icon: "infinite-outline", title: "Unlimited Research Briefs", desc: "No more daily card limit. Scroll and search everything." },
    { icon: "chatbubbles-outline", title: "Direct Mentor Connections", desc: "Open a chat channel with university mentors and scholars." },
    { icon: "language-outline", title: "Multi-Language Translations", desc: "Access all paper stacks in English, Hindi, Spanish & more." },
    { icon: "cloud-download-outline", title: "Original PDF Access", desc: "Read original research publications and downloadable PDFs." }
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header navigation */}
        <View style={styles.header}>
          <Pressable style={styles.closeBtn} onPress={() => router.back()}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>shoRDs Premium</Text>
          <View style={{ width: 44 }} />
        </View>

        <View style={styles.hero}>
          <LinearGradient
            colors={["rgba(6,182,212,0.24)", "rgba(124,58,237,0.12)", "transparent"]}
            style={StyleSheet.absoluteFill}
          />
          <Ionicons name="sparkles" size={48} color={colors.accentSoft} />
          <Text style={styles.title}>Unlock the Frontiers of Science</Text>
          <Text style={styles.subtitle}>
            Support student researchers and gain infinite scientific summaries, mentorship access, and localized translations.
          </Text>
        </View>

        {/* Benefits Grid */}
        <View style={styles.benefits}>
          {features.map((f) => (
            <View key={f.title} style={styles.benefit}>
              <View style={styles.benefitIcon}>
                <Ionicons name={f.icon as any} size={22} color={colors.accentSoft} />
              </View>
              <View style={styles.benefitCopy}>
                <Text style={styles.benefitTitle}>{f.title}</Text>
                <Text style={styles.benefitDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Subscription cards */}
        <View style={styles.plans}>
          <Pressable
            style={[styles.planCard, selectedPlan === "monthly" && styles.planCardActive]}
            onPress={() => setSelectedPlan("monthly")}
          >
            <View style={styles.planRadio}>
              <View style={[styles.radioDot, selectedPlan === "monthly" && styles.radioDotActive]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.planName}>Monthly Membership</Text>
              <Text style={styles.planDesc}>Flexible monthly billing. Cancel anytime.</Text>
            </View>
            <Text style={styles.planPrice}>
              {plans.monthly.symbol}
              {plans.monthly.price}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.planCard, selectedPlan === "yearly" && styles.planCardActive]}
            onPress={() => setSelectedPlan("yearly")}
          >
            <LinearGradient
              colors={selectedPlan === "yearly" ? ["rgba(124,58,237,0.08)", "rgba(6,182,212,0.02)"] : ["transparent", "transparent"]}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.badge}>
              <Text style={styles.badgeText}>BEST VALUE</Text>
            </View>
            <View style={styles.planRadio}>
              <View style={[styles.radioDot, selectedPlan === "yearly" && styles.radioDotActive]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.planName}>Annual Membership</Text>
              <Text style={styles.planDesc}>Save over 18% compared to monthly plan.</Text>
            </View>
            <Text style={styles.planPrice}>
              {plans.yearly.symbol}
              {plans.yearly.price}
            </Text>
          </Pressable>
        </View>

        <GlassButton
          title={loading ? "Verifying Transaction..." : "Upgrade Now"}
          icon="shield-checkmark-outline"
          onPress={handlePurchase}
          disabled={loading}
          style={styles.payBtn}
        />
        
        <Text style={styles.disclaimer}>
          By continuing, you agree to our Terms of Service & Privacy Policy. Subscriptions automatically renew at the same price.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    content: {
      padding: 18,
      paddingBottom: 44,
      gap: 22
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center"
    },
    closeBtn: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    headerTitle: {
      color: colors.text,
      fontSize: 16 * scale,
      fontWeight: "800"
    },
    hero: {
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      overflow: "hidden",
      gap: 12
    },
    title: {
      color: colors.text,
      fontSize: 22 * scale,
      lineHeight: 28 * scale,
      fontWeight: "800",
      textAlign: "center"
    },
    subtitle: {
      color: colors.muted,
      fontSize: 13 * scale,
      lineHeight: 20 * scale,
      textAlign: "center"
    },
    benefits: {
      gap: 16
    },
    benefit: {
      flexDirection: "row",
      gap: 14,
      alignItems: "flex-start"
    },
    benefitIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: colors.cardElevated,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    benefitCopy: {
      flex: 1,
      gap: 2
    },
    benefitTitle: {
      color: colors.text,
      fontSize: 15 * scale,
      fontWeight: "800"
    },
    benefitDesc: {
      color: colors.muted,
      fontSize: 12 * scale,
      lineHeight: 18 * scale
    },
    plans: {
      gap: 12
    },
    planCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      padding: 16,
      gap: 12,
      overflow: "hidden"
    },
    planCardActive: {
      borderColor: colors.accentSoft
    },
    planRadio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: colors.subdued,
      alignItems: "center",
      justifyContent: "center"
    },
    radioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: "transparent"
    },
    radioDotActive: {
      backgroundColor: colors.accentSoft
    },
    planName: {
      color: colors.text,
      fontSize: 15 * scale,
      fontWeight: "800"
    },
    planDesc: {
      color: colors.subdued,
      fontSize: 11 * scale,
      marginTop: 2
    },
    planPrice: {
      color: colors.text,
      fontSize: 18 * scale,
      fontWeight: "800"
    },
    badge: {
      position: "absolute",
      right: 0,
      top: 0,
      backgroundColor: colors.primary,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderBottomLeftRadius: radius.md
    },
    badgeText: {
      color: "#FFFFFF",
      fontSize: 9,
      fontWeight: "900"
    },
    payBtn: {
      marginTop: 8
    },
    disclaimer: {
      color: colors.subdued,
      fontSize: 11 * scale,
      lineHeight: 16 * scale,
      textAlign: "center",
      paddingHorizontal: 12
    }
  });
}
