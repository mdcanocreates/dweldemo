/**
 * Interim public cashback display estimate — mirrors
 * `src/modules/listings/public.ts` cashback_interim_v1.
 * Program rate: 20% of first month's rent (integer cents).
 * Use only when seeding fixtures / mirroring API demo data.
 * Never invent amounts in the render path when the listing field is absent.
 */
export const RENTER_CASHBACK_RATE = 0.2;

export function interimCashbackCents(rentCents: number): number {
  if (!Number.isFinite(rentCents) || rentCents <= 0) return 0;
  return Math.round(rentCents * RENTER_CASHBACK_RATE);
}
