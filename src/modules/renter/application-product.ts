import type { DbClient } from '../../db/pool.js';
import { resolveConfig } from '../config/index.js';

export type RenterApplicationProduct = {
  amount_cents: number;
  currency: string;
  billing: 'one_time_reusable';
  label: string;
};

const FALLBACK: RenterApplicationProduct = {
  amount_cents: 4900,
  currency: 'usd',
  billing: 'one_time_reusable',
  label: 'Dwel reusable application',
};

/**
 * Authoritative one-time renter application price.
 * Never confuse with provider_access_plan.amount_cents.
 */
export async function resolveRenterApplicationProduct(
  client: DbClient,
  at = new Date(),
): Promise<RenterApplicationProduct> {
  try {
    const cfg = await resolveConfig(client, 'dwel_renter_application_product', at);
    const payload = (cfg ?? {}) as Partial<RenterApplicationProduct>;
    const amount = Number(payload.amount_cents ?? FALLBACK.amount_cents);
    if (!Number.isSafeInteger(amount) || amount <= 0) return FALLBACK;
    return {
      amount_cents: amount,
      currency: String(payload.currency ?? FALLBACK.currency),
      billing: 'one_time_reusable',
      label: String(payload.label ?? FALLBACK.label),
    };
  } catch {
    return FALLBACK;
  }
}
