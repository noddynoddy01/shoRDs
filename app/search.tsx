import React, { useCallback, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { Screen } from "@/components/Screen";
import { ResearchCard } from "@/components/ResearchCard";
import { useTheme } from "@/context/ThemeContext";
import { colors as defaultColors, radius } from "@/constants/theme";
import { getAllPapers } from "@/services/papersStore";
import { getAllMentors } from "@/services/mentorsStore";
import { Paper, Mentor } from "@/types/models";
import { GlassButton } from "@/components/GlassButton";

type SearchCategory = "all" | "papers" | "mentors";

export default function UniversalSearchScreen() {
  const { colors, fontSizeScale } = useTheme();
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<SearchCategory>("all");
  
  const [papers, setPapers] = useState<Paper[]>([]);
  const [mentors, setMentors] = useState<Mentor[]>([]);

  useFocusEffect(
    useCallback(() => {
      getAllPapers().then(setPapers);
      getAllMentors().then(setMentors);
    }, [])
  );

  const styles = getStyles(colors, fontSizeScale);

  // Search calculations
  const normalizedQuery = query.toLowerCase().trim();
  
  const filteredPapers = normalizedQuery
    ? papers.filter((p) =>
        [p.title, p.summary, p.domain, p.tags.join(" "), p.authorName]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : [];

  const filteredMentors = normalizedQuery
    ? mentors.filter((m) =>
        [m.name, m.focus, m.bio, m.affiliation]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : [];

  const totalResults = filteredPapers.length + filteredMentors.length;

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.subdued} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search papers, authors, mentors, domains..."
            placeholderTextColor={colors.subdued}
            style={styles.input}
            autoFocus
            clearButtonMode="while-editing"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={16} color={colors.subdued} />
            </Pressable>
          )}
        </View>
      </View>

      {query.length > 0 ? (
        <View style={{ flex: 1 }}>
          {/* Categories Selector */}
          <View style={styles.tabs}>
            <Pressable
              onPress={() => setActiveCategory("all")}
              style={[styles.tab, activeCategory === "all" && styles.tabActive]}
            >
              <Text style={[styles.tabText, activeCategory === "all" && styles.tabTextActive]}>
                All ({totalResults})
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveCategory("papers")}
              style={[styles.tab, activeCategory === "papers" && styles.tabActive]}
            >
              <Text style={[styles.tabText, activeCategory === "papers" && styles.tabTextActive]}>
                Papers ({filteredPapers.length})
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveCategory("mentors")}
              style={[styles.tab, activeCategory === "mentors" && styles.tabActive]}
            >
              <Text style={[styles.tabText, activeCategory === "mentors" && styles.tabTextActive]}>
                Mentors ({filteredMentors.length})
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.resultsScroll} showsVerticalScrollIndicator={false}>
            {/* Papers Section */}
            {(activeCategory === "all" || activeCategory === "papers") && filteredPapers.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>📄 Research Briefs</Text>
                <View style={styles.list}>
                  {filteredPapers.map((paper) => (
                    <ResearchCard key={paper.id} paper={paper} compact />
                  ))}
                </View>
              </View>
            )}

            {/* Mentors Section */}
            {(activeCategory === "all" || activeCategory === "mentors") && filteredMentors.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>🎓 Mentors & Scholars</Text>
                <View style={styles.list}>
                  {filteredMentors.map((mentor) => (
                    <View key={mentor.id} style={styles.mentorCard}>
                      <View style={styles.mentorAvatar}>
                        <Ionicons name="person" size={20} color={colors.accentSoft} />
                      </View>
                      <View style={styles.mentorInfo}>
                        <Text style={styles.mentorName}>{mentor.name}</Text>
                        <Text style={styles.mentorTitle}>{mentor.title} · {mentor.affiliation}</Text>
                        <Text style={styles.mentorFocus}>{mentor.focus}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {totalResults === 0 && (
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={48} color={colors.subdued} />
                <Text style={styles.emptyTitle}>No results found</Text>
                <Text style={styles.emptySubtitle}>
                  We couldn't find matches for "{query}". Try checking the spelling or using broader keywords.
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.guideScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.guide}>
            <Ionicons name="search-outline" size={48} color={colors.accentSoft} />
            <Text style={styles.guideTitle}>Universal shoRDs Search</Text>
            <Text style={styles.guideSubtitle}>
              Search for scientific papers, researchers, academic mentors, tags, or domains across the entire platform.
            </Text>

            <View style={styles.quickTagsSection}>
              <Text style={styles.quickTitle}>Popular Domains</Text>
              <View style={styles.quickGrid}>
                {["AI / ML", "Quantum Computing", "Robotics", "Renewable Energy", "Climate Tech"].map((tag) => (
                  <Pressable
                    key={tag}
                    style={styles.quickTag}
                    onPress={() => setQuery(tag)}
                  >
                    <Text style={styles.quickTagText}>{tag}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    header: {
      flexDirection: "row",
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 14,
      alignItems: "center",
      gap: 10
    },
    backButton: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    searchBar: {
      flex: 1,
      flexDirection: "row",
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      alignItems: "center",
      gap: 8
    },
    input: {
      flex: 1,
      color: colors.text,
      fontSize: 15 * scale,
      height: "100%"
    },
    tabs: {
      flexDirection: "row",
      paddingHorizontal: 16,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 8
    },
    tab: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: "transparent",
      backgroundColor: colors.card
    },
    tabActive: {
      borderColor: colors.accentSoft,
      backgroundColor: "rgba(6, 182, 212, 0.08)"
    },
    tabText: {
      color: colors.subdued,
      fontSize: 12 * scale,
      fontWeight: "700"
    },
    tabTextActive: {
      color: colors.accentSoft
    },
    resultsScroll: {
      padding: 16,
      gap: 20
    },
    section: {
      gap: 12
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 16 * scale,
      fontWeight: "800",
      letterSpacing: 0.5
    },
    list: {
      gap: 12
    },
    mentorCard: {
      flexDirection: "row",
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      gap: 12,
      alignItems: "flex-start"
    },
    mentorAvatar: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: colors.cardElevated,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    mentorInfo: {
      flex: 1,
      gap: 2
    },
    mentorName: {
      color: colors.text,
      fontSize: 16 * scale,
      fontWeight: "800"
    },
    mentorTitle: {
      color: colors.accentSoft,
      fontSize: 11 * scale,
      fontWeight: "700"
    },
    mentorFocus: {
      color: colors.muted,
      fontSize: 13 * scale,
      lineHeight: 18,
      marginTop: 2
    },
    empty: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 44,
      gap: 10
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 18 * scale,
      fontWeight: "800"
    },
    emptySubtitle: {
      color: colors.muted,
      fontSize: 13 * scale,
      lineHeight: 20,
      textAlign: "center",
      paddingHorizontal: 22
    },
    guideScroll: {
      flexGrow: 1,
      justifyContent: "center",
      padding: 22
    },
    guide: {
      alignItems: "center",
      gap: 12
    },
    guideTitle: {
      color: colors.text,
      fontSize: 22 * scale,
      fontWeight: "800",
      textAlign: "center"
    },
    guideSubtitle: {
      color: colors.muted,
      fontSize: 14 * scale,
      lineHeight: 22,
      textAlign: "center",
      paddingHorizontal: 12
    },
    quickTagsSection: {
      marginTop: 32,
      alignSelf: "stretch",
      gap: 12
    },
    quickTitle: {
      color: colors.subdued,
      fontSize: 12 * scale,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 1,
      textAlign: "center"
    },
    quickGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: 8
    },
    quickTag: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingVertical: 8,
      paddingHorizontal: 14
    },
    quickTagText: {
      color: colors.muted,
      fontSize: 13 * scale,
      fontWeight: "600"
    }
  });
}
