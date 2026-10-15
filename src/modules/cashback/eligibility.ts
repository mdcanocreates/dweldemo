import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';

/** Display offer version only — not a funded program commitment. */
export const CASHBACK_DISPLAY_OFFER_VERSION = 'display_v1' as const;
/** 20% display rate for display_v1 — status architecture only. */
export const CASHBACK_DISPLAY_RATE_BPS = 2000;

export type CashbackEligibilityRow = {
  id: string;
  application_id: string;
  listing_id: string;
  party_id: string;
  org_id: string;
  offer_version: string;
  rate_bps: number;
  rent_basis_cents: number | null;
  amount_cents: number | null;
  status: string;
  ineligible_reason: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: {
  id: string;
  application_id: string;
  listing_id: string;
  party_id: string;
  org_id: string;
  offer_version: string;
  rate_bps: number;
  rent_basis_cents: number | null;
  amount_cents: number | null;
  status: string;
  ineligible_reason: string | null;
  created_at: Date;
  updated_at: Date;
}): CashbackEligibilityRow {
  return {
    id: row.id,
    application_id: row.application_id,
    listing_id: row.listing_id,
    party_id: row.party_id,
    org_id: row.org_id,
    offer_version: row.offer_version,
    rate_bps: row.rate_bps,
    rent_basis_cents: row.rent_basis_cents,
    amount_cents: row.amount_cents,
    status: row.status,
    ineligible_reason: row.ineligible_reason,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function getCashbackEligibility(
  client: DbClient,
  applicationId: string,
): Promise<CashbackEligibilityRow | null> {
  const { rows } = await client.query<{
    id: string;
    application_id: string;
    listing_id: string;
    party_id: string;
    org_id: string;
    offer_version: string;
    rate_bps: number;
    rent_basis_cents: number | null;
    amount_cents: number | null;
    status: string;
    ineligible_reason: string | null;
    created_at: Date;
    updated_at: Date;
  }>(`select * from cashback_eligibility where application_id = $1`, [applicationId]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listCashbackForParty(
  client: DbClient,
  partyId: string,
): Promise<CashbackEligibilityRow[]> {
  const { rows } = await client.query<{
    id: string;
    application_id: string;
    listing_id: string;
    party_id: string;
    org_id: string;
    offer_version: string;
    rate_bps: number;
    rent_basis_cents: number | null;
    amount_cents: number | null;
    status: string;
    ineligible_reason: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `select * from cashback_eligibility where party_id = $1 order by created_at desc`,
    [partyId],
  );
  return rows.map(mapRow);
}

/**
 * Create offered cashback eligibility row on approve.
 * Status architecture only — offered; does not invent funding/ledger entries.
 */
export async function ensureCashbackOfferedOnApprove(
  client: DbClient,
  input: {
    applicationId: string;
    listingId: string;
    partyId: string;
    orgId: string;
    actorPartyId: string;
  },
): Promise<CashbackEligibilityRow> {
  const existing = await getCashbackEligibility(client, input.applicationId);
  if (existing) return existing;

  const { rows: listing } = await client.query<{ rent_amount_cents: number }>(
    `select rent_amount_cents from listing where id = $1 and org_id = $2`,
    [input.listingId, input.orgId],
  );
  if (!listing[0]) throw new AppError('listing not found', 'listing_not_found', 404);

  const rent = listing[0].rent_amount_cents;
  const amountCents = Math.round((rent * CASHBACK_DISPLAY_RATE_BPS) / 10_000);

  const { rows } = await client.query<{
    id: string;
    application_id: string;
    listing_id: string;
    party_id: string;
    org_id: string;
    offer_version: string;
    rate_bps: number;
    rent_basis_cents: number | null;
    amount_cents: number | null;
    status: string;
    ineligible_reason: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `insert into cashback_eligibility (
       application_id, listing_id, party_id, org_id,
       offer_version, rate_bps, rent_basis_cents, amount_cents, status
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,'offered')
     on conflict (application_id) do update
       set updated_at = cashback_eligibility.updated_at
     returning *`,
    [
      input.applicationId,
      input.listingId,
      input.partyId,
      input.orgId,
      CASHBACK_DISPLAY_OFFER_VERSION,
      CASHBACK_DISPLAY_RATE_BPS,
      rent,
      amountCents,
    ],
  );
  const row = mapRow(rows[0]!);

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: input.applicationId,
    eventType: 'cashback.offered',
    payload: {
      cashback_eligibility_id: row.id,
      offer_version: row.offer_version,
      rate_bps: row.rate_bps,
      status: 'offered',
      // [PLACEHOLDER] Display offer only — counsel/finance must approve funded program
      legal_copy:
        '[PLACEHOLDER] Cashback display offer (display_v1). Not a funded payment commitment.',
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });

  return row;
}
