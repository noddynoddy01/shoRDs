import React from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Dimensions
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, ThemeType, themes, FontScaleType, fontScaleNames } from "../context/ThemeContext";
import { colors as defaultColors, radius } from "../constants/theme";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { Chip } from "./Chip";

type SettingsTrayProps = {
  visible: boolean;
  onClose: () => void;
  currentUserProfile: {
    name: string;
    email: string;
    role?: string;
    language?: string;
  } | null;
  onProfileUpdate?: () => void;
  onLogout?: () => void;
};

const themeOptions: { key: ThemeType; name: string; color: string; border: string }[] = [
  { key: "dark", name: "Space (Dark)", color: "#0B1020", border: "rgba(103, 232, 249, 0.4)" },
  { key: "light", name: "Clean (Light)", color: "#F8FAFC", border: "rgba(15, 23, 42, 0.2)" },
  { key: "nord", name: "Frost (Nord)", color: "#2E3440", border: "#88C0D0" },
  { key: "sepia", name: "Reading (Sepia)", color: "#F5ECD7", border: "#8B5A2B" },
  { key: "emerald", name: "Matrix (Green)", color: "#062419", border: "#34D399" }
];

const sizeOptions: { key: FontScaleType; label: string }[] = [
  { key: "small", label: "A-" },
  { key: "medium", label: "Aa" },
  { key: "large", label: "A+" },
  { key: "xlarge", label: "A++" }
];

