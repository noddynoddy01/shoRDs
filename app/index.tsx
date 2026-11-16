import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Logo } from "@/components/Logo";
import { PersonaPicker } from "@/components/social/PersonaPicker";
import { Button, Card, Dropdown, FadeIn, Float } from "@/components/ui";
import type { IconName } from "@/components/ui";
import { radius, spacing, tokens } from "@/constants/theme";
import { site } from "@/constants/site";
import { useTheme } from "@/context/ThemeContext";
import { SelectablePersona } from "@/services/social/intent";
import { intent } from "@/services/social/intentStore";

/**
 * The public landing page (signed-in people never see it: the route guard sends them into the app). It states only what the product does today;
 * there are no figures, testimonials, partner names or affiliations on it. Navigation links scroll to the matching section of this page.
 */
type SectionKey = "pillars" | "how" | "path" | "community" | "features" | "about";

const PILLARS: { icon: IconName; title: string; body: string }[] = [
  { icon: "newspaper-outline", title: "Research discovery", body: "Papers turned into short, readable cards with the abstract, the key points and the domain, so you can decide what deserves a full read." },
  { icon: "sparkles-outline", title: "AI-powered research intelligence", body: "Ask the Research Copilot about a paper. Answers point back to the passages they come from, so you can check them yourself." },
  { icon: "people-outline", title: "Research community and mentorship", body: "Find verified mentors, send a mentorship request, and talk privately once it is accepted." }
];

const STEPS = [
  { title: "Choose how you will use shoRDs", body: "Student, mentor, researcher or professor. You can change it later from your profile." },
  { title: "Create your account", body: "Sign in with email and password, or with Google on the web." },
  { title: "Set up your profile", body: "A few questions fitted to what you chose. Your email address is never shown to other people." },
  { title: "Discover, connect and learn", body: "Read research, find mentors and collaborators, and ask the assistant when you are unsure how something works." }
];

const FEATURES: { icon: IconName; title: string; body: string; note?: string }[] = [
  { icon: "sparkles-outline", title: "Research Copilot", body: "A reading companion for a single paper. It explains, compares and answers with references to the paper itself." },
  { icon: "help-buoy-outline", title: "shoRDs Assistant", body: "Help about using shoRDs itself: how mentorship works, how to apply as a mentor, where to find a setting. It is separate from the Copilot and does not read your messages." },
  { icon: "ribbon-outline", title: "Mentor discovery", body: "Search mentors by domain, expertise and availability. Only mentors approved by a shoRDs administrator are listed as verified." },
  { icon: "git-network-outline", title: "Collaboration", body: "Researchers can find people with shared interests and message them directly when they allow it.", note: "Shared project spaces and group chat are not available yet." }
];

