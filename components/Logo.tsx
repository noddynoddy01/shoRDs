import { Image, StyleSheet, Text, View } from "react-native";
import { colors } from "@/constants/theme";

type LogoProps = {
  size?: "sm" | "lg";
  showName?: boolean;
};

export function Logo({ size = "sm", showName = true }: LogoProps) {
  const large = size === "lg";

  return (
    <View style={[styles.lockup, large && styles.lockupLarge]}>
      <Image
        source={require("../assets/logo.png")}
        resizeMode="contain"
        style={[styles.logo, large && styles.logoLarge]}
      />
      {showName ? (
        <Text style={[styles.name, large && styles.nameLarge]}>shoRDs</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: {
    alignItems: "center",
    justifyContent: "center",
    gap: 1
  },
  lockupLarge: {
    gap: 4
  },
  logo: {
    width: 50,
    height: 30
  },
  logoLarge: {
    width: 212,
    height: 132
  },
  name: {
    color: colors.ink,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 12
  },
  nameLarge: {
    fontSize: 14,
    lineHeight: 17
  }
});