export function SettingsTray({ visible, onClose, currentUserProfile, onProfileUpdate, onLogout }: SettingsTrayProps) {
  const { theme, colors, setTheme, fontScaleType, setFontScale, fontSizeScale } = useTheme();

  const styles = getStyles(colors, fontSizeScale);

  async function handleLogout() {
    Alert.alert("Logout", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await AsyncStorage.removeItem("shords.currentUser");
          onClose();
          if (onLogout) onLogout();
          router.replace("/auth");
        }
      }
    ]);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.dismissBackdrop} onPress={onClose} />
        
        <View style={styles.sheet}>
          <View style={styles.dragIndicator} />
          
          <View style={styles.header}>
            <Text style={styles.title}>Display & Settings</Text>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {/* User Session Info */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Active Session</Text>
              <View style={styles.userCard}>
                <View style={styles.avatar}>
                  <Ionicons
                    name={currentUserProfile?.role === "admin" ? "shield-checkmark" : "person"}
                    size={22}
                    color={currentUserProfile?.role === "admin" ? colors.accent : colors.subdued}
                  />
                </View>
                <View style={styles.userInfo}>
                  <View style={styles.nameRow}>
                    <Text style={styles.userName}>{currentUserProfile?.name || "Anonymous Reader"}</Text>
                    {currentUserProfile?.role === "admin" && (
                      <View style={styles.adminBadge}>
                        <Text style={styles.adminBadgeText}>ADMIN</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.userEmail}>{currentUserProfile?.email || "No Email"}</Text>
                </View>
              </View>
            </View>

            {/* Themes Selector */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>App Color Theme</Text>
              <View style={styles.themeGrid}>
                {themeOptions.map((opt) => {
                  const isSelected = theme === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      style={[styles.themeCard, isSelected && styles.themeCardActive]}
                      onPress={() => setTheme(opt.key)}
                    >
                      <View style={[styles.swatch, { backgroundColor: opt.color, borderColor: opt.border }]}>
                        {isSelected && (
                          <Ionicons name="checkmark" size={14} color={opt.key === "light" ? "#0F172A" : "#FFFFFF"} />
                        )}
                      </View>
                      <Text style={[styles.themeLabel, isSelected && styles.themeLabelActive]}>
                        {opt.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Language Selector */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>App Language</Text>
              <View style={styles.chips}>
                {["English", "Hindi", "Spanish"].map((lang) => (
                  <Chip
                    key={lang}
                    label={lang}
                    selected={currentUserProfile?.language === lang || (!currentUserProfile?.language && lang === "English")}
                    onPress={async () => {
                      if (currentUserProfile) {
                        const updated = { ...currentUserProfile, language: lang };
                        await AsyncStorage.setItem("shords.currentUser", JSON.stringify(updated));
                        if (onProfileUpdate) onProfileUpdate();
                      }
                    }}
                  />
                ))}
              </View>
            </View>

            {/* Display Text Size Selector */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Display Text Size</Text>
              <View style={styles.sizeSelector}>
                {sizeOptions.map((opt) => {
                  const isSelected = fontScaleType === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      style={[styles.sizeOption, isSelected && styles.sizeOptionActive]}
                      onPress={() => setFontScale(opt.key)}
                    >
                      <Text style={[styles.sizeOptionLabel, isSelected && styles.sizeOptionLabelActive]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.previewText}>
                Preview: Research made readable for everyone.
              </Text>
            </View>

            {/* Logout Action */}
            <Pressable style={styles.logoutButton} onPress={handleLogout}>
              <Ionicons name="log-out-outline" size={18} color="#EF4444" />
              <Text style={styles.logoutText}>Sign Out of shoRDs</Text>
            </Pressable>

            <View style={styles.footer}>
              <Text style={styles.footerText}>shoRDs v1.0.0 · Design System Premium</Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(11, 16, 32, 0.4)",
      justifyContent: "flex-end"
    },
    dismissBackdrop: {
      ...StyleSheet.absoluteFillObject
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 20,
      paddingBottom: 28,
      paddingTop: 10,
      maxHeight: Dimensions.get("window").height * 0.85,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -8 },
      shadowOpacity: 0.22,
      shadowRadius: 18,
      elevation: 20
    },
    dragIndicator: {
      width: 44,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      alignSelf: "center",
      marginBottom: 14
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 20
    },
    title: {
      color: colors.text,
      fontSize: 20 * scale,
      fontWeight: "800"
    },
    closeButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    scroll: {
      flexGrow: 0
    },
    section: {
      marginBottom: 22,
      gap: 10
    },
    sectionLabel: {
      color: colors.subdued,
      fontSize: 12 * scale,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 1
    },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8
    },
    userCard: {
      flexDirection: "row",
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      alignItems: "center",
      gap: 12
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.cardElevated,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border
    },
    userInfo: {
      flex: 1,
      gap: 2
    },
    nameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    userName: {
      color: colors.text,
      fontSize: 15 * scale,
      fontWeight: "700"
    },
    adminBadge: {
      backgroundColor: "rgba(6, 182, 212, 0.12)",
      borderColor: "rgba(6, 182, 212, 0.28)",
      borderWidth: 1,
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 1
    },
    adminBadgeText: {
      color: colors.accentSoft,
      fontSize: 9,
      fontWeight: "800"
    },
    userEmail: {
      color: colors.muted,
      fontSize: 12 * scale
    },
    themeGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10
    },
    themeCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 10,
      paddingHorizontal: 12,
      gap: 8,
      width: "48%"
    },
    themeCardActive: {
      borderColor: colors.accentSoft,
      backgroundColor: colors.cardElevated
    },
    swatch: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      alignItems: "center",
      justifyContent: "center"
    },
    themeLabel: {
      color: colors.muted,
      fontSize: 12 * scale,
      fontWeight: "600"
    },
    themeLabelActive: {
      color: colors.text,
      fontWeight: "700"
    },
    sizeSelector: {
      flexDirection: "row",
      backgroundColor: colors.card,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 4
    },
    sizeOption: {
      flex: 1,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.pill
    },
    sizeOptionActive: {
      backgroundColor: colors.primary,
      shadowColor: colors.primary,
      shadowOpacity: 0.2,
      shadowRadius: 6,
      elevation: 2
    },
    sizeOptionLabel: {
      color: colors.subdued,
      fontSize: 14,
      fontWeight: "600"
    },
    sizeOptionLabelActive: {
      color: colors.text,
      fontWeight: "800"
    },
    previewText: {
      color: colors.muted,
      fontSize: 14 * scale,
      marginTop: 6,
      fontStyle: "italic",
      textAlign: "center"
    },
    logoutButton: {
      flexDirection: "row",
      backgroundColor: "rgba(239, 68, 68, 0.08)",
      borderColor: "rgba(239, 68, 68, 0.22)",
      borderWidth: 1,
      borderRadius: radius.md,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginTop: 8
    },
    logoutText: {
      color: "#EF4444",
      fontSize: 14 * scale,
      fontWeight: "700"
    },
    footer: {
      marginTop: 20,
      alignItems: "center"
    },
    footerText: {
      color: colors.subdued,
      fontSize: 11 * scale
    }
  });
}
