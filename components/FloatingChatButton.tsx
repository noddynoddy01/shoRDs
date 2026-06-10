import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "../context/ThemeContext";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createChatSession } from "@/services/chatService";

export function FloatingChatButton() {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true })
      ])
    ).start();
  }, [pulse]);

  const handlePress = async () => {
    const userVal = await AsyncStorage.getItem("shords.currentUser");
    if (!userVal) {
      router.push("/auth" as never);
      return;
    }
    const user = JSON.parse(userVal);
    const session = await createChatSession(user.id, user.name, "abhinav-ai", "AI Bot");
    router.push(`/chat/${session.id}` as never);
  };

  return (
    <Animated.View style={[styles.container, { transform: [{ scale: pulse }] }]}>
      <Pressable
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: colors.accent,
            shadowColor: colors.accent,
            opacity: pressed ? 0.9 : 1
          }
        ]}
        onPress={handlePress}
      >
        <Ionicons name="chatbubble-ellipses" size={24} color="#FFFFFF" />
        <View style={[styles.badge, { borderColor: colors.surface }]} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    right: 20,
    bottom: 84, // sits beautifully above the bottom tab bar (tabBarHeight is around 74)
    zIndex: 999,
    elevation: 10
  },
  button: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.2)"
  },
  badge: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#10B981",
    borderWidth: 1.5
  }
});
