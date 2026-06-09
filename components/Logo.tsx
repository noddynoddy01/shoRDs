import { Image, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../context/ThemeContext";
import { colors as defaultColors } from "../constants/theme";

type LogoProps = {
  size?: "sm" | "lg";
  showName?: boolean;
};

export function Logo({ size = "sm", showName = true }: LogoProps) {
  const { colors, fontSizeScale } = useTheme();
  const large = size === "lg";
  const styles = getStyles(colors, fontSizeScale, large);

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

function getStyles(colors: typeof defaultColors, scale: number, large: boolean) {
  return StyleSheet.create({
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
      fontSize: 10 * scale,
      fontWeight: "700",
      letterSpacing: 0,
      lineHeight: 12 * scale
    },
    nameLarge: {
      fontSize: 14 * scale,
      lineHeight: 17 * scale
    }
  });
}
