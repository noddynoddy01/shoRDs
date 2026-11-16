import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "@/components/ui/motion";
import { useTheme } from "@/context/ThemeContext";

/**
 * The opening moment: the shoRDs mark settles in, the name and tagline follow, a thin bar fills while the session is being resolved, then the
 * whole layer fades away into whichever screen the route guard chose. It is shown once per page load, stays up for at least MIN_MS so it never
 * flashes, and never delays anything beyond that: it leaves as soon as the session is known (`ready`). With reduced motion it appears already
 * settled and leaves with a short fade.
 */
const MIN_MS = 1500;
let shownThisLoad = false;

export function SplashIntro({ ready }: { ready: boolean }) {
  const { colors, fontSizeScale: k } = useTheme();
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(!shownThisLoad);
  const [minDone, setMinDone] = useState(false);
  const mark = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const name = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const tag = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const bar = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const out = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setMinDone(true), reduced ? 500 : MIN_MS);
    if (!reduced) {
      Animated.sequence([
        Animated.timing(mark, { toValue: 1, duration: 650, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
        Animated.timing(name, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(tag, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      ]).start();
      Animated.timing(bar, { toValue: 1, duration: MIN_MS - 150, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start();
    }
    return () => clearTimeout(t);
  }, [visible, reduced, mark, name, tag, bar]);

  useEffect(() => {
    if (!visible || !ready || !minDone) return;
    shownThisLoad = true;
    Animated.timing(out, { toValue: 0, duration: reduced ? 120 : 420, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => setVisible(false));
  }, [visible, ready, minDone, reduced, out]);

  if (!visible) return null;
  const rise = (v: Animated.Value, d: number) => ({ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [d, 0] }) }] });
  return (
    <Animated.View
      accessibilityLabel="Loading shoRDs" accessibilityRole="progressbar" aria-busy
      style={[StyleSheet.absoluteFill, s.layer, { backgroundColor: colors.background, opacity: out }]}
      pointerEvents={ready && minDone ? "none" : "auto"}
    >
      <Animated.View style={{ opacity: mark, transform: [{ scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }] }}>
        <Image source={require("../assets/logo-ui-512.png")} resizeMode="contain" style={{ width: 180, height: 112 }} />
      </Animated.View>
      <Animated.Text style={[rise(name, 10), { color: colors.ink, fontSize: 34 * k, fontWeight: "800", letterSpacing: -0.6, marginTop: 14 }]}>shoRDs</Animated.Text>
      <Animated.View style={rise(tag, 8)}>
        <Text style={{ color: colors.muted, fontSize: 15 * k, marginTop: 6 }}>Read research. Find mentors. Learn together.</Text>
      </Animated.View>
      <View style={[s.track, { backgroundColor: colors.border }]}>
        <Animated.View style={{ height: 3, borderRadius: 2, backgroundColor: colors.primary, width: bar.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} />
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  layer: { alignItems: "center", justifyContent: "center", zIndex: 50 },
  track: { width: 160, height: 3, borderRadius: 2, marginTop: 28, overflow: "hidden" }
});
