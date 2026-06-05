import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { GlassButton } from "@/components/GlassButton";
import { PageHeader } from "@/components/PageHeader";
import { Screen } from "@/components/Screen";
import { colors, radius } from "@/constants/theme";
import { mentors } from "@/data/samplePapers";

export default function MentorsScreen() {
  async function connect(name: string, focus: string) {
    await Share.share({
      title: `Connect with ${name}`,
      message: `I would like to connect with ${name} through shoRDs for guidance in ${focus}.`
    });
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <PageHeader
          kicker="Mentors"
          title="Learn with researchers who can guide your next paper"
          subtitle="Connect for paper framing, readable summaries, experiments, and publication direction."
        />

        <View style={styles.cards}>
          {mentors.map((mentor) => (
            <View key={mentor.id} style={styles.card}>
              <View style={styles.avatar}>
                <Ionicons name="person" color={colors.accentSoft} size={24} />
              </View>
              <Text style={styles.name}>{mentor.name}</Text>
              <Text style={styles.title}>{mentor.title}</Text>
              <Text style={styles.focus}>{mentor.focus}</Text>
              <Text style={styles.bio}>{mentor.bio}</Text>
              <View style={styles.meta}>
                <Ionicons name="time-outline" color={colors.subdued} size={15} />
                <Text style={styles.availability}>{mentor.availability}</Text>
              </View>
              <GlassButton
                title="Connect"
                icon="chatbubble-ellipses-outline"
                onPress={() => connect(mentor.name, mentor.focus)}
              />
            </View>
          ))}
        </View>

        <View style={styles.contactPanel}>
          <Text style={styles.contactTitle}>Need the shoRDs team?</Text>
          <Text style={styles.contactText}>Reach out for mentor onboarding or research upload support.</Text>
          <GlassButton
            title="Open Contact Page"
            icon="call-outline"
            variant="quiet"
            onPress={() => router.push("/contact" as never)}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    paddingBottom: 112,
    gap: 18
  },
  cards: {
    gap: 14
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(21, 27, 47, 0.88)",
    padding: 18,
    gap: 10,
    shadowColor: colors.accent,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 }
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(103, 232, 249, 0.26)",
    backgroundColor: "rgba(6, 182, 212, 0.12)",
    alignItems: "center",
    justifyContent: "center"
  },
  name: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  title: {
    color: colors.accentSoft,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  focus: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700"
  },
  bio: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21
  },
  meta: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center"
  },
  availability: {
    color: colors.subdued,
    fontSize: 12,
    fontWeight: "600",
    flex: 1
  },
  contactPanel: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(6, 182, 212, 0.08)",
    padding: 18,
    gap: 10
  },
  contactTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  contactText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21
  }
});
