import AsyncStorage from "@react-native-async-storage/async-storage";
import { UserProfile } from "@/types/models";

const FREE_LIMIT_KEY = "shords.freeViewsCount";
const FREE_LIMIT_MAX = 5;

export type SubscriptionDetails = {
  tier: "free" | "premium";
  expiresAt: string;
  currency: "USD" | "INR";
};

export const PRICING_PLANS = {
  USD: {
    monthly: { price: 4.99, label: "$4.99 / Month", symbol: "$" },
    yearly: { price: 49.99, label: "$49.99 / Year", symbol: "$" }
  },
  INR: {
    monthly: { price: 299, label: "₹299 / Month", symbol: "₹" },
    yearly: { price: 2999, label: "₹2999 / Year", symbol: "₹" }
  }
};

export async function getCurrentUser(): Promise<UserProfile | null> {
  const val = await AsyncStorage.getItem("shords.currentUser");
  if (!val) return null;
  try {
    return JSON.parse(val) as UserProfile;
  } catch {
    return null;
  }
}

export async function isSubscribed(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  if (user.role === "admin" || user.role === "mentor") return true; // Admins and Mentors have full access
  if (!user.subscription) return false;
  
  if (user.subscription.tier === "premium") {
    const expires = new Date(user.subscription.expiresAt).getTime();
    if (expires > Date.now()) {
      return true;
    }
  }
  return false;
}

export async function getFreeViewsCount(): Promise<number> {
  const val = await AsyncStorage.getItem(FREE_LIMIT_KEY);
  if (!val) return 0;
  return parseInt(val, 10) || 0;
}

export async function hasFreeViewsRemaining(): Promise<boolean> {
  const subscribed = await isSubscribed();
  if (subscribed) return true;
  const count = await getFreeViewsCount();
  return count < FREE_LIMIT_MAX;
}

export async function incrementFreeViews(): Promise<{ count: number; allowed: boolean }> {
  const subscribed = await isSubscribed();
  if (subscribed) {
    return { count: 0, allowed: true };
  }
  const currentCount = await getFreeViewsCount();
  const nextCount = currentCount + 1;
  await AsyncStorage.setItem(FREE_LIMIT_KEY, String(nextCount));
  return {
    count: nextCount,
    allowed: nextCount <= FREE_LIMIT_MAX
  };
}

export async function purchaseSubscription(period: "monthly" | "yearly"): Promise<UserProfile | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const isIndia = user.phoneNumber?.startsWith("+91") || user.country === "India";
  const currency = isIndia ? "INR" : "USD";
  
  // Expiration date
  const durationDays = period === "monthly" ? 30 : 365;
  const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  const updatedUser: UserProfile = {
    ...user,
    subscription: {
      tier: "premium",
      expiresAt,
      currency
    }
  };

  await AsyncStorage.setItem("shords.currentUser", JSON.stringify(updatedUser));
  return updatedUser;
}

export async function cancelSubscription(): Promise<UserProfile | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const updatedUser: UserProfile = {
    ...user,
    subscription: undefined
  };

  await AsyncStorage.setItem("shords.currentUser", JSON.stringify(updatedUser));
  return updatedUser;
}
