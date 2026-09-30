import { useFocusEffect, useLocalSearchParams, router } from "expo-router";
import { useCallback, useState, useRef, useEffect, useMemo } from "react";
import {
  Animated,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewToken,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Logo } from "@/components/Logo";
import { ReelCard } from "@/components/ReelCard";
import { DesktopNavSidebar } from "@/components/DesktopNavSidebar";
import { DesktopPaperCard } from "@/components/DesktopPaperCard";
import { DesktopIntelligencePanel } from "@/components/DesktopIntelligencePanel";
import { Screen } from "@/components/Screen";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useFeedMetrics } from "@/hooks/useFeedMetrics";
import { getPapersAsync, fetchNextDiscoveryPageAsync } from "@/services/papersStore";
import { ExpressiveAudioEngine } from "@/services/audioService";
import { Paper } from "@/types/models";
import { useTheme } from "@/context/ThemeContext";
import { SettingsTray } from "@/components/SettingsTray";
import { SubscriptionModal } from "@/components/SubscriptionModal";
import { getUserSubscriptionAsync, UserSubscription } from "@/services/subscriptionService";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FloatingChatButton } from "@/components/FloatingChatButton";
import { domainSubtopics, domains } from "@/data/samplePapers";

export default function HomeScreen() {
  const { colors, fontSizeScale, theme, setTheme } = useTheme();
  const { filterDomain, selectedSubdomain: initialSubdomain } = useLocalSearchParams<{ filterDomain?: string; selectedSubdomain?: string }>();
  
  const [papers, setPapers] = useState<Paper[]>([]);
  const [isLoadingFeed, setIsLoadingFeed] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedSubdomain, setSelectedSubdomain] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [subscriptionVisible, setSubscriptionVisible] = useState(false);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [userProfile, setUserProfile] = useState<{ name: string; email: string; role?: string } | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  // Multi-Selection Checkbox state in Feed
  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>([]);
  const [selectedDesktopPaper, setSelectedDesktopPaper] = useState<Paper | null>(null);

  const { width: windowWidth } = useWindowDimensions();
  const isDesktop = windowWidth >= 1024;

  const { reelHeight } = useFeedMetrics();
  const styles = getStyles(colors, fontSizeScale);

  useEffect(() => {
    setSelectedSubdomain(initialSubdomain || null);
  }, [filterDomain, initialSubdomain]);

  // Load initial feed
  const loadInitialFeed = useCallback(async () => {
    setIsLoadingFeed(true);
    try {
      const list = await getPapersAsync(filterDomain as any);
      setPapers(list);
      if (list.length > 0) {
        setSelectedDesktopPaper(list[0]);
      }
    } catch {
      setPapers([]);
    } finally {
      setIsLoadingFeed(false);
    }
  }, [filterDomain]);

  // Pull-to-refresh & Refresh button -> fetch next page endlessly!
  const handleRefreshFeed = async () => {
    setIsRefreshing(true);
    try {
      const freshList = await fetchNextDiscoveryPageAsync(filterDomain as any);
      setPapers(freshList);
    } catch (err) {
      console.error("Refresh feed error:", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Infinite Scroll: Load next batch of papers
  const loadNextFeedPage = async () => {
    if (!isLoadingMore && !isLoadingFeed && !isRefreshing) {
      setIsLoadingMore(true);
      try {
        const freshList = await fetchNextDiscoveryPageAsync(filterDomain as any);
        setPapers(freshList);
      } catch (err) {
        console.error("Error loading next feed page:", err);
      } finally {
        setIsLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    loadInitialFeed();
    AsyncStorage.getItem("shords.currentUser").then((val) => {
      if (val) setUserProfile(JSON.parse(val));
    });
    ExpressiveAudioEngine.initMuteStateAsync().then(muted => setIsMuted(muted));
  }, [loadInitialFeed]);

  const toggleMute = async () => {
    const nextMuted = await ExpressiveAudioEngine.toggleMuteAsync();
    setIsMuted(nextMuted);
  };

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems[0]?.index != null) setActiveIndex(viewableItems[0].index);
    },
    []
  );

  const toggleCardSelection = (id: string) => {
    setSelectedPaperIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  if (isDesktop) {
    return (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.background, height: "100%" }}>
        {/* Column 1: Left Navigation Sidebar */}
        <DesktopNavSidebar
          currentDomain={filterDomain}
          onSelectDomain={(d) => router.push(d ? { pathname: "/(tabs)", params: { filterDomain: d } } as never : "/(tabs)" as never)}
          onRefreshFeed={handleRefreshFeed}
          onOpenSettings={() => setSettingsVisible(true)}
          onOpenSubscription={() => setSubscriptionVisible(true)}
          isMuted={isMuted}
          onToggleMute={toggleMute}
          userProfile={userProfile}
        />

        {/* Column 2: Center Research Feed */}
        <View style={{ flex: 1, height: "100%", borderRightWidth: 1, borderColor: colors.border }}>
          {/* Top Bar for Desktop Feed */}
          <View style={styles.desktopFeedHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.desktopFeedTitle}>
                {filterDomain ? filterDomain.toUpperCase() : "GLOBAL RESEARCH DISCOVERIES"}
              </Text>
              <Text style={styles.desktopFeedSubtitle}>
                Live open-access research stream with evidence-grounded intelligence
              </Text>
            </View>
            <Pressable style={styles.desktopSearchBtn} onPress={() => router.push("/search" as never)}>
              <Ionicons name="search" size={16} color={colors.primary} />
              <Text style={styles.desktopSearchBtnText}>Search Papers...</Text>
            </Pressable>
          </View>

          {isLoadingFeed ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Fetching Live Open-Access Research Stream...</Text>
            </View>
          ) : papers.length === 0 ? (
            <View style={styles.centerBox}>
              <Ionicons name="wifi-outline" size={36} color={colors.subdued} />
              <Text style={styles.emptyTitle}>No Papers Found</Text>
              <Text style={styles.emptySub}>Connect to internet to fetch live open-access research papers.</Text>
            </View>
          ) : (
            <FlatList
              data={papers}
              keyExtractor={(item, index) => `${item.id}-${index}`}
              showsVerticalScrollIndicator={true}
              contentContainerStyle={{ padding: spacing.lg }}
              onEndReached={loadNextFeedPage}
              onEndReachedThreshold={0.5}
              renderItem={({ item, index }) => (
                <DesktopPaperCard
                  paper={item}
                  isSelectedForIntelligence={selectedDesktopPaper?.id === item.id || (!selectedDesktopPaper && index === 0)}
                  onSelectForIntelligence={() => setSelectedDesktopPaper(item)}
                  isChecked={selectedPaperIds.includes(item.id)}
                  onToggleCheck={() => toggleCardSelection(item.id)}
                />
              )}
            />
          )}
        </View>

        {/* Column 3: Right Structured Intelligence Panel */}
        <View style={{ width: 440, height: "100%" }}>
          <DesktopIntelligencePanel paper={selectedDesktopPaper || papers[0] || null} />
        </View>

        {/* Settings & Subscription Modals */}
        <SettingsTray visible={settingsVisible} onClose={() => setSettingsVisible(false)} currentUserProfile={userProfile} />
        <SubscriptionModal visible={subscriptionVisible} onClose={() => setSubscriptionVisible(false)} />
      </View>
    );
  }

  return (
    <Screen style={styles.screenContainer}>
      {/* 1. Header Bar */}
      <View style={styles.topBarContainer}>
        <View style={styles.topBarRow}>
          <Logo />

          <View style={styles.headerRightActions}>
            {/* Subscription Crown / Upgrade Badge */}
            <Pressable style={styles.subBadgeBtn} onPress={() => setSubscriptionVisible(true)}>
              <Ionicons name="star" size={14} color="#F59E0B" />
              <Text style={styles.subBadgeText}>
                {subscription?.plan === "pro" ? "PRO PASS" : "FREE • UPGRADE"}
              </Text>
            </Pressable>

            {/* Header Refresh Button */}
            <Pressable style={styles.iconBtn} onPress={handleRefreshFeed}>
              <Ionicons name="refresh-outline" size={18} color={colors.primary} />
            </Pressable>

            <Pressable style={styles.searchIconBtn} onPress={() => router.push("/search" as never)}>
              <Ionicons name="search" size={18} color={colors.primary} />
            </Pressable>

            <Pressable style={styles.iconBtn} onPress={toggleMute}>
              <Ionicons name={isMuted ? "volume-mute" : "volume-high"} size={18} color={colors.text} />
            </Pressable>

            <Pressable style={styles.profileBadgeBtn} onPress={() => setSettingsVisible(true)}>
              <LinearGradient
                colors={["#06B6D4", "#8B5CF6"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.profileGradient}
              >
                <Text style={styles.profileInitials}>
                  {userProfile?.name ? userProfile.name.slice(0, 2).toUpperCase() : "AP"}
                </Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>

        {/* Categories Bar */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryScroll}>
          <Pressable
            style={[styles.categoryPill, !filterDomain && styles.categoryPillActive]}
            onPress={() => router.push("/(tabs)" as never)}
          >
            <Text style={[styles.categoryPillText, !filterDomain && styles.categoryPillTextActive]}>ALL DISCOVERIES</Text>
          </Pressable>

          {domains.map((d) => {
            const isActive = filterDomain === d;
            return (
              <Pressable
                key={d}
                style={[styles.categoryPill, isActive && styles.categoryPillActive]}
                onPress={() => router.push({ pathname: "/(tabs)", params: { filterDomain: d } } as never)}
              >
                <Text style={[styles.categoryPillText, isActive && styles.categoryPillTextActive]}>{d.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* 2. Main Live Infinite Reel Feed */}
      {isLoadingFeed ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Fetching Live Open-Access Research Stream...</Text>
        </View>
      ) : papers.length === 0 ? (
        <View style={styles.centerBox}>
          <Ionicons name="wifi-outline" size={36} color={colors.subdued} />
          <Text style={styles.emptyTitle}>Offline Mode</Text>
          <Text style={styles.emptySub}>Connect to internet to fetch live open-access research papers.</Text>
        </View>
      ) : (
        <FlatList
          data={papers}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          pagingEnabled
          decelerationRate="fast"
          snapToInterval={reelHeight}
          snapToAlignment="start"
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 75 }}
          onEndReached={loadNextFeedPage}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefreshFeed}
              tintColor={colors.primary}
            />
          }
          ListFooterComponent={
            isLoadingMore ? (
              <View style={[styles.footerLoader, { height: reelHeight / 2 }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.footerLoaderText}>Fetching next discovery page from OpenAlex...</Text>
              </View>
            ) : null
          }
          renderItem={({ item, index }) => (
            <ReelCard
              paper={item}
              height={reelHeight}
              index={index}
              isActive={index === activeIndex}
              isMuted={isMuted}
              onMuteToggle={toggleMute}
              isSelected={selectedPaperIds.includes(item.id)}
              onToggleSelect={() => toggleCardSelection(item.id)}
            />
          )}
        />
      )}

      {/* Settings Tray & Floating Chat */}
      <SettingsTray visible={settingsVisible} onClose={() => setSettingsVisible(false)} currentUserProfile={userProfile} />
      <SubscriptionModal visible={subscriptionVisible} onClose={() => setSubscriptionVisible(false)} />
      <FloatingChatButton />
    </Screen>
  );
}

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    desktopFeedHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card
    },
    desktopFeedTitle: {
      color: colors.text,
      fontSize: 15 * scale,
      fontWeight: "800",
      letterSpacing: 0.5
    },
    desktopFeedSubtitle: {
      color: colors.subdued,
      fontSize: 11 * scale,
      marginTop: 2
    },
    desktopSearchBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.background,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border
    },
    desktopSearchBtnText: {
      color: colors.subdued,
      fontSize: 12 * scale,
      fontWeight: "500"
    },
    screenContainer: {
      flex: 1,
      backgroundColor: colors.background
    },
    topBarContainer: {
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderColor: colors.border
    },
    topBarRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      paddingBottom: spacing.xs
    },
    logoText: {
      fontSize: 20 * scale,
      fontWeight: "900",
      letterSpacing: -0.5
    },
    headerRightActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10
    },
    subBadgeBtn: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "#F59E0B15",
      borderWidth: 1,
      borderColor: "#F59E0B40",
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
      gap: 4
    },
    subBadgeText: {
      fontSize: 9 * scale,
      fontWeight: "900",
      color: "#F59E0B",
      letterSpacing: 0.5
    },
    searchIconBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.primary + "1A",
      borderWidth: 1,
      borderColor: colors.primary + "3D",
      alignItems: "center",
      justifyContent: "center"
    },
    iconBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    profileBadgeBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      overflow: "hidden"
    },
    profileGradient: {
      width: "100%",
      height: "100%",
      alignItems: "center",
      justifyContent: "center"
    },
    profileInitials: {
      fontSize: 11 * scale,
      fontWeight: "900",
      color: "#FFFFFF"
    },
    categoryScroll: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xs,
      gap: 8
    },
    categoryPill: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: radius.pill,
      backgroundColor: "rgba(255, 255, 255, 0.02)",
      borderWidth: 1,
      borderColor: colors.border
    },
    categoryPillActive: {
      backgroundColor: colors.primary + "1A",
      borderColor: colors.primary + "3D"
    },
    categoryPillText: {
      fontSize: 9 * scale,
      fontWeight: "800",
      color: colors.subdued,
      letterSpacing: 0.8
    },
    categoryPillTextActive: {
      color: colors.primary
    },
    centerBox: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.xl,
      gap: 12
    },
    loadingText: {
      fontSize: 12 * scale,
      color: colors.subdued,
      fontWeight: "700"
    },
    emptyTitle: {
      fontSize: 16 * scale,
      fontWeight: "800",
      color: colors.text
    },
    emptySub: {
      fontSize: 12 * scale,
      color: colors.subdued,
      textAlign: "center"
    },
    footerLoader: {
      justifyContent: "center",
      alignItems: "center",
      gap: 8
    },
    footerLoaderText: {
      fontSize: 11 * scale,
      color: colors.subdued,
      fontWeight: "700"
    }
  });
}
