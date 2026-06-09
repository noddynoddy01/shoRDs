import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../context/ThemeContext";
import { colors as defaultColors } from "../../constants/theme";

function TabBarBackground() {
  const { colors, theme } = useTheme();
  
  const gradientColors = theme === "light"
    ? ["rgba(248,250,252,0)", "rgba(248,250,252,0.9)", "rgba(248,250,252,0.98)"]
    : theme === "sepia"
    ? ["rgba(245,236,215,0)", "rgba(245,236,215,0.9)", "rgba(245,236,215,0.98)"]
    : theme === "nord"
    ? ["rgba(46,52,64,0)", "rgba(46,52,64,0.9)", "rgba(46,52,64,0.98)"]
    : theme === "emerald"
    ? ["rgba(6,36,25,0)", "rgba(6,36,25,0.9)", "rgba(6,36,25,0.98)"]
    : ["rgba(11,16,32,0)", "rgba(11,16,32,0.88)", "rgba(11,16,32,0.98)"];

  return (
    <LinearGradient
      colors={gradientColors as any}
      style={StyleSheet.absoluteFill}
    />
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { colors, theme } = useTheme();
  
  const tabBarHeight = 66 + Math.max(insets.bottom, 8);

  const activeColor = colors.accentSoft;
  const inactiveColor = colors.subdued;
  const navBg = theme === "light"
    ? "rgba(248, 250, 252, 0.94)"
    : theme === "sepia"
    ? "rgba(245, 236, 215, 0.94)"
    : theme === "nord"
    ? "rgba(46, 52, 64, 0.94)"
    : theme === "emerald"
    ? "rgba(6, 36, 25, 0.94)"
    : "rgba(11, 16, 32, 0.94)";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: activeColor,
        tabBarInactiveTintColor: inactiveColor,
        tabBarBackground: () => <TabBarBackground />,
        tabBarStyle: {
          backgroundColor: navBg,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 8),
          position: "absolute",
          elevation: 0
        },
        tabBarLabelStyle: {
          fontWeight: "700",
          fontSize: 10,
          marginTop: 2
        }
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons name="play-circle" color={color} size={size} />
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: "Explore",
          tabBarIcon: ({ color, size }) => <Ionicons name="search" color={color} size={size} />
        }}
      />
      <Tabs.Screen
        name="upload"
        options={{
          title: "Upload",
          tabBarIcon: ({ color, size }) => <Ionicons name="add-circle" color={color} size={size + 3} />
        }}
      />
      <Tabs.Screen
        name="mentors"
        options={{
          title: "Mentors",
          tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size} />
        }}
      />
      <Tabs.Screen
        name="contact"
        options={{
          title: "Contact",
          tabBarIcon: ({ color, size }) => <Ionicons name="mail" color={color} size={size} />
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <Ionicons name="person" color={color} size={size} />
        }}
      />
    </Tabs>
  );
}
