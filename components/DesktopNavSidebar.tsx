import React from "react";
import { StyleSheet, Text, View, ScrollView, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Logo } from "@/components/Logo";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import { domains } from "@/data/samplePapers";

interface DesktopNavSidebarProps {
  currentDomain?: string;
  onSelectDomain: (domain?: string) => void;
  onRefreshFeed: () => void;
  onOpenSettings: () => void;
  onOpenSubscription: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  userProfile?: { name: string; email: string } | null;
}

export function DesktopNavSidebar({
  currentDomain,
  onSelectDomain,
  onRefreshFeed,
  onOpenSettings,
  onOpenSubscription,
  isMuted,
  onToggleMute,
  userProfile
}: DesktopNavSidebarProps) {
  const { colors, fontSizeScale } = useTheme();
  const styles = getStyles(colors, fontSizeScale);

  const navItems = [
    { label: "Feed", icon: "newspaper-outline" as const, route: "/(tabs)" },
    { label: "Explore", icon: "compass-outline" as const, route: "/(tabs)/explore" },
    { label: "Review Mode", icon: "git-compare-outline" as const, route: "/review-mode" },
    { label: "Search", icon: "search-outline" as const, route: "/search" },
    { label: "Profile", icon: "person-outline" as const, route: "/(tabs)/profile" }
  ];

  return (
    <View style={styles.container}>
      {/* Brand Header */}
      <View style={styles.brandRow}>
        <Logo />
      </View>

      <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
        {/* Navigation Items */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>NAVIGATION</Text>
          {navItems.map((item, idx) => (
            <Pressable
              key={idx}
              style={styles.navItem}
              onPress={() => router.push(item.route as never)}
            >
              <Ionicons name={item.icon} size={18} color={colors.primary} />
              <Text style={styles.navText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>ACTIONS</Text>
          <Pressable style={styles.actionBtn} onPress={onRefreshFeed}>
            <Ionicons name="refresh-outline" size={16} color={colors.text} />
            <Text style={styles.actionBtnText}>Refresh Feed</Text>
          </Pressable>

          <Pressable style={styles.actionBtn} onPress={onToggleMute}>
            <Ionicons name={isMuted ? "volume-mute" : "volume-high"} size={16} color={colors.text} />
            <Text style={styles.actionBtnText}>{isMuted ? "Unmute Audio" : "Mute Audio"}</Text>
          </Pressable>
        </View>

        {/* Topics / Domains */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>RESEARCH DOMAINS</Text>
          <Pressable
            style={[styles.domainItem, !currentDomain && styles.domainItemActive]}
            onPress={() => onSelectDomain(undefined)}
          >
            <Text style={[styles.domainText, !currentDomain && styles.domainTextActive]}>
              All Discoveries
            </Text>
          </Pressable>

          {domains.map((d) => {
            const isActive = currentDomain === d;
            return (
              <Pressable
                key={d}
                style={[styles.domainItem, isActive && styles.domainItemActive]}
                onPress={() => onSelectDomain(d)}
              >
                <Text style={[styles.domainText, isActive && styles.domainTextActive]}>
                  {d}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Footer Profile & Plan */}
      <View style={styles.footer}>
        <Pressable style={styles.subBanner} onPress={onOpenSubscription}>
          <LinearGradient
            colors={["#F59E0B22", "#F59E0B08"]}
            style={styles.subBannerGrad}
          >
            <Ionicons name="sparkles" size={14} color="#F59E0B" />
            <View style={{ flex: 1 }}>
              <Text style={styles.subTitle}>PRO RESEARCH PASS</Text>
              <Text style={styles.subDesc}>Full text & Claude 3.5 Sonnet</Text>
            </View>
          </LinearGradient>
        </Pressable>

        <Pressable style={styles.profileRow} onPress={onOpenSettings}>
          <LinearGradient
            colors={["#06B6D4", "#8B5CF6"]}
            style={styles.profileAvatar}
          >
            <Text style={styles.profileInitials}>
              {userProfile?.name ? userProfile.name.slice(0, 2).toUpperCase() : "AP"}
            </Text>
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName} numberOfLines={1}>
              {userProfile?.name || "Abhinav Prakash"}
            </Text>
            <Text style={styles.profileRole}>Research Scientist</Text>
          </View>
          <Ionicons name="settings-outline" size={16} color={colors.subdued} />
        </Pressable>
      </View>
    </View>
  );
}

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    container: {
      width: 260,
      backgroundColor: colors.card,
      borderRightWidth: 1,
      borderColor: colors.border,
      display: "flex",
      flexDirection: "column"
    },
    brandRow: {
      padding: spacing.md,
      paddingTop: spacing.lg,
      borderBottomWidth: 1,
      borderColor: colors.border
    },
    scrollArea: {
      flex: 1,
      padding: spacing.md
    },
    section: {
      marginBottom: spacing.lg
    },
    sectionHeader: {
      color: colors.subdued,
      fontSize: 10 * scale,
      fontWeight: "800",
      letterSpacing: 1.0,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.xs
    },
    navItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: 9,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md
    },
    navText: {
      color: colors.text,
      fontSize: 13 * scale,
      fontWeight: "600"
    },
    actionBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: 8,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.background,
      marginBottom: spacing.xs,
      borderWidth: 1,
      borderColor: colors.border
    },
    actionBtnText: {
      color: colors.text,
      fontSize: 12 * scale,
      fontWeight: "600"
    },
    domainItem: {
      paddingVertical: 7,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
      marginBottom: 2
    },
    domainItemActive: {
      backgroundColor: colors.primary + "18"
    },
    domainText: {
      color: colors.subdued,
      fontSize: 12 * scale,
      fontWeight: "500"
    },
    domainTextActive: {
      color: colors.primary,
      fontWeight: "700"
    },
    footer: {
      padding: spacing.md,
      borderTopWidth: 1,
      borderColor: colors.border
    },
    subBanner: {
      borderRadius: radius.md,
      overflow: "hidden",
      marginBottom: spacing.sm
    },
    subBannerGrad: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      padding: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: "#F59E0B44"
    },
    subTitle: {
      color: "#F59E0B",
      fontSize: 10 * scale,
      fontWeight: "800",
      letterSpacing: 0.5
    },
    subDesc: {
      color: colors.subdued,
      fontSize: 9 * scale,
      marginTop: 1
    },
    profileRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm
    },
    profileAvatar: {
      width: 32,
      height: 32,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center"
    },
    profileInitials: {
      color: "#FFF",
      fontSize: 11 * scale,
      fontWeight: "800"
    },
    profileName: {
      color: colors.text,
      fontSize: 12 * scale,
      fontWeight: "700"
    },
    profileRole: {
      color: colors.subdued,
      fontSize: 10 * scale
    }
  });
}
