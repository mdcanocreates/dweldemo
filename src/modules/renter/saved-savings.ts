import type { DbClient } from '../../db/pool.js';
import {
  calculateApplicationSavings,
  type SavingsEstimate,
} from './application-savings.js';
import { screeningFeeForState } from './screening-fee.js';

/**
 * Saved-heart driven estimate. Uses only listings that explicitly accept reusable
 * applications and have a disclosed application fee. Missing data yields null.
 */
export async function estimateSavedApplicationSavings(
  client: DbClient,
  partyId: string,
  stateHint: string | null = null,
): Promise<{ estimate: SavingsEstimate | null; eligibleSaved: number; savedCount: number }> {
  const { rows } = await client.query<{
    listing_id: string;
    application_fee_cents: number | null;
    reusable_application_eligible: boolean;
  }>(
    `select l.id as listing_id,
            l.application_fee_cents,
            coalesce(l.reusable_application_eligible, false) as reusable_application_eligible
     from saved_listing sl
     join listing l on l.id = sl.listing_id
     where sl.party_id = $1`,
    [partyId],
  );

  const fee = await screeningFeeForState(client, stateHint);
  const estimate = calculateApplicationSavings(
    rows.map((row) => ({
      listingId: row.listing_id,
      eligibleForReuse: row.reusable_application_eligible,
      applicationFeeCents: row.application_fee_cents,
    })),
    fee.amount_cents,
  );

  return {
    estimate,
    eligibleSaved: rows.filter((row) => row.reusable_application_eligible).length,
    savedCount: rows.length,
  };
}
