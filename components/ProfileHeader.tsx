import { Ionicons } from "@expo/vector-icons";
import { Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../context/ThemeContext";
import { colors as defaultColors, radius } from "../constants/theme";
import { UserProfile } from "@/types/models";

type ProfileHeaderProps = {
  profile: UserProfile;
};

export function ProfileHeader({ profile }: ProfileHeaderProps) {
  const { colors, fontSizeScale } = useTheme();
  const styles = getStyles(colors, fontSizeScale);

  const isAdmin = profile.role === "admin";

  return (
    <View style={styles.header}>
      <LinearGradient
        colors={[
          colors.accent + "24", // 14% opacity in hex
          colors.primary + "1A", // 10% opacity
          "transparent"
        ]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.avatar}>
        {profile.profileImage ? (
          <Image source={{ uri: profile.profileImage }} style={styles.image} />
        ) : (
          <Ionicons name={isAdmin ? "shield-checkmark" : "person"} color={colors.text} size={36} />
        )}
      </View>
      <View style={styles.nameContainer}>
        <Text style={styles.name}>{profile.name}</Text>
        {isAdmin && (
          <View style={styles.adminBadge}>
            <Text style={styles.adminBadgeText}>ADMIN</Text>
          </View>
        )}
      </View>
      <Text style={styles.bio}>{profile.bio || "No biography provided."}</Text>
    </View>
  );
}

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    header: {
      alignItems: "center",
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 22,
      gap: 10,
      overflow: "hidden"
    },
    avatar: {
      width: 88,
      height: 88,
      borderRadius: 28,
      backgroundColor: colors.cardElevated,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden"
    },
    image: {
      width: "100%",
      height: "100%"
    },
    nameContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 4
    },
    name: {
      color: colors.text,
      fontSize: 20 * scale,
      fontWeight: "700"
    },
    adminBadge: {
      backgroundColor: "rgba(6, 182, 212, 0.12)",
      borderColor: "rgba(6, 182, 212, 0.28)",
      borderWidth: 1,
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 2
    },
    adminBadgeText: {
      color: colors.accentSoft,
      fontSize: 10,
      fontWeight: "800"
    },
    bio: {
      color: colors.muted,
      fontSize: 13 * scale,
      textAlign: "center",
      lineHeight: 20 * scale
    }
  });
}
