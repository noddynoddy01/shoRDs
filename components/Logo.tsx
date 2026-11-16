import { Image, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../context/ThemeContext";
import { colors as defaultColors } from "../constants/theme";

type LogoProps = {
  size?: "sm" | "lg";
  showName?: boolean;
  /** Horizontal mark + name for navigation bars. */
  inline?: boolean;
};

export function Logo({ size = "sm", showName = true, inline = false }: LogoProps) {
  const { colors, fontSizeScale } = useTheme();
  const large = size === "lg";
  const styles = getStyles(colors, fontSizeScale, large);

  if (inline) {
    return (
      <View accessibilityRole="image" accessibilityLabel="shoRDs" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Image source={require("../assets/logo-ui-512.png")} resizeMode="contain" style={{ width: 44, height: 27 }} />
        {showName ? <Text style={{ color: colors.ink, fontSize: 19 * fontSizeScale, fontWeight: "800", letterSpacing: -0.3 }}>shoRDs</Text> : null}
      </View>
    );
  }
  return (
    <View style={[styles.lockup, large && styles.lockupLarge]}>
      <Image
        source={require("../assets/logo-ui-512.png")}
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
