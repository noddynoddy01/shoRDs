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
import { colors as defaultColors, radius } from "@/constants/theme";
import { domains } from "@/data/samplePapers";
import { loginWithEmail, signupWithEmail, firebaseApp } from "@/services/firebase";
import { useTheme } from "@/context/ThemeContext";
import AsyncStorage from "@react-native-async-storage/async-storage";

type AuthMode = "login" | "signup" | "mentor";

export default function AuthScreen() {
  const { colors, fontSizeScale, theme } = useTheme();
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [interests, setInterests] = useState<string[]>(["AI / ML"]);
  const [loading, setLoading] = useState(false);
  const float = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;

  const styles = getStyles(colors, fontSizeScale);

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
      // 1. Admin login check
      const usernameInput = email.trim().toUpperCase();
      if (usernameInput === "ABHINAV01" && password === "HELLO") {
        const adminProfile = {
          id: "admin-user",
          name: "Abhinav Prakash (Admin)",
          email: "abhinav01@shords.app",
          bio: "Lead Research Administrator for shoRDs.",
          interests: ["AI / ML", "Quantum Computing", "Space Tech", "Robotics"],
          profileImage: "",
          role: "admin" as const,
          phoneNumber: "+91 8757674333",
          country: "India",
          language: "English"
        };
        await AsyncStorage.setItem("shords.currentUser", JSON.stringify(adminProfile));
        Alert.alert("Admin Login Successful", "Welcome back, Abhinav! You have administrator privileges.");
        router.replace("/(tabs)");
        return;
      }

      // 2. Mentor login check
      if (mode === "mentor") {
        const mentorId = email.trim().toLowerCase();
        const { mentors } = await import("@/data/samplePapers");
        const found = mentors.find((m) => m.id === mentorId || m.name.toLowerCase().includes(mentorId));
        
        const mentorProfile = {
          id: found?.id || `mentor-${Date.now()}`,
          name: found?.name || "Dr. " + (email.split("@")[0] || "Scholarly Mentor"),
          email: found?.id ? `${found.id}@shords.app` : email,
          bio: found?.bio || "Research mentor dedicated to guidance.",
          interests: found?.focus ? [found.focus] : ["Research"],
          profileImage: "",
          role: "mentor" as const,
          phoneNumber: "+91 9999999999",
          country: "India",
          language: "English"
        };
        await AsyncStorage.setItem("shords.currentUser", JSON.stringify(mentorProfile));
        Alert.alert("Mentor Login Successful", `Welcome, ${mentorProfile.name}!`);
        router.replace("/(tabs)");
        return;
      }

      // 3. Standard login/signup
      if (mode === "login") {
        if (firebaseApp) {
          await loginWithEmail(email, password);
        }
        
        // Mock profile write for local use
        const userProfile = {
          id: `user-${Date.now()}`,
          name: email.split("@")[0] || "Researcher",
          email: email,
          bio: "Learning emerging technology through simplified research discoveries.",
          interests: ["AI / ML"],
          profileImage: "",
          role: "user" as const,
          phoneNumber: "+1 555-0199",
          country: "International",
          language: "English"
        };
        await AsyncStorage.setItem("shords.currentUser", JSON.stringify(userProfile));
      } else {
        if (firebaseApp) {
          await signupWithEmail(name, email, password, interests);
        }
        
        const isIndia = phoneNumber.trim().startsWith("+91") || phoneNumber.trim().startsWith("91");
        const userProfile = {
          id: `user-${Date.now()}`,
          name: name,
          email: email,
          bio: "Learning emerging technology through simplified research discoveries.",
          interests: interests,
          profileImage: "",
          role: "user" as const,
          phoneNumber: phoneNumber,
          country: isIndia ? "India" : "International",
          language: "English"
        };
        await AsyncStorage.setItem("shords.currentUser", JSON.stringify(userProfile));
      }
      router.replace("/(tabs)");
    } catch (error) {
      if (!email || !password || (mode === "signup" && (!name || !phoneNumber))) {
        Alert.alert("Complete the form", "Add the required account details to continue.");
      } else {
        // Fallback for offline/local sandbox run
        const isIndia = phoneNumber.trim().startsWith("+91") || phoneNumber.trim().startsWith("91");
        const fallbackProfile = {
          id: `user-${Date.now()}`,
          name: mode === "signup" ? name : email.split("@")[0] || "Researcher",
          email: email,
          bio: "Learning emerging technology through simplified research discoveries.",
          interests: mode === "signup" ? interests : ["AI / ML"],
          profileImage: "",
          role: "user" as const,
          phoneNumber: phoneNumber || "+1 555-0199",
          country: isIndia ? "India" : "International",
          language: "English"
        };
        await AsyncStorage.setItem("shords.currentUser", JSON.stringify(fallbackProfile));
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
                onPress={() => setMode("login")}
                style={[styles.segmentButton, mode === "login" && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, mode === "login" && styles.segmentTextActive]}>
                  Login
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setMode("mentor")}
                style={[styles.segmentButton, mode === "mentor" && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, mode === "mentor" && styles.segmentTextActive]}>
                  Mentor
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
              {mode === "login" ? "Enter your research space" : mode === "mentor" ? "Mentor Hub Login" : "Create your research profile"}
            </Text>
            <Text style={styles.subtitle}>
              {mode === "login"
                ? "A calmer way to discover papers, technologies, and ideas."
                : mode === "mentor"
                ? "Connect with students, manage chats, and review papers."
                : "Choose the domains that should shape your discovery feed."}
            </Text>

            {mode === "signup" && (
              <>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Full Name"
                  placeholderTextColor={colors.subdued}
                  style={styles.input}
                />
                <TextInput
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  placeholder="Phone (e.g. +91 8757674333)"
                  placeholderTextColor={colors.subdued}
                  keyboardType="phone-pad"
                  style={styles.input}
                />
              </>
            )}
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={mode === "login" ? "Email or Admin Username" : mode === "mentor" ? "Mentor ID (e.g. rajeev-shorey)" : "Email"}
              placeholderTextColor={colors.subdued}
              autoCapitalize="none"
              keyboardType={mode === "signup" ? "email-address" : "default"}
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

            <GlassButton
              title={loading ? "Please wait" : mode === "login" ? "Login" : mode === "mentor" ? "Enter Mentor Hub" : "Create Account"}
              icon={mode === "login" || mode === "mentor" ? "log-in-outline" : "person-add-outline"}
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
    }
  });
}
