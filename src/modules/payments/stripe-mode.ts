/**
 * Stripe payment mode is independent of APP_ENV.
 * Unknown values fail closed. This release refuses live charges and real payouts
 * even when STRIPE_LIVE_PAYMENTS_APPROVED is set.
 */

export type StripePaymentMode = 'disabled' | 'test' | 'live';

export type StripeModeDecision = {
  mode: StripePaymentMode;
  invalid: boolean;
};

export function readStripePaymentMode(
  env: NodeJS.ProcessEnv = process.env,
): StripeModeDecision {
  const raw = (env.STRIPE_PAYMENT_MODE ?? 'disabled').trim().toLowerCase();
  if (raw === 'disabled' || raw === 'test' || raw === 'live') {
    return { mode: raw, invalid: false };
  }
  return { mode: 'disabled', invalid: true };
}

export function secretMatchesMode(secret: string, mode: StripePaymentMode): boolean {
  if (mode === 'test') return secret.startsWith('sk_test_');
  if (mode === 'live') return secret.startsWith('sk_live_');
  return false;
}

export function publishableMatchesMode(key: string, mode: StripePaymentMode): boolean {
  if (mode === 'test') return key.startsWith('pk_test_');
  if (mode === 'live') return key.startsWith('pk_live_');
  return false;
}

export function liveChargesApproved(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STRIPE_LIVE_PAYMENTS_APPROVED === 'true';
}

/** Real Stripe payouts and transfers stay disabled in this release. */
export function realPayoutsEnabled(): boolean {
  return false;
}
