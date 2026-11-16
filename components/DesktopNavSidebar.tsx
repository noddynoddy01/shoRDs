import React from "react";
import { StyleSheet, Text, View, ScrollView, Pressable } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import { domains } from "@/data/samplePapers";

interface DesktopNavSidebarProps {
  currentDomain?: string;
  onSelectDomain: (domain?: string) => void;
  onRefreshFeed: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
}

/**
 * The feed's own column: refresh, audio and the domain filter. Site navigation lives in the global rail (components/nav/AppRail),
 * and the account/plan controls live in the rail's account menu and Profile, so none of them is repeated here.
 */
export function DesktopNavSidebar({ currentDomain, onSelectDomain, onRefreshFeed, isMuted, onToggleMute }: DesktopNavSidebarProps) {
  const { colors, fontSizeScale } = useTheme();
  const styles = getStyles(colors, fontSizeScale);

  return (
    <View style={styles.container}>
      <View style={styles.brandRow}>
        <Text style={styles.filterTitle} accessibilityRole="header">Feed</Text>
      </View>

      <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>ACTIONS</Text>
          <Pressable style={styles.actionBtn} onPress={onRefreshFeed} accessibilityRole="button" accessibilityLabel="Refresh the feed">
            <Ionicons name="refresh-outline" size={16} color={colors.text} />
            <Text style={styles.actionBtnText}>Refresh feed</Text>
          </Pressable>

          <Pressable style={styles.actionBtn} onPress={onToggleMute} accessibilityRole="button" accessibilityLabel={isMuted ? "Unmute audio" : "Mute audio"}>
            <Ionicons name={isMuted ? "volume-mute" : "volume-high"} size={16} color={colors.text} />
            <Text style={styles.actionBtnText}>{isMuted ? "Unmute audio" : "Mute audio"}</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>RESEARCH DOMAINS</Text>
          <Pressable
            style={[styles.domainItem, !currentDomain && styles.domainItemActive]}
            onPress={() => onSelectDomain(undefined)}
            accessibilityRole="button"
            accessibilityState={{ selected: !currentDomain }}
            aria-pressed={!currentDomain}
          >
            <Text style={[styles.domainText, !currentDomain && styles.domainTextActive]}>All discoveries</Text>
          </Pressable>

          {domains.map((d) => {
            const isActive = currentDomain === d;
            return (
              <Pressable
                key={d}
                style={[styles.domainItem, isActive && styles.domainItemActive]}
                onPress={() => onSelectDomain(d)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                aria-pressed={isActive}
              >
                <Text style={[styles.domainText, isActive && styles.domainTextActive]}>{d}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
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
    filterTitle: {
      color: colors.text,
      fontSize: 16 * scale,
      fontWeight: "800"
    }
  });
}
