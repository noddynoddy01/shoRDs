import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
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
import { colors, radius } from "@/constants/theme";
import { domains } from "@/data/samplePapers";
import { loginWithEmail, signupWithEmail } from "@/services/firebase";

type AuthMode = "login" | "signup";

export default function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [interests, setInterests] = useState<string[]>(["AI / ML"]);
  const [loading, setLoading] = useState(false);
  const float = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;

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

  async function submit() {
    setLoading(true);
    try {
      if (mode === "login") {
        await loginWithEmail(email, password);
      } else {
        await signupWithEmail(name, email, password, interests);
      }
      router.replace("/(tabs)");
    } catch (error) {
      if (!email || !password || (mode === "signup" && !name)) {
        Alert.alert("Complete the form", "Add the required account details to continue.");
      } else {
        router.replace("/(tabs)");
      }
    } finally {
      setLoading(false);
    }
  }

  function googleLogin() {
    Alert.alert(
      "Google Login",
      "Add EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and Firebase OAuth credentials to enable Google sign-in."
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboard}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
            <View style={styles.brandHalo} />
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
                onPress={() => setMode("login")}
                style={[styles.segmentButton, mode === "login" && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, mode === "login" && styles.segmentTextActive]}>
                  Login
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setMode("signup")}
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

            {mode === "signup" ? (
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Full Name"
                placeholderTextColor={colors.subdued}
                style={styles.input}
              />
            ) : null}
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={colors.subdued}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.subdued}
              secureTextEntry
              style={styles.input}
            />

            {mode === "signup" ? (
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
            ) : null}

            <GlassButton
              title={loading ? "Please wait" : mode === "login" ? "Login" : "Create Account"}
              icon={mode === "login" ? "log-in-outline" : "person-add-outline"}
              onPress={submit}
              disabled={loading}
            />

            <GlassButton title="Continue with Google" icon="logo-google" variant="quiet" onPress={googleLogin} />
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
    minHeight: 246,
    alignItems: "center",
    justifyContent: "center"
  },
  brandHalo: {
    position: "absolute",
    width: 236,
    height: 236,
    borderRadius: 118,
    backgroundColor: "rgba(6, 182, 212, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(103, 232, 249, 0.16)"
  },
  logoFloat: {
    width: 250,
    height: 128,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOpacity: 0.32,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12
  },
  brandLine: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 5,
    fontWeight: "400"
  },
  panel: {
    backgroundColor: "rgba(21, 27, 47, 0.86)",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(203, 213, 225, 0.18)",
    padding: 18,
    gap: 14,
    shadowColor: "#000",
    shadowOpacity: 0.26,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 18 },
    elevation: 10
  },
  segment: {
    flexDirection: "row",
    backgroundColor: "rgba(11, 16, 32, 0.7)",
    padding: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(203, 213, 225, 0.08)"
  },
  segmentButton: {
    flex: 1,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill
  },
  segmentActive: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.36,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6
  },
  segmentText: {
    color: colors.subdued,
    fontWeight: "600"
  },
  segmentTextActive: {
    color: colors.text
  },
  title: {
    color: colors.text,
    fontSize: 25,
    lineHeight: 31,
    fontWeight: "700",
    marginTop: 6
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: -5
  },
  input: {
    height: 56,
    borderRadius: 18,
    backgroundColor: "rgba(27, 36, 64, 0.86)",
    borderColor: "rgba(203, 213, 225, 0.16)",
    borderWidth: 1,
    color: colors.text,
    paddingHorizontal: 16,
    fontSize: 15,
    fontWeight: "500"
  },
  interests: {
    gap: 10
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600"
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  }
});
