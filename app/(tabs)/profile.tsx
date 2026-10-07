import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Chip } from "@/components/Chip";
import { ProfileHeader } from "@/components/ProfileHeader";
import { ResearchCard } from "@/components/ResearchCard";
import { Screen } from "@/components/Screen";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useFeedMetrics } from "@/hooks/useFeedMetrics";
import { getAllPapers } from "@/services/papersStore";
import { getSavedPaperIds } from "@/services/savedPapers";
import { getUploadedPaperCount } from "@/services/uploadedPapers";
import { useTheme } from "@/context/ThemeContext";
import { Paper, UserProfile } from "@/types/models";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GlassButton } from "@/components/GlassButton";

/** Shown when nobody is signed in: a neutral placeholder, not a made-up person. */
const SIGNED_OUT_PROFILE: UserProfile = { id: "", name: "Not signed in", email: "", bio: "", interests: [], profileImage: "", role: "user" };

export default function ProfileScreen() {
  const { colors, fontSizeScale, theme } = useTheme();
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [uploadCount, setUploadCount] = useState(0);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>(SIGNED_OUT_PROFILE);
  const { contentBottomPadding } = useFeedMetrics();

  const styles = getStyles(colors, fontSizeScale, theme);

  const fetchProfileData = useCallback(() => {
    getSavedPaperIds().then(setSavedIds);
    getUploadedPaperCount().then(setUploadCount);
    setPapers(getAllPapers());
    AsyncStorage.getItem("shords.currentUser").then((val) => {
      if (val) {
        setUserProfile(JSON.parse(val));
      } else {
        setUserProfile(SIGNED_OUT_PROFILE);
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

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: contentBottomPadding + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <ProfileHeader profile={userProfile} />

        {/* Counts of what is actually on this device. No scores or streaks: none are computed anywhere. */}
        <View style={styles.statsGrid}>
          <View style={styles.statCell}>
            <Text style={styles.statVal}>{savedPapers.length}</Text>
            <Text style={styles.statLbl}>SAVED PAPERS</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statVal}>{uploadCount}</Text>
            <Text style={styles.statLbl}>ADDED BY YOU</Text>
          </View>
        </View>

        {/* Research Focus Areas */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionHeaderTitle}>Research Focus Areas</Text>
          <View style={styles.interestsGrid}>
            {userProfile.interests.map((interest) => (
              <Chip key={interest} label={interest.toUpperCase()} selected />
            ))}
          </View>
        </View>

        {/* Published Briefs */}
        <View style={styles.sectionContainer}>
          <View style={styles.listHeaderRow}>
            <Text style={styles.sectionHeaderTitle}>Briefs You Added</Text>
            <Text style={styles.listBadge}>{uploadedPapers.length}</Text>
          </View>
          {uploadedPapers.length ? (
            <View style={styles.paperList}>
              {uploadedPapers.map((paper) => (
                <ResearchCard key={paper.id} paper={paper} compact />
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>Upload manuscripts to build your research portfolio.</Text>
          )}
        </View>

        {/* Saved Papers */}
        <View style={styles.sectionContainer}>
          <View style={styles.listHeaderRow}>
            <Text style={styles.sectionHeaderTitle}>Saved Library Archives</Text>
            <Text style={styles.listBadge}>{savedPapers.length}</Text>
          </View>
          {savedPapers.length ? (
            <View style={styles.paperList}>
              {savedPapers.map((paper) => (
                <ResearchCard key={paper.id} paper={paper} compact />
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>Bookmark papers from feeds to archive them here.</Text>
          )}
        </View>

        {/* Contact Operations Card (Strictly Email) */}
        <Pressable style={styles.contactOpsCard} onPress={() => router.push("/(tabs)/contact" as never)}>
          <Text style={styles.contactTitle}>shoRDs Academic Support</Text>
          <Text style={styles.contactEmail}>abhinavprakash0401@gmail.com</Text>
          <Text style={styles.contactSub}>IIIT Surat · India</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function getStyles(colors: typeof defaultColors, scale: number, theme: string) {
  return StyleSheet.create({
    content: {
      padding: spacing.md,
      gap: spacing.md
    },
    statsGrid: {
      flexDirection: "row",
      gap: 8
    },
    statCell: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: 2,
      borderWidth: 1,
      borderColor: colors.border
    },
    statVal: {
      fontSize: 18 * scale,
      fontWeight: "800",
      color: colors.text
    },
    statLbl: {
      fontSize: 8 * scale,
      fontWeight: "800",
      color: colors.subdued
    },
    sectionContainer: {
      gap: spacing.xs
    },
    sectionHeaderTitle: {
      fontSize: 13 * scale,
      fontWeight: "800",
      color: colors.text,
      letterSpacing: 0.5
    },
    timelineBox: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: 12,
      borderWidth: 1,
      borderColor: colors.border
    },
    timelineRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10
    },
    nodePoint: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.primary + "12",
      alignItems: "center",
      justifyContent: "center"
    },
    nodeTextContent: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    nodeYearText: {
      fontSize: 10 * scale,
      fontWeight: "800",
      color: colors.primary
    },
    nodeLabelText: {
      fontSize: 12 * scale,
      fontWeight: "700",
      color: colors.text
    },
    interestsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8
    },
    listHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between"
    },
    listBadge: {
      fontSize: 10 * scale,
      fontWeight: "800",
      color: colors.primary,
      backgroundColor: colors.primary + "12",
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.pill
    },
    paperList: {
      gap: spacing.xs
    },
    emptyText: {
      fontSize: 11 * scale,
      color: colors.subdued
    },
    contactOpsCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: 4,
      borderWidth: 1,
      borderColor: colors.border
    },
    contactTitle: {
      fontSize: 14 * scale,
      fontWeight: "800",
      color: colors.text
    },
    contactEmail: {
      fontSize: 12 * scale,
      fontWeight: "800",
      color: colors.primary
    },
    contactSub: {
      fontSize: 10 * scale,
      color: colors.subdued
    }
  });
}
