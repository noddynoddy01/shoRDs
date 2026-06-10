import { useFocusEffect } from "expo-router";
import { useCallback, useState, useRef, useEffect } from "react";
import { Animated, FlatList, Pressable, StyleSheet, Switch, Text, View, ViewToken } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Logo } from "@/components/Logo";
import { ReelCard } from "@/components/ReelCard";
import { Screen } from "@/components/Screen";
import { colors as defaultColors } from "@/constants/theme";
import { useFeedMetrics } from "@/hooks/useFeedMetrics";
import { getAllPapers } from "@/services/papersStore";
import { Paper } from "@/types/models";
import { useTheme } from "@/context/ThemeContext";
import { SettingsTray } from "@/components/SettingsTray";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FloatingChatButton } from "@/components/FloatingChatButton";
import * as Speech from "expo-speech";

export default function HomeScreen() {
  const { colors, fontSizeScale, theme, setTheme } = useTheme();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [userProfile, setUserProfile] = useState<{ name: string; email: string; role?: string } | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const bannerAnim = useRef(new Animated.Value(0)).current;

  const { reelHeight } = useFeedMetrics();
  const styles = getStyles(colors, fontSizeScale);

  const fetchSessionAndPapers = useCallback(() => {
    getAllPapers().then(setPapers);
    AsyncStorage.getItem("shords.currentUser").then((val) => {
      if (val) {
        setUserProfile(JSON.parse(val));
      } else {
        setUserProfile(null);
      }
    });
    AsyncStorage.getItem("shords.audioMuted").then((val) => {
      setIsMuted(val === "true");
    });
  }, []);

  // Animate banner in when light theme is active
  useEffect(() => {
    const shouldShow = theme === "light" && !bannerDismissed;
    Animated.timing(bannerAnim, {
      toValue: shouldShow ? 1 : 0,
      duration: 350,
      useNativeDriver: true
    }).start();
  }, [theme, bannerDismissed]);

  const toggleMute = async () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    await AsyncStorage.setItem("shords.audioMuted", String(nextMuted));
  };

  useFocusEffect(
    useCallback(() => {
      fetchSessionAndPapers();
      return () => {
        // Keep playing voice in background when navigating away
      };
    }, [fetchSessionAndPapers])
  );

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems[0]?.index != null) setActiveIndex(viewableItems[0].index);
    },
    []
  );

  const handleEnableDark = () => {
    setTheme("dark");
    setBannerDismissed(true);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Logo />
        <View style={styles.headerRight}>
          <View style={styles.livePill}>
            <LinearGradient
              colors={["rgba(6,182,212,0.22)", "rgba(124,58,237,0.1)"]}
              style={StyleSheet.absoluteFill}
            />
            <Text style={styles.subtitle}>
              {papers.length ? `${activeIndex + 1} / ${papers.length} briefs` : "Loading briefs"}
            </Text>
          </View>
          
          <Pressable style={styles.iconBtn} onPress={() => router.push("/search" as never)}>
            <Ionicons name="search" color={colors.text} size={20} />
          </Pressable>

          <Pressable style={styles.iconBtn} onPress={() => setSettingsVisible(true)}>
            <Ionicons name="settings-outline" color={colors.text} size={20} />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={papers}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <ReelCard
            paper={item}
            height={reelHeight}
            index={index}
            isActive={index === activeIndex}
            isMuted={isMuted}
            onMuteToggle={toggleMute}
            onDelete={fetchSessionAndPapers}
          />
        )}
        pagingEnabled
        snapToInterval={reelHeight}
        decelerationRate="fast"
        disableIntervalMomentum
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 72 }}
        getItemLayout={(_, index) => ({
          length: reelHeight,
          offset: reelHeight * index,
          index
        })}
      />

      <SettingsTray
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        currentUserProfile={userProfile}
        onProfileUpdate={fetchSessionAndPapers}
        onLogout={fetchSessionAndPapers}
      />
      <FloatingChatButton />

      {/* Dark Mode Recommendation Banner */}
      {!bannerDismissed && theme === "light" && (
        <Animated.View
          style={[
            styles.darkBanner,
            {
              opacity: bannerAnim,
              transform: [{
                translateY: bannerAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [60, 0]
                })
              }]
            }
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.darkBannerContent}>
            <View style={styles.darkBannerLeft}>
              <Text style={styles.darkBannerIcon}>🌙</Text>
              <View>
                <Text style={styles.darkBannerTitle}>Try Dark Mode</Text>
                <Text style={styles.darkBannerSub}>Easier on the eyes for reading</Text>
              </View>
            </View>
            <View style={styles.darkBannerRight}>
              <Switch
                value={false}
                onValueChange={handleEnableDark}
                trackColor={{ false: "#CBD5E1", true: "#7C3AED" }}
                thumbColor={"#FFFFFF"}
              />
              <Pressable
                style={styles.bannerDismiss}
                onPress={() => setBannerDismissed(true)}
              >
                <Text style={styles.bannerDismissText}>✕</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      )}
    </Screen>
  );
}

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    header: {
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between"
    },
    headerRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10
    },
    subtitle: {
      color: colors.text,
      fontSize: 11 * scale,
      fontWeight: "700"
    },
    livePill: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 7,
      overflow: "hidden"
    },
    iconBtn: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center"
    },
    darkBanner: {
      position: "absolute",
      bottom: 90,
      left: 16,
      right: 16,
      zIndex: 998,
      elevation: 9,
      borderRadius: 16,
      backgroundColor: "#1E1B4B",
      shadowColor: "#7C3AED",
      shadowOpacity: 0.35,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 4 },
      borderWidth: 1,
      borderColor: "rgba(124, 58, 237, 0.3)"
    },
    darkBannerContent: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12
    },
    darkBannerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      flex: 1
    },
    darkBannerIcon: {
      fontSize: 22
    },
    darkBannerTitle: {
      color: "#FFFFFF",
      fontSize: 14 * scale,
      fontWeight: "800"
    },
    darkBannerSub: {
      color: "rgba(255,255,255,0.6)",
      fontSize: 11 * scale,
      marginTop: 1
    },
    darkBannerRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10
    },
    bannerDismiss: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: "rgba(255,255,255,0.1)",
      alignItems: "center",
      justifyContent: "center"
    },
    bannerDismissText: {
      color: "rgba(255,255,255,0.7)",
      fontSize: 12,
      fontWeight: "800"
    }
  });
}
