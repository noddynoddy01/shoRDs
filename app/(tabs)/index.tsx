import { useEffect, useState } from "react";
import { Dimensions, FlatList, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Logo } from "@/components/Logo";
import { ResearchCard } from "@/components/ResearchCard";
import { Screen } from "@/components/Screen";
import { colors } from "@/constants/theme";
import { samplePapers } from "@/data/samplePapers";
import { fetchPapers } from "@/services/firebase";
import { Paper } from "@/types/models";

const { height } = Dimensions.get("window");

export default function HomeScreen() {
  const [papers, setPapers] = useState<Paper[]>(samplePapers);

  useEffect(() => {
    fetchPapers()
      .then((remotePapers) => {
        if (remotePapers.length > 0) setPapers(remotePapers);
      })
      .catch(() => setPapers(samplePapers));
  }, []);

  return (
    <Screen>
      <View style={styles.header}>
        <Logo />
        <View style={styles.livePill}>
          <LinearGradient
            colors={["rgba(6,182,212,0.35)", "rgba(124,58,237,0.2)"]}
            style={StyleSheet.absoluteFill}
          />
          <Text style={styles.subtitle}>Daily briefs</Text>
        </View>
      </View>
      <FlatList
        data={papers}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.cardFrame}>
            <ResearchCard paper={item} />
          </View>
        )}
        pagingEnabled
        snapToInterval={height - 132}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.feed}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  subtitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600"
  },
  livePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
    overflow: "hidden"
  },
  feed: {
    paddingBottom: 18
  },
  cardFrame: {
    minHeight: height - 132,
    paddingHorizontal: 18,
    paddingVertical: 10,
    justifyContent: "center"
  }
});
