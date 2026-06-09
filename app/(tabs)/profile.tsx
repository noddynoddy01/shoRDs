import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Chip } from "@/components/Chip";
import { ProfileHeader } from "@/components/ProfileHeader";
import { ResearchCard } from "@/components/ResearchCard";
import { Screen } from "@/components/Screen";
import { colors as defaultColors, radius } from "@/constants/theme";
import { currentUser as fallbackUser } from "@/data/samplePapers";
import { useFeedMetrics } from "@/hooks/useFeedMetrics";
import { getAllPapers } from "@/services/papersStore";
import { getSavedPaperIds } from "@/services/savedPapers";
import { getUploadedPaperCount } from "@/services/uploadedPapers";
import { useTheme } from "@/context/ThemeContext";
import { UserProfile } from "@/types/models";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { GlassButton } from "@/components/GlassButton";

export default function ProfileScreen() {
  const { colors, fontSizeScale } = useTheme();
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [uploadCount, setUploadCount] = useState(0);
  const [papers, setPapers] = useState<Awaited<ReturnType<typeof getAllPapers>>>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>(fallbackUser);
  const { contentBottomPadding } = useFeedMetrics();

  const styles = getStyles(colors, fontSizeScale);

  const fetchProfileData = useCallback(() => {
    getSavedPaperIds().then(setSavedIds);
    getUploadedPaperCount().then(setUploadCount);
    getAllPapers().then(setPapers);
    AsyncStorage.getItem("shords.currentUser").then((val) => {
      if (val) {
        setUserProfile(JSON.parse(val));
      } else {
        setUserProfile(fallbackUser);
      }
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchProfileData();
    }, [fetchProfileData])
  );

  const savedPapers = useMemo(
    () => papers.filter((paper) => savedIds.includes(paper.id)),
    [papers, savedIds]
  );

  const uploadedPapers = useMemo(
    () => papers.filter((paper) => paper.authorId === "local-uploader" || paper.authorId === userProfile.id),
    [papers, userProfile.id]
  );

  const stats = [
    { label: "Papers Uploaded", value: String(uploadCount) },
    { label: "Saved Papers", value: String(savedPapers.length) },
    { label: "Followers", value: userProfile.role === "admin" ? "24k" : "1.2k" }
  ];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: contentBottomPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <ProfileHeader profile={userProfile} />

        <View style={styles.stats}>
          {stats.map((stat) => (
            <View key={stat.label} style={styles.stat}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Subscription Status Card */}
        <View style={styles.subscriptionCard}>
          <LinearGradient
            colors={userProfile.subscription?.tier === "premium" ? ["rgba(6,182,212,0.14)", "rgba(124,58,237,0.08)"] : [colors.card, colors.card] as any}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.subHeader}>
            <Ionicons name="sparkles" size={20} color={userProfile.subscription?.tier === "premium" ? colors.accentSoft : colors.subdued} />
            <Text style={styles.subTitle}>
              {userProfile.subscription?.tier === "premium" ? "Premium Access Active" : "Free Academic Account"}
            </Text>
          </View>
          {userProfile.subscription?.tier === "premium" ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.subText}>
                Expires: {new Date(userProfile.subscription.expiresAt).toLocaleDateString()}
              </Text>
              <GlassButton
                title="Cancel Subscription"
                variant="quiet"
                onPress={async () => {
                  const { cancelSubscription } = await import("@/services/subscriptionService");
                  const updated = await cancelSubscription();
                  if (updated) {
                    setUserProfile(updated);
                    Alert.alert("Canceled", "Your premium subscription has been canceled.");
                  }
                }}
              />
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              <Text style={styles.subText}>Upgrade to read unlimited briefs and chat with research mentors.</Text>
              <GlassButton
                title="View Subscriptions"
                icon="sparkles"
                onPress={() => router.push("/paywall" as never)}
              />
            </View>
          )}
        </View>


        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Interests</Text>
          <View style={styles.chips}>
            {userProfile.interests.map((interest) => (
              <Chip key={interest} label={interest} selected />
            ))}
          </View>
        </View>

        <Pressable style={styles.contactCard} onPress={() => router.push("/(tabs)/contact" as never)}>
          <Text style={styles.contactTitle}>Contact shoRDs</Text>
          <Text style={styles.contactText}>Abhinav Prakash · IIIT Surat · 8757674333 · India</Text>
        </Pressable>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Uploaded Papers</Text>
            <Text style={styles.count}>{uploadedPapers.length}</Text>
          </View>
          {uploadedPapers.length ? (
            <View style={styles.list}>
              {uploadedPapers.map((paper) => (
                <ResearchCard key={paper.id} paper={paper} compact />
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>Upload research papers from the Upload tab and they will appear here.</Text>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Saved Papers</Text>
            <Text style={styles.count}>{savedPapers.length}</Text>
          </View>
          {savedPapers.length ? (
            <View style={styles.list}>
              {savedPapers.map((paper) => (
                <ResearchCard key={paper.id} paper={paper} compact />
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>Bookmark papers from Home or Explore and they will appear here.</Text>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    content: {
      padding: 18,
      gap: 18
    },
    stats: {
      flexDirection: "row",
      gap: 10
    },
    stat: {
      flex: 1,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: 14,
      gap: 4
    },
    statValue: {
      color: colors.text,
      fontSize: 18 * scale,
      fontWeight: "700"
    },
    statLabel: {
      color: colors.subdued,
      fontSize: 10 * scale,
      fontWeight: "600"
    },
    section: {
      gap: 12
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between"
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 18 * scale,
      fontWeight: "800"
    },
    count: {
      color: colors.subdued,
      fontWeight: "700",
      fontSize: 13 * scale
    },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8
    },
    list: {
      gap: 14
    },
    contactCard: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: "rgba(6, 182, 212, 0.08)",
      padding: 16,
      gap: 6
    },
    contactTitle: {
      color: colors.text,
      fontSize: 16 * scale,
      fontWeight: "800"
    },
    contactText: {
      color: colors.muted,
      fontSize: 13 * scale,
      lineHeight: 20 * scale
    },
    empty: {
      color: colors.muted,
      fontSize: 13 * scale,
      lineHeight: 20 * scale
    },
    subscriptionCard: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      gap: 10,
      overflow: "hidden"
    },
    subHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    subTitle: {
      color: colors.text,
      fontSize: 15 * scale,
      fontWeight: "800"
    },
    subText: {
      color: colors.muted,
      fontSize: 13 * scale,
      lineHeight: 18 * scale
    },
    label: {
      color: colors.muted,
      fontSize: 11 * scale,
      fontWeight: "700"
    }
  });
}
