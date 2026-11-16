import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { breakpointFor, usesRail } from "../services/ui/breakpoints";

const TAB_BAR_BASE = 58;
const HOME_HEADER = 58;

/** Heights the research screens need to lay themselves out above the bottom bar. From laptop width up there is no bottom bar (the left rail is used), so it is 0. */
export function useFeedMetrics() {
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();
  const rail = usesRail(breakpointFor(width));

  return useMemo(() => {
    const tabBarHeight = rail ? 0 : TAB_BAR_BASE + Math.max(insets.bottom, 6);
    const reelHeight = windowHeight - insets.top - tabBarHeight - HOME_HEADER;
    return { tabBarHeight, reelHeight, contentBottomPadding: tabBarHeight + 16, homeHeaderHeight: HOME_HEADER };
  }, [insets.bottom, insets.top, windowHeight, rail]);
}
