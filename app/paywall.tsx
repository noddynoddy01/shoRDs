import { FeatureUnavailable } from "@/components/FeatureUnavailable";

/**
 * There is no payment provider and no entitlement endpoint yet, so there is nothing to buy. This screen therefore shows no
 * prices, no plan names and no "upgrade" button. (An earlier version advertised "$9.99 / month" and an "Upgrade Now" button.)
 */
export default function PaywallScreen() {
  return (
    <FeatureUnavailable
      title="Paid plans"
      description="Paid plans are not available yet. No payment can be taken and your account is not changed. Everything that is available today is available on the free plan."
    />
  );
}
