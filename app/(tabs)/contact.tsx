import { Ionicons } from "@expo/vector-icons";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { colors as defaultColors, radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";

export default function ContactScreen() {
  const { colors, fontSizeScale } = useTheme();

  const handleEmailUs = () => {
    Linking.openURL("mailto:abhinavprakash0401@gmail.com?subject=shoRDs%20Research%20Platform%20Inquiry");
  };

  const handleOpenWebsite = () => {
    Linking.openURL("https://shords.app");
  };

  const styles = getStyles(colors, fontSizeScale);

  return (
    <Screen style={styles.container}>
      <PageHeader
        title="Contact & Support"
        subtitle="Open Science • AI Research Intelligence • Support & Feedback"
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Company Overview */}
        <View style={styles.heroCard}>
          <Text style={styles.heroPreTitle}>SHORDS RESEARCH PLATFORM</Text>
          <Text style={styles.heroTitle}>Pioneering Open Science & AI Research Intelligence</Text>
          <Text style={styles.heroDesc}>
            shoRDs is built to make scientific research accessible, structured, and instantly readable worldwide. We integrate federated search across arXiv, Europe PMC, CORE, OpenAlex, DOAJ, and open repositories.
          </Text>
        </View>

        {/* Support & Feature Requests */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionHeaderTitle}>Official Channels & Support</Text>
          
          <Pressable style={styles.channelRow} onPress={handleEmailUs}>
            <Ionicons name="mail-outline" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.channelTitle}>Official Support Email</Text>
              <Text style={styles.channelDetail}>abhinavprakash0401@gmail.com</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>

          <Pressable style={styles.channelRow} onPress={handleOpenWebsite}>
            <Ionicons name="globe-outline" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.channelTitle}>Official Platform Website</Text>
              <Text style={styles.channelDetail}>https://shords.app</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>

          <Pressable
            style={styles.channelRow}
            onPress={() => Alert.alert("Research Collaboration", "Interested in integrating your institution's repository? Reach out via email: abhinavprakash0401@gmail.com")}
          >
            <Ionicons name="flask-outline" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.channelTitle}>Research Collaboration</Text>
              <Text style={styles.channelDetail}>Repository Ingestion & Institutional Access</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        </View>

        {/* User Feedback & Bug Reporting */}
        <View style={styles.actionSection}>
          <Pressable style={styles.primaryActionBtn} onPress={handleEmailUs}>
            <Ionicons name="mail" size={18} color="#FFF" />
            <Text style={styles.primaryActionText}>Email Us Directly</Text>
          </Pressable>

          <View style={styles.actionRow}>
            <Pressable
              style={styles.secondaryActionBtn}
              onPress={() => Alert.alert("Submit Feedback", "Send your feedback directly to abhinavprakash0401@gmail.com")}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.text} />
              <Text style={styles.secondaryActionText}>Submit Feedback</Text>
            </Pressable>

            <Pressable
              style={styles.secondaryActionBtn}
              onPress={() => Alert.alert("Report a Bug", "Found an issue? Report it via email with paper ID/DOI to support@shords.app")}
            >
              <Ionicons name="bug-outline" size={16} color={colors.warning} />
              <Text style={styles.secondaryActionText}>Report Bug</Text>
            </Pressable>

            <Pressable
              style={styles.secondaryActionBtn}
              onPress={() => Alert.alert("Request Feature", "Have an idea for shoRDs? Request a feature via email.")}
            >
              <Ionicons name="bulb-outline" size={16} color={colors.primary} />
              <Text style={styles.secondaryActionText}>Request Feature</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.copyrightText}>
          © 2026 shoRDs Research Intelligence Platform. All rights reserved.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function getStyles(colors: any, scale: number) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: 80
    },
    heroCard: {
      backgroundColor: colors.surface,
      padding: spacing.lg,
      borderRadius: radius.md,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderLeftWidth: 4,
      borderLeftColor: colors.primary
    },
    heroPreTitle: {
      fontSize: 11 * scale,
      fontWeight: "800",
      color: colors.primary,
      letterSpacing: 1,
      marginBottom: 4
    },
    heroTitle: {
      fontSize: 20 * scale,
      fontWeight: "800",
      color: colors.text,
      marginBottom: spacing.xs,
      lineHeight: 26
    },
    heroDesc: {
      fontSize: 13 * scale,
      color: colors.subdued,
      lineHeight: 20
    },
    sectionCard: {
      backgroundColor: colors.surface,
      padding: spacing.md,
      borderRadius: radius.md,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: colors.border
    },
    sectionHeaderTitle: {
      fontSize: 14 * scale,
      fontWeight: "700",
      color: colors.text,
      marginBottom: spacing.md
    },
    channelRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border + "40",
      gap: spacing.sm
    },
    channelTitle: {
      fontSize: 13 * scale,
      fontWeight: "700",
      color: colors.text
    },
    channelDetail: {
      fontSize: 12 * scale,
      color: colors.muted,
      marginTop: 2
    },
    actionSection: {
      gap: spacing.sm,
      marginTop: spacing.xs
    },
    primaryActionBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      gap: spacing.xs
    },
    primaryActionText: {
      color: "#FFF",
      fontWeight: "700",
      fontSize: 14 * scale
    },
    actionRow: {
      flexDirection: "row",
      gap: spacing.xs
    },
    secondaryActionBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 4
    },
    secondaryActionText: {
      fontSize: 11 * scale,
      color: colors.text,
      fontWeight: "600"
    },
    copyrightText: {
      textAlign: "center",
      fontSize: 11 * scale,
      color: colors.muted,
      marginTop: spacing.xl
    }
  });
}
