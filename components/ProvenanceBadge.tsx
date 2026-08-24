import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radius, spacing } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";

type ProvenanceBadgeProps = {
  format: "FULL_TEXT_PDF" | "JATS_XML" | "HTML_PARSED" | "ABSTRACT_ONLY" | "METADATA_ONLY";
  providerName?: string;
};

export function ProvenanceBadge({ format, providerName = "OpenAlex" }: ProvenanceBadgeProps) {
  const { colors, fontSizeScale } = useTheme();

  const getBadgeConfig = () => {
    switch (format) {
      case "FULL_TEXT_PDF":
        return {
          icon: "document-text-outline",
          label: `Source: Full Text PDF (${providerName})`,
          bgColor: "#10B98115",
          borderColor: "#10B98140",
          textColor: "#10B981"
        };
      case "JATS_XML":
        return {
          icon: "code-working-outline",
          label: `Source: JATS XML (${providerName})`,
          bgColor: "#06B6D415",
          borderColor: "#06B6D440",
          textColor: "#06B6D4"
        };
      case "HTML_PARSED":
        return {
          icon: "globe-outline",
          label: `Source: HTML Article (${providerName})`,
          bgColor: "#8B5CF615",
          borderColor: "#8B5CF640",
          textColor: "#8B5CF6"
        };
      case "ABSTRACT_ONLY":
        return {
          icon: "alert-circle-outline",
          label: `Source: Abstract Only (Zero-Hallucination)`,
          bgColor: "#F59E0B15",
          borderColor: "#F59E0B40",
          textColor: "#F59E0B"
        };
      default:
        return {
          icon: "information-circle-outline",
          label: `Source: Metadata Record (${providerName})`,
          bgColor: colors.primary + "15",
          borderColor: colors.primary + "40",
          textColor: colors.primary
        };
    }
  };

  const config = getBadgeConfig();
  const styles = getStyles(config, scaleHelper(fontSizeScale));

  return (
    <View style={styles.badgeContainer}>
      <Ionicons name={config.icon as any} size={12} color={config.textColor} />
      <Text style={styles.badgeText}>{config.label}</Text>
    </View>
  );
}

function scaleHelper(scale: number) {
  return scale || 1;
}

function getStyles(config: any, scale: number) {
  return StyleSheet.create({
    badgeContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: config.bgColor,
      paddingHorizontal: spacing.xs + 4,
      paddingVertical: 3,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: config.borderColor,
      alignSelf: "flex-start",
      marginVertical: spacing.xs,
      gap: 4
    },
    badgeText: {
      fontSize: 10 * scale,
      fontWeight: "800",
      color: config.textColor
    }
  });
}
