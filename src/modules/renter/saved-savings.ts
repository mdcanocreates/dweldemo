import type { DbClient } from '../../db/pool.js';
import {
  calculateApplicationSavings,
  type SavingsEstimate,
} from './application-savings.js';
import { resolveRenterApplicationProduct } from './application-product.js';

/**
 * Saved-heart driven estimate. Subtracts the single $49 Dwel application product
 * from disclosed fees on reusable-eligible saved homes only. Provider listing fees
 * are never included. Missing fee data yields null (never a fabricated $0).
 */
export async function estimateSavedApplicationSavings(
  client: DbClient,
  partyId: string,
  _stateHint: string | null = null,
): Promise<{
  estimate: SavingsEstimate | null;
  eligibleSaved: number;
  savedCount: number;
  dwelApplicationFeeCents: number;
}> {
  const { rows } = await client.query<{
    listing_id: string;
    application_fee_cents: number | null;
    reusable_application_eligible: boolean;
    inventory_kind: string | null;
  }>(
    `select l.id as listing_id,
            l.application_fee_cents,
            coalesce(l.reusable_application_eligible, false) as reusable_application_eligible,
            coalesce(l.inventory_kind, 'partner') as inventory_kind
     from saved_listing sl
     join listing l on l.id = sl.listing_id
     where sl.party_id = $1`,
    [partyId],
  );

  const product = await resolveRenterApplicationProduct(client);
  const eligibleRows = rows.filter(
    (row) =>
      row.reusable_application_eligible &&
      row.inventory_kind !== 'directory' &&
      row.inventory_kind !== 'demo',
  );
  const estimate = calculateApplicationSavings(
    eligibleRows.map((row) => ({
      listingId: row.listing_id,
      eligibleForReuse: true,
      applicationFeeCents: row.application_fee_cents,
    })),
    product.amount_cents,
  );

  return {
    estimate,
    eligibleSaved: eligibleRows.length,
    savedCount: rows.length,
    dwelApplicationFeeCents: product.amount_cents,
  };
}
