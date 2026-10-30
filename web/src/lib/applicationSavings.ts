/**
 * Compares disclosed per-home application fees with one Dwel charge.
 * Cashback and rent are not inputs. A null result means the estimate is incomplete.
 */
export interface SavingsCandidate {
  listingId: string;
  eligibleForReuse: boolean;
  applicationFeeCents: number | null;
}

export interface SavingsEstimate {
  eligibleHomes: number;
  baselineFeesCents: number;
  dwelFeesCents: number;
  estimatedSavingsCents: number;
  completeEstimate: boolean;
}

export function calculateApplicationSavings(
  candidates: readonly SavingsCandidate[],
  dwelTotalFeeCents: number | null,
): SavingsEstimate | null {
  if (
    dwelTotalFeeCents === null ||
    !Number.isSafeInteger(dwelTotalFeeCents) ||
    dwelTotalFeeCents < 0
  ) {
    return null;
  }

  const unique = new Map<string, SavingsCandidate>();
  for (const candidate of candidates) {
    if (!candidate.eligibleForReuse) continue;
    if (!candidate.listingId) continue;
    unique.set(candidate.listingId, candidate);
  }

  const homes = [...unique.values()];
  if (homes.length === 0) return null;

  if (
    homes.some(
      (home) =>
        home.applicationFeeCents === null ||
        !Number.isSafeInteger(home.applicationFeeCents) ||
        home.applicationFeeCents < 0,
    )
  ) {
    return null;
  }

  const baselineFeesCents = homes.reduce((sum, home) => sum + (home.applicationFeeCents ?? 0), 0);
  if (!Number.isSafeInteger(baselineFeesCents)) return null;

  return {
    eligibleHomes: homes.length,
    baselineFeesCents,
    dwelFeesCents: dwelTotalFeeCents,
    estimatedSavingsCents: Math.max(0, baselineFeesCents - dwelTotalFeeCents),
    completeEstimate: true,
  };
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
