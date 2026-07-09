import React, { useEffect, useRef } from "react";
import { Animated, PanResponder, StyleSheet, View, Pressable, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "../context/ThemeContext";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createChatSession } from "@/services/chatService";

export function FloatingChatButton() {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const BUTTON_SIZE = 56;
  const TAB_BAR_HEIGHT = 74;

  // Initial absolute coordinates: right 20, bottom 84
  const initialX = windowWidth - BUTTON_SIZE - 20;
  const initialY = windowHeight - BUTTON_SIZE - 84;

  const pan = useRef(new Animated.ValueXY({ x: initialX, y: initialY })).current;
  const lastOffset = useRef({ x: initialX, y: initialY });

  useEffect(() => {
    // Sync last position changes
    const listenerId = pan.addListener((value) => {
      lastOffset.current = value;
    });
    return () => {
      pan.removeListener(listenerId);
    };
  }, [pan]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.06, duration: 1200, useNativeDriver: true }),
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

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Detect drag gesture only if finger has moved beyond threshold
        return Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4;
      },
      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4;
      },
      onPanResponderGrant: () => {
        pan.setOffset({
          x: lastOffset.current.x,
          y: lastOffset.current.y
        });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (_, gestureState) => {
        // Bound calculation
        const minX = 10;
        const maxX = windowWidth - BUTTON_SIZE - 10;
        const minY = 40;
        const maxY = windowHeight - BUTTON_SIZE - TAB_BAR_HEIGHT - 10;

        const clampedDx = Math.max(minX - lastOffset.current.x, Math.min(maxX - lastOffset.current.x, gestureState.dx));
        const clampedDy = Math.max(minY - lastOffset.current.y, Math.min(maxY - lastOffset.current.y, gestureState.dy));

        pan.setValue({ x: clampedDx, y: clampedDy });
      },
      onPanResponderRelease: () => {
        pan.flattenOffset();
      }
    })
  ).current;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [
            { translateX: pan.x },
            { translateY: pan.y },
            { scale: pulse }
          ]
        }
      ]}
      {...panResponder.panHandlers}
    >
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
    left: 0,
    top: 0,
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
