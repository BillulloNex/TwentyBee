/* TwentyBee: all entitlements unlocked for self-hosted fork */

export const isEntitlementActive = ({
  hasValidEnterprisePlan: _hasValidEnterprisePlan,
  isBillingEnabled: _isBillingEnabled,
  stripeEntitlementValue: _stripeEntitlementValue,
}: {
  hasValidEnterprisePlan: boolean;
  isBillingEnabled: boolean;
  stripeEntitlementValue: boolean;
}): boolean => true;
