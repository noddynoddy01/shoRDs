import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { StyleSheet, View, Pressable, Animated, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../context/ThemeContext";
import { radius } from "../../constants/theme";
import React, { useRef, useEffect } from "react";

function CustomTabBar({ state, descriptors, navigation }: any) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const totalTabs = state.routes.length;
  const barPadding = 6;
  const barMargin = 20;
  const availableWidth = windowWidth - (barMargin * 2) - (barPadding * 2);
  const tabWidth = availableWidth / totalTabs;

  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: state.index * tabWidth,
      useNativeDriver: true,
      tension: 65,
      friction: 9
    }).start();
  }, [state.index, tabWidth]);

  return (
    <View style={[styles.floatingDockContainer, { bottom: Math.max(insets.bottom, 16) }]}>
      <View style={[styles.blurDock, { backgroundColor: colors.card + "D8", borderColor: colors.border }]}>
        
        {/* Active Sliding Pill Indicator */}
        <Animated.View
          style={[
            styles.activePill,
            {
              width: tabWidth,
              backgroundColor: colors.primary + "16",
              borderColor: colors.primary + "2C",
              transform: [{ translateX: Animated.add(slideAnim, barPadding) }]
            }
          ]}
        />

        {state.routes.map((route: any, index: number) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              type: 'tabLongPress',
              target: route.key,
            });
          };

          const getIconName = (routeName: string, focused: boolean): keyof typeof Ionicons.glyphMap => {
            switch (routeName) {
              case "index": return focused ? "play-circle" : "play-circle-outline";
              case "explore": return focused ? "search" : "search-outline";
              case "upload": return focused ? "add-circle" : "add-circle-outline";
              case "mentors": return focused ? "people" : "people-outline";
              case "contact": return focused ? "mail" : "mail-outline";
              case "profile": return focused ? "person" : "person-outline";
              default: return "book-outline";
            }
          };

          const scaleAnim = useRef(new Animated.Value(1)).current;
          useEffect(() => {
            Animated.spring(scaleAnim, {
              toValue: isFocused ? 1.15 : 1.0,
              useNativeDriver: true,
              speed: 15
            }).start();
          }, [isFocused]);

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarTestID}
              onPress={onPress}
              onLongPress={onLongPress}
              style={[styles.tabButton, { width: tabWidth }]}
            >
              <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
                <Ionicons
                  name={getIconName(route.name, isFocused)}
                  size={20}
                  color={isFocused ? colors.primary : colors.subdued}
                />
              </Animated.View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="explore" options={{ title: "Explore" }} />
      <Tabs.Screen name="upload" options={{ title: "Upload" }} />
      <Tabs.Screen name="mentors" options={{ title: "Mentors" }} />
      <Tabs.Screen name="contact" options={{ title: "Contact" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  floatingDockContainer: {
    position: "absolute",
    left: 20,
    right: 20,
    alignItems: "center",
    zIndex: 999
  },
  blurDock: {
    flexDirection: "row",
    height: 54,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: 6,
    alignItems: "center",
    position: "relative",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8
  },
  activePill: {
    position: "absolute",
    height: 38,
    top: 7,
    borderRadius: radius.md,
    borderWidth: 1
  },
  tabButton: {
    height: "100%",
    justifyContent: "center",
    alignItems: "center"
  }
});
