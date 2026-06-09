import { useMemo } from "react";
import { Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const TAB_BAR_BASE = 66;
const HOME_HEADER = 58;

export function useFeedMetrics() {
  const insets = useSafeAreaInsets();
  const windowHeight = Dimensions.get("window").height;

  return useMemo(() => {
    const tabBarHeight = TAB_BAR_BASE + Math.max(insets.bottom, 8);
    const reelHeight = windowHeight - insets.top - tabBarHeight - HOME_HEADER;

    return {
      tabBarHeight,
      reelHeight,
      contentBottomPadding: tabBarHeight + 12,
      homeHeaderHeight: HOME_HEADER
    };
  }, [insets.bottom, insets.top, windowHeight]);
}
