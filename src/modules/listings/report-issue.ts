import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';

const ISSUE_CATEGORIES = [
  'stale_availability',
  'incorrect_price',
  'incorrect_photos',
  'incorrect_address',
  'scam_suspected',
  'other_non_sensitive',
] as const;

export type ListingIssueCategory = (typeof ISSUE_CATEGORIES)[number];

export function isListingIssueCategory(v: string): v is ListingIssueCategory {
  return (ISSUE_CATEGORIES as readonly string[]).includes(v);
}

/**
 * Renter/public report of listing freshness or accuracy issues.
 * Audited domain event only — does not auto-unpublish.
 */
export async function reportListingIssue(
  client: DbClient,
  input: {
    listingId: string;
    reporterPartyId: string | null;
    category: ListingIssueCategory;
    note?: string | null;
  },
): Promise<{ ok: true; listing_id: string }> {
  if (!isListingIssueCategory(input.category)) {
    throw new AppError('invalid issue category', 'validation_error', 400);
  }
  const { rows } = await client.query<{ id: string; org_id: string; status: string }>(
    `select id, org_id, status from listing where id = $1`,
    [input.listingId],
  );
  if (!rows[0]) throw new AppError('listing not found', 'listing_not_found', 404);

  await emitDomainEvent(client, {
    aggregateType: 'listing',
    aggregateId: input.listingId,
    eventType: 'listing.issue_reported',
    payload: {
      category: input.category,
      note: input.note?.slice(0, 500) ?? null,
      reporter_party_id: input.reporterPartyId,
      listing_status: rows[0].status,
      // [PLACEHOLDER] ops triage SLA — business decision
    },
    actorPartyId: input.reporterPartyId ?? undefined,
    actorKind: input.reporterPartyId ? 'user' : 'system',
  });

  return { ok: true, listing_id: input.listingId };
}

export async function confirmListingFreshness(
  client: DbClient,
  input: { listingId: string; orgId: string; actorPartyId: string },
): Promise<{ id: string; last_confirmed_at: string }> {
  const { rows } = await client.query<{ id: string; last_confirmed_at: Date }>(
    `update listing
     set last_confirmed_at = now()
     where id = $1 and org_id = $2
     returning id, last_confirmed_at`,
    [input.listingId, input.orgId],
  );
  if (!rows[0]) throw new AppError('listing not found', 'listing_not_found', 404);
  await emitDomainEvent(client, {
    aggregateType: 'listing',
    aggregateId: input.listingId,
    eventType: 'listing.freshness_confirmed',
    payload: {},
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });
  return {
    id: rows[0].id,
    last_confirmed_at: rows[0].last_confirmed_at.toISOString(),
  };
}
