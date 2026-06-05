import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { GlassButton } from "@/components/GlassButton";
import { Logo } from "@/components/Logo";
import { Screen } from "@/components/Screen";
import { colors, radius } from "@/constants/theme";

const contact = {
  name: "Abhinav Prakash",
  institute: "IIIT Surat",
  phone: "8757674333",
  country: "India"
};

export default function ContactScreen() {
  async function callContact() {
    await Linking.openURL(`tel:${contact.phone}`);
  }

  async function shareContact() {
    await Share.share({
      title: "shoRDs Contact",
      message: `${contact.name}\n${contact.institute}\n${contact.phone}\n${contact.country}`
    });
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Pressable style={styles.iconButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" color={colors.text} size={21} />
          </Pressable>
          <Logo />
        </View>

        <View style={styles.hero}>
          <LinearGradient
            colors={["rgba(6,182,212,0.18)", "rgba(124,58,237,0.10)", "rgba(255,255,255,0.04)"]}
            style={StyleSheet.absoluteFill}
          />
          <Text style={styles.kicker}>Contact Us</Text>
          <Text style={styles.title}>Research should be easy to reach, read, and share.</Text>
          <Text style={styles.subtitle}>
            Connect with the shoRDs team for research uploads, mentoring workflows, and readable science.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.name}>{contact.name}</Text>
          <View style={styles.detailRow}>
            <Ionicons name="school-outline" color={colors.accentSoft} size={18} />
            <Text style={styles.detail}>{contact.institute}</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="call-outline" color={colors.accentSoft} size={18} />
            <Text style={styles.detail}>{contact.phone}</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="location-outline" color={colors.accentSoft} size={18} />
            <Text style={styles.detail}>{contact.country}</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <GlassButton title="Call" icon="call-outline" onPress={callContact} />
          <GlassButton title="Share Contact" icon="share-social-outline" variant="quiet" onPress={shareContact} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    paddingBottom: 110,
    gap: 18
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center"
  },
  hero: {
    minHeight: 230,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 22,
    justifyContent: "flex-end",
    overflow: "hidden",
    gap: 9
  },
  kicker: {
    color: colors.accentSoft,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  title: {
    color: colors.text,
    fontSize: 29,
    lineHeight: 36,
    fontWeight: "800"
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 23
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(21, 27, 47, 0.9)",
    padding: 18,
    gap: 14
  },
  name: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  detail: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "600"
  },
  actions: {
    gap: 12
  }
});
