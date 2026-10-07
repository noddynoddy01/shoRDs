/**
 * Subscription state for the shoRDs client.
 *
 * THE CLIENT IS NOT AUTHORITATIVE. There is no payment provider and no entitlement endpoint on the backend yet, so this module
 * can only ever report FREE. In particular:
 *   - nothing stored on the device (AsyncStorage, the local profile) is read as an entitlement,
 *   - no transaction id, token prefix or "success" callback produced on the device can move a user to ACTIVE,
 *   - nothing here changes server-side limits: the backend rate-limits and gates by the verified Firebase uid and the project
 *     role, and ignores any plan / pro / premium claim in a request (asserted by tests).
 * When billing exists, entitlement must come from an authenticated backend response (and be enforced there); the UI may only
 * display it.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export type SubscriptionState =
  | "FREE"
  | "CHECKOUT_STARTED"
  | "PAYMENT_PENDING"
  | "PAYMENT_CONFIRMED"
  | "ACTIVE"
  | "RENEWAL_PENDING"
  | "RENEWED"
  | "PAYMENT_FAILED"
  | "CANCELLED"
  | "EXPIRED"
  | "REFUNDED";

/** Set to true only when a real payment provider and a server-side entitlement endpoint exist. */
export const PURCHASES_AVAILABLE = false;

export const PAYMENTS_UNAVAILABLE_MESSAGE =
  "Paid plans are not available yet. No payment was taken and your account was not changed.";

/** Key used by earlier builds to store a self-declared subscription. It is deleted, never read. */
const LEGACY_SUBSCRIPTION_KEY = "shords_user_subscription_state";
const PROFILE_KEY = "shords.currentUser"; // display-only cache of the Firebase profile (see context/AuthContext.tsx)

export interface UserSubscription {
  isPro: boolean;
  status: SubscriptionState;
  planId?: string;
  plan?: string;
  expiresAt?: string;
}

async function dropLegacyClaim(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LEGACY_SUBSCRIPTION_KEY);
  } catch {
    /* best effort */
  }
}

/** Always FREE until a backend entitlement endpoint exists. Never reads device storage. No usage figures are invented. */
export async function getUserSubscriptionAsync(): Promise<UserSubscription> {
  await dropLegacyClaim();
  return { isPro: false, status: "FREE" };
}

/** The signed-in user's display profile (the cache synced from Firebase by AuthContext), or null when signed out. */
export async function getCurrentUser(): Promise<any> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const profile = JSON.parse(raw);
    return profile && typeof profile === "object" ? { ...profile, subscription: await getUserSubscriptionAsync() } : null;
  } catch {
    return null;
  }
}

export type PurchaseResult =
  | { ok: true }
  | { ok: false; reason: "PAYMENTS_UNAVAILABLE"; message: string };

/** There is no payment provider: this never upgrades anyone. */
export async function purchaseSubscription(_planId?: any): Promise<PurchaseResult> {
  return { ok: false, reason: "PAYMENTS_UNAVAILABLE", message: PAYMENTS_UNAVAILABLE_MESSAGE };
}

export async function upgradeToProAsync(planId: any = "shords_scholar_monthly"): Promise<PurchaseResult> {
  return purchaseSubscription(planId);
}

/** UI hint only. Never a security control: the server decides what a user may do. */
export function isSubscribed(_user?: any): boolean {
  return false;
}

/** The free-view counter is not enforced anywhere; public paper cards are not locked. */
export function hasFreeViewsRemaining(_user?: any): boolean {
  return true;
}
