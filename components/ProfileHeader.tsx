import { Ionicons } from "@expo/vector-icons";
import { Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius } from "@/constants/theme";
import { UserProfile } from "@/types/models";

type ProfileHeaderProps = {
  profile: UserProfile;
};

export function ProfileHeader({ profile }: ProfileHeaderProps) {
  return (
    <View style={styles.header}>
      <LinearGradient
        colors={["rgba(6,182,212,0.14)", "rgba(124,58,237,0.10)", "transparent"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.avatar}>
        {profile.profileImage ? (
          <Image source={{ uri: profile.profileImage }} style={styles.image} />
        ) : (
          <Ionicons name="person" color={colors.text} size={36} />
        )}
      </View>
      <Text style={styles.name}>{profile.name}</Text>
      <Text style={styles.bio}>{profile.bio}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
  name: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700"
  },
  bio: {
    color: colors.muted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21
  }
});
