import { Stack, useRootNavigationState, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ThemeProvider, useTheme } from "../context/ThemeContext";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { ProjectProvider } from "../context/ProjectContext";
import { decideRoute } from "../services/auth/routeGuard";

/**
 * Route guard. While Firebase is still resolving the session nothing is decided (a spinner covers the screen); once known,
 * signed-out users can only reach the landing page and /auth, and signed-in users are taken into the app. The decision is the
 * pure function decideRoute (unit-tested, including that it can never produce a redirect loop).
 */
function AuthGate() {
  const { colors } = useTheme();
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const navState = useRootNavigationState();
  const navReady = Boolean(navState?.key);
  const decision = decideRoute({ status, segments: segments as string[] });
  const target = decision.action === "REDIRECT" ? decision.to : null;

  useEffect(() => {
    if (navReady && target) router.replace(target as never);
  }, [navReady, target, router]);

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: "fade_from_bottom"
        }}
      />
      {decision.action !== "ALLOW" && (
        <View style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: colors.background }]} pointerEvents="auto">
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
    </>
  );
}

function AppContent() {
  const { colors, theme } = useTheme();

  return (
    <>
      <StatusBar
        style={theme === "light" || theme === "sepia" ? "dark" : "light"}
        backgroundColor={colors.background}
        translucent={false}
      />
      <AuthProvider>
        <ProjectProvider>
          <AuthGate />
        </ProjectProvider>
      </AuthProvider>
    </>
  );
}

const styles = StyleSheet.create({
  cover: { alignItems: "center", justifyContent: "center", zIndex: 1000 }
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
