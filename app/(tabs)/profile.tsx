import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Chip } from "@/components/Chip";
import { ProfileHeader } from "@/components/ProfileHeader";
import { ResearchCard } from "@/components/ResearchCard";
import { Screen } from "@/components/Screen";
import { colors, radius } from "@/constants/theme";
import { currentUser, samplePapers } from "@/data/samplePapers";
import { getSavedPaperIds } from "@/services/savedPapers";

export default function ProfileScreen() {
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const savedPapers = useMemo(
    () => samplePapers.filter((paper) => savedIds.includes(paper.id)),
    [savedIds]
  );
  const stats = [
    { label: "Papers Uploaded", value: "12" },
    { label: "Saved Papers", value: String(savedPapers.length) },
    { label: "Followers", value: "1.2k" }
  ];

  useFocusEffect(
    useCallback(() => {
      getSavedPaperIds().then(setSavedIds);
    }, [])
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ProfileHeader profile={currentUser} />

        <View style={styles.stats}>
          {stats.map((stat) => (
            <View key={stat.label} style={styles.stat}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Interests</Text>
          <View style={styles.chips}>
            {currentUser.interests.map((interest) => (
              <Chip key={interest} label={interest} selected />
            ))}
          </View>
        </View>

        <Pressable style={styles.contactCard} onPress={() => router.push("/contact" as never)}>
          <Text style={styles.contactTitle}>Contact shoRDs</Text>
          <Text style={styles.contactText}>Reach the team for paper uploads, mentoring, and collaboration.</Text>
        </Pressable>

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

const styles = StyleSheet.create({
  content: {
    padding: 18,
    paddingBottom: 96,
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
    fontSize: 20,
    fontWeight: "700"
  },
  statLabel: {
    color: colors.subdued,
    fontSize: 11,
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
    fontSize: 19,
    fontWeight: "700"
  },
  count: {
    color: colors.subdued,
    fontWeight: "600"
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
    fontSize: 17,
    fontWeight: "800"
  },
  contactText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20
  },
  empty: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21
  }
});
