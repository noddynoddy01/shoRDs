import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/constants/theme";

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.subdued,
        tabBarStyle: {
          backgroundColor: "rgba(11, 16, 32, 0.94)",
          borderTopColor: "rgba(103, 232, 249, 0.12)",
          height: 66 + insets.bottom,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 8),
          position: "absolute",
          elevation: 18
        },
        tabBarLabelStyle: {
          fontWeight: "600",
          fontSize: 10
        }
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} />
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
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <Ionicons name="person" color={color} size={size} />
        }}
      />
    </Tabs>
  );
}
