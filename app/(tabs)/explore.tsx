import { useState, useEffect } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ActivityIndicator
} from "react-native";
import { router } from "expo-router";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { ResearchCard } from "@/components/ResearchCard";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import { RESEARCH_DOMAINS, FEED_CATEGORIES, FeedCategory } from "@/constants/domains";
import { executeLiveFederatedSearch, FederatedPaper } from "@/services/federatedSearch";
import { cacheDynamicPaper } from "@/services/papersStore";
import { Ionicons } from "@expo/vector-icons";

export default function ExploreScreen() {
  const { colors, fontSizeScale } = useTheme();
  
  const [selectedDomain, setSelectedDomain] = useState<string>("ai");
  const [selectedFeed, setSelectedFeed] = useState<FeedCategory>("popular");
  
  const [papers, setPapers] = useState<FederatedPaper[]>([]);
  const [page, setPage] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);

  const activeDomainObj = RESEARCH_DOMAINS.find(d => d.id === selectedDomain) || RESEARCH_DOMAINS[0];

  const loadDomainFeed = async (domainId: string, feed: FeedCategory, pageNum: number, append: boolean = false) => {
    if (pageNum === 1) setIsLoading(true);
    else setIsLoadingMore(true);

    const domainName = RESEARCH_DOMAINS.find(d => d.id === domainId)?.name || "Research";
    let sortOption: "relevance" | "recency" | "citations" = "relevance";
    let oaOnly = false;

    if (feed === "latest") sortOption = "recency";
    else if (feed === "most_cited" || feed === "popular") sortOption = "citations";
    else if (feed === "open_access") oaOnly = true;

    const queryTerm = `${domainName} ${feed === "review_papers" ? "review" : feed === "survey_papers" ? "survey" : ""}`.trim();

    try {
      const res = await executeLiveFederatedSearch(queryTerm, pageNum, {
        sortBy: sortOption,
        openAccessOnly: oaOnly
      });

      const newItems = res.papers;
      newItems.forEach(p => cacheDynamicPaper(p as any));

      if (append) {
        setPapers(prev => [...prev, ...newItems]);
      } else {
        setPapers(newItems);
      }

      if (newItems.length === 0) setHasMore(false);
      else setHasMore(true);
    } catch (err) {
      console.warn("Domain feed error:", err);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    setPage(1);
    loadDomainFeed(selectedDomain, selectedFeed, 1, false);
  }, [selectedDomain, selectedFeed]);

  const handleEndReached = () => {
    if (!isLoadingMore && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      loadDomainFeed(selectedDomain, selectedFeed, nextPage, true);
    }
  };

  const styles = getStyles(colors, fontSizeScale);

  return (
    <Screen style={styles.container}>
      <PageHeader
        title="Explore Research Domains"
        subtitle="30+ Dedicated Domain Feeds • Live Internet Aggregation"
      />

      {/* 30+ Domain Selector Carousel */}
      <View style={styles.carouselContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.domainScroll}
        >
          {RESEARCH_DOMAINS.map(d => {
            const isSelected = d.id === selectedDomain;
            return (
              <Pressable
                key={d.id}
                style={[styles.domainChip, isSelected && styles.domainChipActive]}
                onPress={() => setSelectedDomain(d.id)}
              >
                <Ionicons
                  name={d.icon as any}
                  size={16}
                  color={isSelected ? colors.text : colors.muted}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.domainChipText, isSelected && styles.domainChipTextActive]}>
                  {d.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Feed Sub-Categories Bar */}
      <View style={styles.feedCategoryContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.feedScroll}>
          {FEED_CATEGORIES.map(cat => {
            const isSelected = cat.id === selectedFeed;
            return (
              <Pressable
                key={cat.id}
                style={[styles.feedTab, isSelected && styles.feedTabActive]}
                onPress={() => setSelectedFeed(cat.id)}
              >
                <Text style={[styles.feedTabText, isSelected && styles.feedTabTextActive]}>
                  {cat.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Domain Header Info */}
      <View style={styles.domainBanner}>
        <Text style={styles.domainBannerTitle}>{activeDomainObj.name}</Text>
        <Text style={styles.domainBannerDesc}>{activeDomainObj.description}</Text>
      </View>

      {/* Infinite Paper Feed List */}
      {isLoading ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Fetching live feed for {activeDomainObj.name}...</Text>
        </View>
      ) : (
        <FlatList
          data={papers}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/paper/${encodeURIComponent(item.id)}`)}>
              <ResearchCard paper={item as any} />
            </Pressable>
          )}
          contentContainerStyle={styles.listContent}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isLoadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.footerText}>Loading next 20 papers...</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No papers found for this feed. Try changing filters.</Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

function getStyles(colors: any, scale: number) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background
    },
    carouselContainer: {
      paddingVertical: spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: colors.border
    },
    domainScroll: {
      paddingHorizontal: spacing.md,
      gap: spacing.xs
    },
    domainChip: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border
    },
    domainChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary
    },
    domainChipText: {
      fontSize: 13 * scale,
      color: colors.muted,
      fontWeight: "500"
    },
    domainChipTextActive: {
      color: "#FFFFFF",
      fontWeight: "700"
    },
    feedCategoryContainer: {
      paddingVertical: spacing.xs,
      backgroundColor: colors.surface
    },
    feedScroll: {
      paddingHorizontal: spacing.md,
      gap: spacing.sm
    },
    feedTab: {
      paddingHorizontal: spacing.sm + 4,
      paddingVertical: spacing.xs,
      borderRadius: radius.sm
    },
    feedTabActive: {
      borderBottomWidth: 2,
      borderBottomColor: colors.primary
    },
    feedTabText: {
      fontSize: 12 * scale,
      color: colors.muted,
      fontWeight: "600"
    },
    feedTabTextActive: {
      color: colors.primary,
      fontWeight: "700"
    },
    domainBanner: {
      padding: spacing.md,
      backgroundColor: colors.surface,
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      borderRadius: radius.md,
      borderLeftWidth: 4,
      borderLeftColor: colors.primary
    },
    domainBannerTitle: {
      fontSize: 16 * scale,
      fontWeight: "700",
      color: colors.text
    },
    domainBannerDesc: {
      fontSize: 12 * scale,
      color: colors.muted,
      marginTop: 2
    },
    listContent: {
      padding: spacing.md,
      paddingBottom: 100
    },
    loaderContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center"
    },
    loadingText: {
      marginTop: spacing.sm,
      color: colors.muted,
      fontSize: 13 * scale
    },
    footerLoader: {
      paddingVertical: spacing.md,
      alignItems: "center"
    },
    footerText: {
      fontSize: 12 * scale,
      color: colors.muted,
      marginTop: 4
    },
    emptyContainer: {
      padding: spacing.xl,
      alignItems: "center"
    },
    emptyText: {
      color: colors.muted,
      fontSize: 14 * scale
    }
  });
}
