import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Logo } from "@/components/Logo";
import { PersonaPicker } from "@/components/social/PersonaPicker";
import { Banner, Button, Card, FadeIn, Input } from "@/components/ui";
import { radius, spacing, tokens } from "@/constants/theme";
import { site } from "@/constants/site";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { validateSignIn, validateSignUp } from "@/services/auth/forms";
import { PERSONA_CHOICES, SelectablePersona, parsePersonaChoice } from "@/services/social/intent";
import { intent } from "@/services/social/intentStore";
import { Linking } from "react-native";

/**
 * One screen for signing in, creating an account and resetting a password. Identity is Firebase only: a successful submit signs the person in with
 * Firebase and the route guard (app/_layout.tsx) then takes them on. There is no local, offline, admin or mentor login, and a failure never creates a
 * profile. Creating an account is two steps: say how you will use shoRDs, then enter your details. The chosen option is only a hint for onboarding.
 */
type Mode = "login" | "signup" | "reset";

export default function AuthScreen() {
  const { colors, fontSizeScale: k } = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= tokens.breakpoints.laptop;
  const params = useLocalSearchParams<{ mode?: string; persona?: string }>();
  const { status, issue, login, register, loginWithGoogle, resetPassword, dismissIssue } = useAuth();
  const [mode, setMode] = useState<Mode>(params.mode === "signup" ? "signup" : "login");
  const [persona, setPersona] = useState<SelectablePersona | null>(parsePersonaChoice(params.persona) ?? intent.get());
  const [step, setStep] = useState<1 | 2>(parsePersonaChoice(params.persona) || intent.get() ? 2 : 1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const unconfigured = status === "UNCONFIGURED";

  useEffect(() => {
    const fromUrl = parsePersonaChoice(params.persona);
    if (fromUrl) { setPersona(fromUrl); void intent.set(fromUrl); setStep(2); return; }
    void intent.hydrate().then((p) => { if (p) { setPersona((cur) => cur ?? p); } });
  }, [params.persona]);

  const choose = (p: SelectablePersona) => { setPersona(p); void intent.set(p); };
  const switchMode = (next: Mode) => { setMode(next); setFormError(null); setNotice(null); dismissIssue(); };

  async function submit() {
    if (loading || unconfigured) return;
    setFormError(null); setNotice(null); dismissIssue();
    if (mode === "reset") {
      if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setFormError("Enter the email address you signed up with."); return; }
      setLoading(true);
      try {
        const r = await resetPassword(email);
        // Firebase does not say whether an address has an account, and neither do we.
        if (r.ok || (r.issue.code !== "NETWORK" && r.issue.code !== "TOO_MANY_ATTEMPTS" && r.issue.code !== "INVALID_EMAIL" && r.issue.code !== "NOT_CONFIGURED")) setNotice("If an account exists for that address, a password reset link is on its way. Check your inbox and spam folder.");
      } finally { setLoading(false); }
      return;
    }
    const problem = mode === "login" ? validateSignIn({ email, password }) : validateSignUp({ name, email, password });
    if (problem) { setFormError(problem); return; }
    if (mode === "signup" && !persona) { setStep(1); setFormError("Choose how you would like to use shoRDs first."); return; }
    setLoading(true);
    try {
      // No interests are collected here any more: they are part of onboarding. Success navigates through the route guard; failure leaves the person signed out with `issue`.
      if (mode === "login") await login(email, password);
      else await register(name, email, password, [], { phoneNumber: phone });
    } finally { setLoading(false); }
  }

  async function google() {
    if (loading || unconfigured) return;
    if (Platform.OS !== "web") { setFormError("Google sign-in is available on the web app. Use your email and password here."); return; }
    if (mode === "signup" && !persona) { setStep(1); setFormError("Choose how you would like to use shoRDs first."); return; }
    setFormError(null); setLoading(true);
    try { await loginWithGoogle(); } finally { setLoading(false); }
  }

  const message = formError || (issue ? issue.message : null);
  const chosen = PERSONA_CHOICES.find((c) => c.persona === persona);
  const title = mode === "login" ? "Welcome back" : mode === "reset" ? "Reset your password" : step === 1 ? "How would you like to use shoRDs?" : "Create your account";
  const sub = mode === "login" ? "Sign in to continue." : mode === "reset" ? "We will email you a link to choose a new password." : step === 1 ? "Pick the option that fits best. You can change it later." : "It takes a minute.";

  const form = (
    <View style={{ gap: spacing.md }}>
      {mode === "signup" && step === 1 ? (
        <>
          <PersonaPicker value={persona} onChange={choose} columns={wide ? 2 : 1} />
          <Button label="Continue" disabled={!persona} iconRight="arrow-forward" onPress={() => { setFormError(null); setStep(2); }} />
        </>
      ) : (
        <>
          {mode === "signup" && chosen ? (
            <View style={[s.chosen, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Ionicons name={chosen.icon} size={20} color={colors.primary} />
              <Text style={{ color: colors.text, flex: 1, fontSize: tokens.fontSize.sm * k }}>Signing up as <Text style={{ fontWeight: tokens.weight.bold }}>{chosen.title}</Text></Text>
              <Pressable onPress={() => setStep(1)} accessibilityRole="button" accessibilityLabel="Change how you will use shoRDs" hitSlop={8}><Text style={{ color: colors.accent, fontWeight: tokens.weight.bold, fontSize: tokens.fontSize.sm * k }}>Change</Text></Pressable>
            </View>
          ) : null}
          {mode === "signup" && persona === "MENTOR" ? <Banner kind="info" text="After you create your account you will complete your profile and then apply for verification. You are listed as a verified mentor only after an administrator approves your application." /> : null}
          {message ? <Banner text={message} action={issue ? { label: "Dismiss", onPress: () => { setFormError(null); dismissIssue(); } } : undefined} /> : null}
          {notice ? <Banner kind="success" text={notice} /> : null}
          {unconfigured && !message ? <Banner kind="warning" text="Sign-in is not configured in this build, so accounts cannot be created or used here." /> : null}
          {mode === "signup" ? <Input label="Full name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={100} returnKeyType="next" /> : null}
          <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType={mode === "reset" ? "send" : "next"} onSubmitEditing={mode === "reset" ? () => void submit() : undefined} />
          {mode !== "reset" ? <Input label="Password" value={password} onChangeText={setPassword} password autoCapitalize="none" autoComplete={mode === "login" ? "current-password" : "new-password"} textContentType={mode === "login" ? "password" : "newPassword"} help={mode === "signup" ? "At least 6 characters." : undefined} returnKeyType="go" onSubmitEditing={() => void submit()} /> : null}
          {mode === "signup" ? <Input label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" help="Only used on this device for regional pricing. Never shown to anyone." /> : null}
          {mode === "login" ? <Pressable onPress={() => switchMode("reset")} accessibilityRole="link" style={{ alignSelf: "flex-end" }} hitSlop={8}><Text style={{ color: colors.accent, fontSize: tokens.fontSize.sm * k, fontWeight: tokens.weight.semibold }}>Forgot password?</Text></Pressable> : null}
          <Button fullWidth label={mode === "login" ? "Sign in" : mode === "reset" ? "Send reset link" : "Create account"} onPress={() => void submit()} loading={loading} disabled={unconfigured} />
          {mode !== "reset" ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><View style={{ flex: 1, height: 1, backgroundColor: colors.border }} /><Text style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k }}>or</Text><View style={{ flex: 1, height: 1, backgroundColor: colors.border }} /></View>
              <Button fullWidth kind="secondary" icon="logo-google" label="Continue with Google" onPress={() => void google()} disabled={loading || unconfigured} />
            </>
          ) : null}
          {mode === "signup" && (site.termsUrl || site.privacyUrl) ? (
            <Text style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k, lineHeight: 17 * k }}>
              By creating an account you agree to the{" "}
              {site.termsUrl ? <Text style={{ color: colors.accent }} onPress={() => void Linking.openURL(site.termsUrl!)}>terms of use</Text> : null}
              {site.termsUrl && site.privacyUrl ? " and " : null}
              {site.privacyUrl ? <Text style={{ color: colors.accent }} onPress={() => void Linking.openURL(site.privacyUrl!)}>privacy policy</Text> : null}.
            </Text>
          ) : null}
        </>
      )}
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
        <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k }}>{mode === "login" ? "New to shoRDs?" : mode === "reset" ? "Remembered it?" : "Already have an account?"}</Text>
        <Pressable onPress={() => switchMode(mode === "login" ? "signup" : "login")} accessibilityRole="link" hitSlop={8}><Text style={{ color: colors.accent, fontWeight: tokens.weight.bold, fontSize: tokens.fontSize.sm * k }}>{mode === "login" ? "Create an account" : "Sign in"}</Text></Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[s.scroll, wide && { flexDirection: "row", alignItems: "stretch" }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {wide ? (
            <View style={[s.brand, { backgroundColor: colors.surface, borderRightColor: colors.border }]}>
              <Pressable onPress={() => router.replace("/" as never)} accessibilityRole="link" accessibilityLabel="Back to the shoRDs home page"><Logo showName inline /></Pressable>
              <View style={{ gap: spacing.md, maxWidth: 440 }}>
                <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 34 * k, lineHeight: 40 * k, fontWeight: tokens.weight.heavy, letterSpacing: -0.6 }}>Research moves forward when knowledge moves freely.</Text>
                {(["Understand papers faster with short, readable cards", "Ask questions and get answers that point back to the source", "Find verified mentors and people to work with"] as const).map((t) => (
                  <View key={t} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                    <Ionicons name="checkmark-circle" size={20} color={colors.accent} style={{ marginTop: 1 }} />
                    <Text style={{ color: colors.muted, fontSize: tokens.fontSize.md * k, lineHeight: 23 * k, flex: 1 }}>{t}</Text>
                  </View>
                ))}
              </View>
              <Text style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k }}>Your sign-in is handled by Firebase. shoRDs never sees your password.</Text>
            </View>
          ) : null}
          <View style={[s.formSide, wide && { flex: 1 }]}>
            <FadeIn style={{ width: "100%", maxWidth: mode === "signup" && step === 1 ? 720 : 440, alignSelf: "center" }}>
              {!wide ? <Pressable onPress={() => router.replace("/" as never)} accessibilityRole="link" accessibilityLabel="Back to the shoRDs home page" style={{ alignSelf: "center", marginBottom: spacing.lg }}><Logo showName inline /></Pressable> : null}
              <Card style={{ padding: spacing.lg, gap: spacing.md }}>
                <View style={{ gap: 4 }}>
                  <Text accessibilityRole="header" style={{ color: colors.text, fontSize: tokens.fontSize.xxl * k, fontWeight: tokens.weight.heavy, letterSpacing: -0.4 }}>{title}</Text>
                  <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k }}>{sub}</Text>
                </View>
                {form}
              </Card>
            </FadeIn>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: { flexGrow: 1 },
  brand: { flex: 1, padding: 56, justifyContent: "space-between", borderRightWidth: 1, minHeight: 640 },
  formSide: { padding: spacing.md, paddingVertical: spacing.xl, justifyContent: "center" },
  chosen: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: radius.md, padding: 12 }
});
