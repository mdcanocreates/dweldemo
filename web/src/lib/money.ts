/** Money helpers — integer cents only (rebuild.md §14). */

export function formatCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: dollars % 1 === 0 ? 0 : 2,
  }).format(dollars);
}

export type RsTier =
  | 'RS-1'
  | 'RS-2'
  | 'RS-3'
  | 'RS-4'
  | 'RS-5'
  | 'RS-6'
  | 'RS-7'
  | 'RS-8'
  | 'RS-9'
  | 'RS-10'
  | 'RS-11'
  | 'RS-12';

/** Rent bands from rebuild.md §8.1 — rent in integer cents. */
const RS_BANDS: Array<{ tier: RsTier; min: number; max: number | null }> = [
  { tier: 'RS-1', min: 80_000, max: 119_900 },
  { tier: 'RS-2', min: 120_000, max: 159_900 },
  { tier: 'RS-3', min: 160_000, max: 199_900 },
  { tier: 'RS-4', min: 200_000, max: 249_900 },
  { tier: 'RS-5', min: 250_000, max: 299_900 },
  { tier: 'RS-6', min: 300_000, max: 399_900 },
  { tier: 'RS-7', min: 400_000, max: 599_900 },
  { tier: 'RS-8', min: 600_000, max: 899_900 },
  { tier: 'RS-9', min: 900_000, max: 1_499_900 },
  { tier: 'RS-10', min: 1_500_000, max: 2_499_900 },
  { tier: 'RS-11', min: 2_500_000, max: 4_499_900 },
  { tier: 'RS-12', min: 4_500_000, max: null },
];

export function rsLookup(rentCents: number): RsTier {
  const clamped = Math.max(rentCents, 80_000);
  for (const band of RS_BANDS) {
    if (band.max == null) {
      if (clamped >= band.min) return band.tier;
    } else if (clamped >= band.min && clamped <= band.max) {
      return band.tier;
    }
  }
  return 'RS-12';
}

export type PricingCohort = 'COHORT_1' | 'COHORT_2' | 'COHORT_3';

export function cohortFromSequence(sequence: number): PricingCohort {
  if (sequence <= 50) return 'COHORT_1';
  if (sequence <= 250) return 'COHORT_2';
  return 'COHORT_3';
}

export function cohortLabel(cohort: PricingCohort): string {
  if (cohort === 'COHORT_1') return 'Founding';
  if (cohort === 'COHORT_2') return 'Early adopter';
  return 'Standard';
}

/** Launch states only (TX, CA, FL). */
export const LAUNCH_STATES = new Set(['TX', 'CA', 'FL']);

export function isLaunchState(stateCode: string): boolean {
  return LAUNCH_STATES.has(stateCode.trim().toUpperCase());
}
