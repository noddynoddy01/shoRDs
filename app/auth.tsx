import { useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { Chip } from "@/components/Chip";
import { GlassButton } from "@/components/GlassButton";
import { Logo } from "@/components/Logo";
import { Screen } from "@/components/Screen";
import { colors as defaultColors, radius } from "@/constants/theme";
import { domains } from "@/data/samplePapers";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { validateSignIn, validateSignUp } from "@/services/auth/forms";

/**
 * Sign-in / sign-up. Identity is Firebase only: a successful submit signs the user in with Firebase, and the route guard
 * (app/_layout.tsx) then takes them into the app. There is no local, offline, admin or mentor login, and a failure never
 * creates a profile: the user stays signed out and is told why.
 */
type AuthMode = "login" | "signup";

export default function AuthScreen() {
  const { colors, fontSizeScale, theme } = useTheme();
  const { status, issue, login, register, loginWithGoogle, dismissIssue } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [interests, setInterests] = useState<string[]>(["AI / ML"]);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const float = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;

  const styles = getStyles(colors, fontSizeScale);
  const unconfigured = status === "UNCONFIGURED";

  useEffect(() => {
    Animated.timing(reveal, {
      toValue: 1,
      duration: 720,
      useNativeDriver: true
    }).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 2400,
          useNativeDriver: true
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 2400,
          useNativeDriver: true
        })
      ])
    ).start();
  }, [float, reveal]);

  const logoTranslateY = float.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -10]
  });

  const logoScale = float.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.035]
  });

  function toggleInterest(interest: string) {
    setInterests((current) =>
      current.includes(interest)
        ? current.filter((item) => item !== interest)
        : [...current, interest]
    );
  }

  function switchMode(next: AuthMode) {
    setMode(next);
    setFormError(null);
    dismissIssue();
  }

  async function submit() {
    if (loading || unconfigured) return;
    setFormError(null);
    dismissIssue();
    const problem = mode === "login" ? validateSignIn({ email, password }) : validateSignUp({ name, email, password });
    if (problem) {
      setFormError(problem);
      return;
    }
    setLoading(true);
    try {
      // On success Firebase reports the user, the session becomes SIGNED_IN and the route guard navigates; nothing to do here.
      // On failure the session stays SIGNED_OUT and `issue` says why.
      if (mode === "login") await login(email, password);
      else await register(name, email, password, interests, { phoneNumber });
    } finally {
      setLoading(false);
    }
  }

  async function googleLogin() {
    if (loading || unconfigured) return;
    if (Platform.OS !== "web") {
      setFormError("Google sign-in is available on the web app. Use your email and password here.");
      return;
    }
    setFormError(null);
    setLoading(true);
    try {
      await loginWithGoogle();
    } finally {
      setLoading(false);
    }
  }

  const message = formError || (issue ? issue.message : null);

  const haloGlow = theme === "light" || theme === "sepia"
    ? "rgba(6, 182, 212, 0.08)"
    : "rgba(6, 182, 212, 0.12)";

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboard}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Animated.View
            style={[
              styles.brandStage,
              {
                opacity: reveal,
                transform: [
                  {
                    translateY: reveal.interpolate({
                      inputRange: [0, 1],
                      outputRange: [18, 0]
                    })
                  }
                ]
              }
            ]}
          >
            <View style={[styles.brandHalo, { backgroundColor: haloGlow }]} />
            <Animated.View
              style={[
                styles.logoFloat,
                {
                  transform: [{ translateY: logoTranslateY }, { scale: logoScale }]
                }
              ]}
            >
              <Logo size="lg" />
            </Animated.View>
            <Text style={styles.brandLine}>Short Research Discoveries</Text>
          </Animated.View>

          <Animated.View
            style={[
              styles.panel,
              {
                opacity: reveal,
                transform: [
                  {
                    translateY: reveal.interpolate({
                      inputRange: [0, 1],
                      outputRange: [28, 0]
                    })
                  }
                ]
              }
            ]}
          >
            <View style={styles.segment}>
              <Pressable
                onPress={() => switchMode("login")}
                style={[styles.segmentButton, mode === "login" && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, mode === "login" && styles.segmentTextActive]}>
                  Login
                </Text>
              </Pressable>
              <Pressable
                onPress={() => switchMode("signup")}
                style={[styles.segmentButton, mode === "signup" && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, mode === "signup" && styles.segmentTextActive]}>
                  Signup
                </Text>
              </Pressable>
            </View>

            <Text style={styles.title}>
              {mode === "login" ? "Enter your research space" : "Create your research profile"}
            </Text>
            <Text style={styles.subtitle}>
              {mode === "login"
                ? "A calmer way to discover papers, technologies, and ideas."
                : "Choose the domains that should shape your discovery feed."}
            </Text>

            {unconfigured && (
              <Text style={styles.notice} accessibilityRole="alert">
                Sign-in is not configured for this build, so no one can sign in. The administrator needs to set the EXPO_PUBLIC_FIREBASE_* variables and rebuild.
              </Text>
            )}

            {mode === "signup" && (
              <>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Full Name"
                  placeholderTextColor={colors.subdued}
                  autoComplete="name"
                  style={styles.input}
                />
                <TextInput
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  placeholder="Phone (optional, used for regional pricing)"
                  placeholderTextColor={colors.subdued}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  style={styles.input}
                />
              </>
            )}
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={colors.subdued}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              style={styles.input}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.subdued}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              onSubmitEditing={submit}
              style={styles.input}
            />

            {mode === "signup" && (
              <View style={styles.interests}>
                <Text style={styles.label}>Domain Interests</Text>
                <View style={styles.chips}>
                  {domains.slice(0, 7).map((domain) => (
                    <Chip
                      key={domain}
                      label={domain}
                      selected={interests.includes(domain)}
                      onPress={() => toggleInterest(domain)}
                    />
                  ))}
                </View>
              </View>
            )}

            {message && (
              <Text style={styles.error} accessibilityRole="alert">
                {message}
              </Text>
            )}

            <GlassButton
              title={loading ? "Please wait" : mode === "login" ? "Login" : "Create Account"}
              icon={mode === "login" ? "log-in-outline" : "person-add-outline"}
              onPress={submit}
              disabled={loading || unconfigured}
            />

            {Platform.OS === "web" && (
              <GlassButton title="Continue with Google" icon="logo-google" variant="quiet" onPress={googleLogin} disabled={loading || unconfigured} />
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function getStyles(colors: typeof defaultColors, scale: number) {
  return StyleSheet.create({
    keyboard: {
      flex: 1
    },
    content: {
      flexGrow: 1,
      padding: 22,
      justifyContent: "center",
      gap: 18
    },
    brandStage: {
      minHeight: 220,
      alignItems: "center",
      justifyContent: "center"
    },
    brandHalo: {
      position: "absolute",
      width: 236,
      height: 236,
      borderRadius: 118,
      borderWidth: 1,
      borderColor: colors.border
    },
    logoFloat: {
      width: 250,
      height: 128,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: colors.accent,
      shadowOpacity: 0.16,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
      elevation: 6
    },
    brandLine: {
      color: colors.muted,
      fontSize: 12 * scale,
      marginTop: 5,
      fontWeight: "500"
    },
    panel: {
      backgroundColor: colors.card,
      borderRadius: 28,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 18,
      gap: 14,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 12 },
      elevation: 8
    },
    segment: {
      flexDirection: "row",
      backgroundColor: colors.cardElevated,
      padding: 4,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border
    },
    segmentButton: {
      flex: 1,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.pill
    },
    segmentActive: {
      backgroundColor: colors.primary,
      shadowColor: colors.primary,
      shadowOpacity: 0.22,
      shadowRadius: 10,
      elevation: 4
    },
    segmentText: {
      color: colors.subdued,
      fontWeight: "700",
      fontSize: 13 * scale
    },
    segmentTextActive: {
      color: colors.text
    },
    title: {
      color: colors.text,
      fontSize: 22 * scale,
      lineHeight: 28 * scale,
      fontWeight: "800",
      marginTop: 6
    },
    subtitle: {
      color: colors.muted,
      fontSize: 13 * scale,
      lineHeight: 19 * scale,
      marginTop: -4
    },
    input: {
      height: 54,
      borderRadius: 18,
      backgroundColor: colors.cardElevated,
      borderColor: colors.border,
      borderWidth: 1,
      color: colors.text,
      paddingHorizontal: 16,
      fontSize: 14 * scale,
      fontWeight: "600"
    },
    interests: {
      gap: 10
    },
    label: {
      color: colors.muted,
      fontSize: 12 * scale,
      fontWeight: "700"
    },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8
    },
    error: {
      color: "#F87171",
      fontSize: 13 * scale,
      lineHeight: 18 * scale,
      fontWeight: "600"
    },
    notice: {
      color: colors.muted,
      fontSize: 12 * scale,
      lineHeight: 17 * scale,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      padding: 12
    }
  });
}
