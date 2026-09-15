import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';

const STALE_AFTER_DAYS = 14;
const EXPIRE_AFTER_DAYS = 21;

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Advance listing lifecycle based on last_confirmed_at vs injectable clock.
 * active → stale @ 14d; stale → expired @ 21d from last_confirmed_at.
 */
export async function runListingLifecycle(
  client: DbClient,
  clock: Clock = systemClock,
): Promise<{ stale: number; expired: number }> {
  const now = clock.now();
  const staleBefore = addDays(now, -STALE_AFTER_DAYS);
  const expireBefore = addDays(now, -EXPIRE_AFTER_DAYS);

  const { rows: toStale } = await client.query<{ id: string; status: string }>(
    `select id, status from listing
     where status = 'active' and last_confirmed_at <= $1
     for update`,
    [staleBefore],
  );

  for (const row of toStale) {
    await client.query(
      `update listing set status = 'stale', stale_at = $2 where id = $1`,
      [row.id, now],
    );
    await emitDomainEvent(client, {
      aggregateType: 'listing',
      aggregateId: row.id,
      eventType: 'listing.status_changed',
      payload: { from: 'active', to: 'stale' },
      actorKind: 'system',
      occurredAt: now,
    });
  }

  const { rows: toExpire } = await client.query<{ id: string; status: string }>(
    `select id, status from listing
     where status = 'stale' and last_confirmed_at <= $1
     for update`,
    [expireBefore],
  );

  for (const row of toExpire) {
    await client.query(
      `update listing set status = 'expired', expires_at = $2 where id = $1`,
      [row.id, now],
    );
    await emitDomainEvent(client, {
      aggregateType: 'listing',
      aggregateId: row.id,
      eventType: 'listing.status_changed',
      payload: { from: 'stale', to: 'expired' },
      actorKind: 'system',
      occurredAt: now,
    });
  }

  return { stale: toStale.length, expired: toExpire.length };
}

export async function confirmListing(
  client: DbClient,
  listingId: string,
  clock: Clock = systemClock,
): Promise<void> {
  const now = clock.now();
  const { rows } = await client.query<{ status: string }>(
    `select status from listing where id = $1 for update`,
    [listingId],
  );
  const row = rows[0];
  if (!row) throw new AppError('listing not found', 'listing_not_found', 404);

  const from = row.status;
  if (['rented', 'removed', 'archived'].includes(from)) {
    throw new AppError(
      `cannot confirm listing in status ${from}`,
      'listing_invalid_transition',
      409,
    );
  }

  await client.query(
    `update listing
     set last_confirmed_at = $2,
         status = case when status in ('stale','expired') then 'active' else status end,
         stale_at = null,
         expires_at = null
     where id = $1`,
    [listingId, now],
  );

  if (from === 'stale' || from === 'expired') {
    await emitDomainEvent(client, {
      aggregateType: 'listing',
      aggregateId: listingId,
      eventType: 'listing.status_changed',
      payload: { from, to: 'active' },
      actorKind: 'user',
      occurredAt: now,
    });
  }
}
