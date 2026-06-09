import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, ViewToken } from "react-native";
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

export default function HomeScreen() {
  const { colors, fontSizeScale } = useTheme();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [userProfile, setUserProfile] = useState<{ name: string; email: string; role?: string } | null>(null);
  
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
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchSessionAndPapers();
    }, [fetchSessionAndPapers])
  );

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems[0]?.index != null) setActiveIndex(viewableItems[0].index);
    },
    []
  );

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
    }
  });
}