export default function LandingScreen() {
  const { colors, fontSizeScale: k } = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= tokens.breakpoints.laptop;
  const narrow = width < 400;
  const scroller = useRef<ScrollView>(null);
  const ys = useRef<Partial<Record<SectionKey, number>>>({});
  const [path, setPath] = useState<SelectablePersona | null>(intent.get());

  const goto = (key: SectionKey) => scroller.current?.scrollTo({ y: Math.max(0, (ys.current[key] ?? 0) - 72), animated: true });
  const mark = (key: SectionKey) => ({ onLayout: (e: { nativeEvent: { layout: { y: number } } }) => { ys.current[key] = e.nativeEvent.layout.y; } });
  const choose = (p: SelectablePersona) => { setPath(p); void intent.set(p); };
  const start = () => { router.push((path ? `/auth?mode=signup&persona=${path}` : "/auth?mode=signup") as never); };

  const navLinks: { label: string; key: SectionKey }[] = [
    { label: "Explore Research", key: "pillars" }, { label: "Discover Mentors", key: "features" }, { label: "Research Community", key: "community" }, { label: "About", key: "about" }
  ];
  const Heading = ({ children, sub }: { children: string; sub?: string }) => (
    <View style={{ gap: 8, marginBottom: spacing.lg, maxWidth: 680 }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: (wide ? 32 : 26) * k, fontWeight: tokens.weight.heavy, letterSpacing: -0.4 }}>{children}</Text>
      {sub ? <Text style={{ color: colors.muted, fontSize: tokens.fontSize.md * k, lineHeight: 24 * k }}>{sub}</Text> : null}
    </View>
  );

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[s.nav, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={[s.navInner, narrow ? { gap: 4, paddingHorizontal: spacing.sm } : null]}>
          <Logo showName inline />
          {wide ? (
            <View style={{ flexDirection: "row", gap: spacing.lg, alignItems: "center" }} accessibilityRole="menu">
              {navLinks.map((n) => (
                <Pressable key={n.label} onPress={() => goto(n.key)} accessibilityRole="link" hitSlop={8}><Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k, fontWeight: tokens.weight.medium }}>{n.label}</Text></Pressable>
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: narrow ? 2 : spacing.sm, alignItems: "center" }}>
            <Button small kind="ghost" label="Sign In" onPress={() => router.push("/auth" as never)} />
            <Button small label="Get Started" onPress={() => goto("path")} />
            {!wide ? <Dropdown accessibilityLabel="Menu" trigger={<View style={s.menuBtn}><Ionicons name="menu" size={22} color={colors.text} /></View>} items={navLinks.map((n) => ({ label: n.label, onPress: () => goto(n.key) }))} /> : null}
          </View>
        </View>
      </View>

      <ScrollView ref={scroller} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={[s.band, { paddingTop: wide ? 88 : 48, paddingBottom: wide ? 88 : 48 }]}>
          <View style={[s.inner, wide && { flexDirection: "row", alignItems: "center", gap: 64 }]}>
            <FadeIn style={{ flex: 1, gap: spacing.md }}>
              <Text style={{ color: colors.accent, fontSize: tokens.fontSize.sm * k, fontWeight: tokens.weight.bold, letterSpacing: 1, textTransform: "uppercase" }}>Short research discoveries</Text>
              <Text accessibilityRole="header" style={{ color: colors.text, fontSize: (wide ? 52 : 34) * k, lineHeight: (wide ? 58 : 40) * k, fontWeight: tokens.weight.heavy, letterSpacing: -1 }}>Research moves forward when knowledge moves freely.</Text>
              <Text style={{ color: colors.muted, fontSize: (wide ? 19 : 16) * k, lineHeight: (wide ? 30 : 25) * k, maxWidth: 580 }}>
                shoRDs turns research papers into short, readable cards, helps you understand them with an AI reading companion, and connects you with mentors and fellow researchers.
              </Text>
              <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.sm }}>
                <Button label="Explore Research" iconRight="arrow-forward" onPress={() => goto("pillars")} />
                <Button kind="secondary" label="Join the Community" onPress={() => goto("path")} />
              </View>
            </FadeIn>
            {wide ? (
              <FadeIn delay={260} distance={18} style={{ flex: 0.8 }}>
                <Float><Card style={{ gap: spacing.md, padding: spacing.lg }} accessibilityLabel="Illustration of a research card">
                  <Text style={{ color: colors.subdued, fontSize: tokens.fontSize.xs, letterSpacing: 0.8, textTransform: "uppercase" }}>Illustration: how a paper becomes a card</Text>
                  {(["Abstract in plain language", "Key points to remember", "Evidence linked to the paper"] as const).map((t, i) => (
                    <View key={t} style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary + "1F", alignItems: "center", justifyContent: "center" }}><Text style={{ color: colors.primary, fontWeight: tokens.weight.heavy }}>{i + 1}</Text></View>
                      <View style={{ flex: 1, gap: 6 }}>
                        <Text style={{ color: colors.text, fontWeight: tokens.weight.semibold, fontSize: tokens.fontSize.md * k }}>{t}</Text>
                        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.cardElevated, width: `${88 - i * 14}%` }} />
                      </View>
                    </View>
                  ))}
                </Card></Float>
              </FadeIn>
            ) : null}
          </View>
        </View>

        {/* Pillars */}
        <View style={[s.band, { backgroundColor: colors.surface }]} {...mark("pillars")}>
          <View style={s.inner}>
            <Heading sub="Three things shoRDs does, each useful on its own.">What shoRDs is for</Heading>
            <View style={[s.grid, { flexDirection: wide ? "row" : "column" }]}>
              {PILLARS.map((p, i) => (
                <FadeIn key={p.title} delay={120 * i} distance={14} style={{ flex: 1 }}><Card style={{ flex: 1, gap: spacing.sm, padding: spacing.lg }}>
                  <View style={[s.icon, { backgroundColor: colors.primary + "18" }]}><Ionicons name={p.icon} size={24} color={colors.primary} /></View>
                  <Text accessibilityRole="header" style={{ color: colors.text, fontSize: tokens.fontSize.lg * k, fontWeight: tokens.weight.bold }}>{p.title}</Text>
                  <Text style={{ color: colors.muted, fontSize: tokens.fontSize.md * k, lineHeight: 23 * k }}>{p.body}</Text>
                </Card></FadeIn>
              ))}
            </View>
          </View>
        </View>

        {/* How it works */}
        <View style={s.band} {...mark("how")}>
          <View style={s.inner}>
            <Heading>How it works</Heading>
            <View style={[s.grid, { flexDirection: wide ? "row" : "column" }]}>
              {STEPS.map((st, i) => (
                <FadeIn key={st.title} delay={100 * i} distance={12} style={{ flex: 1, gap: 8 }}>
                  <Text style={{ color: colors.accent, fontSize: 28 * k, fontWeight: tokens.weight.heavy }}>{String(i + 1).padStart(2, "0")}</Text>
                  <Text accessibilityRole="header" style={{ color: colors.text, fontSize: tokens.fontSize.lg * k, fontWeight: tokens.weight.bold }}>{st.title}</Text>
                  <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k, lineHeight: 21 * k }}>{st.body}</Text>
                </FadeIn>
              ))}
            </View>
          </View>
        </View>

        {/* Choose a path */}
        <View style={[s.band, { backgroundColor: colors.surface }]} {...mark("path")}>
          <View style={s.inner}>
            <Heading sub="Pick the one that fits best today. It only shapes your setup; you can change it later.">How would you like to use shoRDs?</Heading>
            <PersonaPicker value={path} onChange={choose} />
            <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center", flexWrap: "wrap", marginTop: spacing.lg }}>
              <Button label={path ? "Continue" : "Choose an option to continue"} disabled={!path} iconRight="arrow-forward" onPress={start} />
              <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k }}>Already have an account? </Text>
              <Pressable onPress={() => router.push("/auth" as never)} accessibilityRole="link" hitSlop={8}><Text style={{ color: colors.accent, fontWeight: tokens.weight.bold, fontSize: tokens.fontSize.sm * k }}>Sign in</Text></Pressable>
            </View>
          </View>
        </View>

        {/* Community */}
        <View style={s.band} {...mark("community")}>
          <View style={[s.inner, wide && { flexDirection: "row", gap: 64, alignItems: "flex-start" }]}>
            <View style={{ flex: 1 }}>
              <Heading sub="A community for people who read and do research: students looking for guidance, mentors offering it, and researchers and professors exchanging ideas.">Research is better with people</Heading>
            </View>
            <View style={{ flex: 1, gap: spacing.md }}>
              {([
                ["shield-checkmark-outline", "Verified mentors", "Mentors apply with their institution, designation and expertise. A shoRDs administrator reviews each application before anyone is listed as verified."],
                ["chatbubbles-outline", "Private conversations", "Accepted mentorships open a private conversation. Messages refresh every few seconds; they are not instant."],
                ["lock-closed-outline", "Your details stay yours", "Your email address is never shown on your profile, and you decide whether strangers can message you."]
              ] as [IconName, string, string][]).map(([ic, t, b]) => (
                <View key={t} style={{ flexDirection: "row", gap: 14 }}>
                  <View style={[s.icon, { backgroundColor: colors.accent + "18" }]}><Ionicons name={ic} size={22} color={colors.accent} /></View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: colors.text, fontWeight: tokens.weight.bold, fontSize: tokens.fontSize.md * k }}>{t}</Text>
                    <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k, lineHeight: 21 * k }}>{b}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Features */}
        <View style={[s.band, { backgroundColor: colors.surface }]} {...mark("features")}>
          <View style={s.inner}>
            <Heading>Inside shoRDs</Heading>
            <View style={[s.grid, { flexDirection: wide ? "row" : "column", flexWrap: "wrap" }]}>
              {FEATURES.map((f) => (
                <Card key={f.title} style={{ flexBasis: wide ? "48%" : "100%", flexGrow: 1, gap: spacing.sm, padding: spacing.lg }}>
                  <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                    <View style={[s.icon, { backgroundColor: colors.primary + "18" }]}><Ionicons name={f.icon} size={22} color={colors.primary} /></View>
                    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: tokens.fontSize.lg * k, fontWeight: tokens.weight.bold, flex: 1 }}>{f.title}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: tokens.fontSize.md * k, lineHeight: 23 * k }}>{f.body}</Text>
                  {f.note ? <Text style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k }}>{f.note}</Text> : null}
                </Card>
              ))}
            </View>
          </View>
        </View>

        {/* About + footer */}
        <View style={[s.band, { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.xl }]} {...mark("about")}>
          <View style={[s.inner, { gap: spacing.lg }]}>
            <View style={{ flexDirection: wide ? "row" : "column", justifyContent: "space-between", gap: spacing.lg }}>
              <View style={{ maxWidth: 420, gap: 8 }}>
                <Logo showName inline />
                <Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k, lineHeight: 21 * k }}>About shoRDs: a research reading and community platform built to make papers easier to understand and easier to talk about.</Text>
              </View>
              <View style={{ gap: 8 }}>
                <Text style={{ color: colors.text, fontWeight: tokens.weight.bold, fontSize: tokens.fontSize.sm * k }}>Product</Text>
                {navLinks.map((n) => <Pressable key={n.label} onPress={() => goto(n.key)} accessibilityRole="link"><Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k }}>{n.label}</Text></Pressable>)}
                <Pressable onPress={() => router.push("/auth" as never)} accessibilityRole="link"><Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k }}>Sign in</Text></Pressable>
              </View>
              <View style={{ gap: 8 }}>
                <Text style={{ color: colors.text, fontWeight: tokens.weight.bold, fontSize: tokens.fontSize.sm * k }}>Contact and legal</Text>
                {site.contactEmail ? <Pressable onPress={() => void Linking.openURL(`mailto:${site.contactEmail}`)} accessibilityRole="link"><Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k }}>{site.contactEmail}</Text></Pressable> : null}
                {site.privacyUrl ? <Pressable onPress={() => void Linking.openURL(site.privacyUrl!)} accessibilityRole="link"><Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k }}>Privacy policy</Text></Pressable> : null}
                {site.termsUrl ? <Pressable onPress={() => void Linking.openURL(site.termsUrl!)} accessibilityRole="link"><Text style={{ color: colors.muted, fontSize: tokens.fontSize.sm * k }}>Terms of use</Text></Pressable> : null}
                {!site.privacyUrl && !site.termsUrl ? <Text style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k, maxWidth: 260 }}>The privacy policy and terms of use have not been published yet.</Text> : null}
                {site.socials.length > 0 ? (
                  <View style={{ flexDirection: "row", gap: 14, marginTop: 4 }}>
                    {site.socials.map((so) => <Pressable key={so.label} onPress={() => void Linking.openURL(so.url)} accessibilityRole="link" accessibilityLabel={so.label} hitSlop={8}><Ionicons name={so.icon} size={20} color={colors.muted} /></Pressable>)}
                  </View>
                ) : null}
              </View>
            </View>
            <Text style={{ color: colors.subdued, fontSize: tokens.fontSize.xs * k }}>© {new Date().getFullYear()} shoRDs</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  nav: { borderBottomWidth: 1, zIndex: 50 },
  navInner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", maxWidth: 1180, width: "100%", alignSelf: "center", paddingHorizontal: spacing.md, minHeight: 64, gap: spacing.md },
  menuBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  band: { paddingVertical: spacing.xxl, paddingHorizontal: spacing.md },
  inner: { maxWidth: 1180, width: "100%", alignSelf: "center" },
  grid: { gap: spacing.md },
  icon: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" }
});
