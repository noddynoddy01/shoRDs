import { ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, ViewStyle } from "react-native";
import { tokens } from "@/constants/theme";

/** True when the person has asked their system for reduced motion. Every animation in the UI kit checks this and renders its final state at once. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (live) setReduced(!!v); }).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => setReduced(!!v));
    let mq: MediaQueryList | null = null;
    const onMq = (e: MediaQueryListEvent) => setReduced(e.matches);
    if (Platform.OS === "web" && typeof window !== "undefined" && typeof window.matchMedia === "function") {
      mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      setReduced((r) => r || mq!.matches);
      if (mq.addEventListener) mq.addEventListener("change", onMq);
    }
    return () => { live = false; sub?.remove?.(); if (mq && mq.removeEventListener) mq.removeEventListener("change", onMq); };
  }, []);
  return reduced;
}

/** Fades and lifts its children in once. `delay` staggers siblings. No motion when reduced. */
export function FadeIn({ children, delay = 0, distance = 8, style }: { children: ReactNode; delay?: number; distance?: number; style?: ViewStyle }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) { v.setValue(1); return; }
    Animated.timing(v, { toValue: 1, duration: tokens.motion.slow, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduced, delay, v]);
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] }]}>{children}</Animated.View>;
}

/** A looping 0..1 value for skeleton shimmer; stays at a steady mid value when reduced. */
export function usePulse(): Animated.Value {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (reduced) { v.setValue(0.5); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.4, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced, v]);
  return v;
}

/** A slow, gentle vertical drift for hero illustrations. Static when reduced. */
export function Float({ children, amplitude = 6, period = 3400, style }: { children: ReactNode; amplitude?: number; period?: number; style?: ViewStyle }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) { v.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: period, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: period, easing: Easing.inOut(Easing.sin), useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced, period, v]);
  return <Animated.View style={[style, { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -amplitude] }) }] }]}>{children}</Animated.View>;
}

/** A bar that eases to `fraction` (0..1) of its track whenever the value changes; jumps straight there when reduced. */
export function GrowBar({ fraction, color, track, height = 4, radius = 2 }: { fraction: number; color: string; track: string; height?: number; radius?: number }) {
  const reduced = useReducedMotion();
  const f = Math.max(0, Math.min(1, fraction));
  const v = useRef(new Animated.Value(reduced ? f : 0)).current;
  useEffect(() => {
    if (reduced) { v.setValue(f); return; }
    Animated.timing(v, { toValue: f, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [f, reduced, v]);
  return (
    <Animated.View style={{ flex: 1, height, borderRadius: radius, backgroundColor: track, overflow: "hidden" }}>
      <Animated.View style={{ height, borderRadius: radius, backgroundColor: color, width: v.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} />
    </Animated.View>
  );
}

/** Style fragment that makes hover, press and focus changes ease on the web (ignored on native). */
export const webTransition = (Platform.OS === "web" ? { transitionProperty: "transform, border-color, background-color, opacity", transitionDuration: "160ms", transitionTimingFunction: "ease-out" } : {}) as unknown as ViewStyle;
