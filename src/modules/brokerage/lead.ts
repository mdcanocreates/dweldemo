import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import { classifyLeadFee } from './price-book.js';

export type LeadRow = {
  id: string;
  applicationId: string;
  listingId: string;
  partyId: string;
  rsTier: string;
  classifierVersion: string;
  rentAmountCentsAtClass: number;
  priceBookVersion: string;
  feeAmountCents: number;
  status: string;
};

/**
 * Create + classify lead. Tier/fee/version snapshotted at creation (P4).
 */
export async function createAndClassifyLead(
  client: DbClient,
  input: {
    applicationId: string;
    listingId: string;
    partyId: string;
    rentAmountCents?: number;
    clock?: Clock;
  },
): Promise<LeadRow> {
  const clock = input.clock ?? systemClock;
  let rent = input.rentAmountCents;
  if (rent == null) {
    const { rows } = await client.query<{ rent_amount_cents: number }>(
      `select rent_amount_cents from listing where id = $1`,
      [input.listingId],
    );
    if (!rows[0]) throw new AppError('listing not found', 'LISTING_NOT_FOUND');
    rent = rows[0].rent_amount_cents;
  }

  const classified = await classifyLeadFee(client, rent, { clock });
  const id = randomUUID();

  await client.query(
    `insert into lead (
       id, application_id, listing_id, party_id,
       rs_tier, classifier_version, rent_amount_cents_at_class,
       price_book_version, fee_amount_cents, status, created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'classified',$10)`,
    [
      id,
      input.applicationId,
      input.listingId,
      input.partyId,
      classified.rsTier,
      classified.classifierVersion,
      classified.rentAmountCentsAtClass,
      classified.priceBookVersion,
      classified.feeAmountCents,
      clock.now(),
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'lead',
    aggregateId: id,
    eventType: 'lead.classified',
    payload: {
      rs_tier: classified.rsTier,
      fee_amount_cents: classified.feeAmountCents,
      price_book_version: classified.priceBookVersion,
      classifier_version: classified.classifierVersion,
      rent_amount_cents_at_class: classified.rentAmountCentsAtClass,
    },
    actorKind: 'system',
    occurredAt: clock.now(),
  });

  return {
    id,
    applicationId: input.applicationId,
    listingId: input.listingId,
    partyId: input.partyId,
    rsTier: classified.rsTier,
    classifierVersion: classified.classifierVersion,
    rentAmountCentsAtClass: classified.rentAmountCentsAtClass,
    priceBookVersion: classified.priceBookVersion,
    feeAmountCents: classified.feeAmountCents,
    status: 'classified',
  };
}

export async function getLead(
  client: DbClient,
  leadId: string,
): Promise<LeadRow | null> {
  const { rows } = await client.query<{
    id: string;
    application_id: string;
    listing_id: string;
    party_id: string;
    rs_tier: string;
    classifier_version: string;
    rent_amount_cents_at_class: number;
    price_book_version: string;
    fee_amount_cents: number;
    status: string;
  }>(
    `select id, application_id, listing_id, party_id, rs_tier, classifier_version,
            rent_amount_cents_at_class, price_book_version, fee_amount_cents, status
     from lead where id = $1`,
    [leadId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    applicationId: r.application_id,
    listingId: r.listing_id,
    partyId: r.party_id,
    rsTier: r.rs_tier,
    classifierVersion: r.classifier_version,
    rentAmountCentsAtClass: r.rent_amount_cents_at_class,
    priceBookVersion: r.price_book_version,
    feeAmountCents: r.fee_amount_cents,
    status: r.status,
  };
}

/** Broker UI display fee — must equal persisted fee_amount_cents. */
export function displayedFeeForLead(lead: LeadRow): number {
  return lead.feeAmountCents;
}
