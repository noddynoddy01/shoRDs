import { Stack, useRootNavigationState, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ThemeProvider, useTheme } from "../context/ThemeContext";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { ProjectProvider } from "../context/ProjectContext";
import { ProfileProvider, useProfile } from "../context/ProfileContext";
import { AppRail } from "../components/nav/AppRail";
import { ToastProvider } from "../components/ui";
import { decideRoute, routerBehindUrl } from "../services/auth/routeGuard";
import { showsChrome } from "../services/nav/items";
import { breakpointFor, usesRail } from "../services/ui/breakpoints";

/**
 * Route guard. While Firebase is still resolving the session nothing is decided (a spinner covers the screen); once known,
 * signed-out users can only reach the landing page and /auth, and signed-in users are taken into the app. The decision is the
 * pure function decideRoute (unit-tested, including that it can never produce a redirect loop).
 */
function AuthGate() {
  const { colors } = useTheme();
  const { status } = useAuth();
  const { onboarding } = useProfile();
  const segments = useSegments();
  const router = useRouter();
  const navState = useRootNavigationState();
  const navReady = Boolean(navState?.key);
  const urlPath = Platform.OS === "web" && typeof window !== "undefined" ? window.location.pathname : null;
  const decision = routerBehindUrl(segments as string[], urlPath) ? ({ action: "WAIT" } as const) : decideRoute({ status, segments: segments as string[], onboarding });
  const target = decision.action === "REDIRECT" ? decision.to : null;

  useEffect(() => {
    if (navReady && target) router.replace(target as never);
  }, [navReady, target, router]);

  const { width } = useWindowDimensions();
  const rail = status === "SIGNED_IN" && decision.action === "ALLOW" && usesRail(breakpointFor(width)) && showsChrome(segments as string[]);

  return (
    <>
      <View style={{ flex: 1, flexDirection: "row" }}>
        {rail ? <AppRail segments={segments as string[]} /> : null}
        <View style={{ flex: 1 }}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
              animation: "fade_from_bottom"
            }}
          />
        </View>
      </View>
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
          <ProfileProvider>
            <ToastProvider>
              <AuthGate />
            </ToastProvider>
          </ProfileProvider>
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
