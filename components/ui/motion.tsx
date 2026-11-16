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
