import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { createNotification } from '../notifications/index.js';
import { AppError } from '../shared/errors.js';
import { systemClock, type Clock } from '../shared/clock.js';

const EMAIL_HMAC_SECRET =
  process.env.RBIT_NOTIFY_HMAC_SECRET ?? 'rbit-dev-notify-hmac-not-for-prod';

const alertEmailBuckets = new Map<string, number[]>();

export function resetSearchAlertRateLimit(): void {
  alertEmailBuckets.clear();
}

export function emailHmac(email: string): Buffer {
  return createHmac('sha256', EMAIL_HMAC_SECRET)
    .update(email.normalize('NFKC').toLowerCase())
    .digest();
}

function assertAlertRateLimit(emailKey: string, nowMs: number): void {
  const dayMs = 86_400_000;
  let stamps = alertEmailBuckets.get(emailKey) ?? [];
  stamps = stamps.filter((t) => nowMs - t < dayMs);
  if (stamps.length >= 3) {
    alertEmailBuckets.set(emailKey, stamps);
    throw new AppError('alert rate limit exceeded', 'search_alert_rate_limited', 429);
  }
  stamps.push(nowMs);
  alertEmailBuckets.set(emailKey, stamps);
}

export type CreateSearchAlertInput = {
  partyId?: string | null;
  email?: string | null;
  submarketId?: string | null;
  bedroomsMin?: number | null;
  rentMaxCents?: number | null;
  moveInBy?: string | null;
  hasPets?: boolean | null;
  clock?: Clock;
};

export async function createSearchAlert(
  client: DbClient,
  input: CreateSearchAlertInput,
): Promise<{
  alertId: string;
  confirmationRequired: boolean;
  confirmationEmailQueued: boolean;
}> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();

  if (!input.partyId && !input.email) {
    throw new AppError('party or email required', 'bad_request', 400);
  }

  const hmac = input.email ? emailHmac(input.email) : null;
  const rateKey = input.partyId ?? hmac!.toString('hex');
  assertAlertRateLimit(rateKey, now.getTime());

  const id = randomUUID();
  const unsub = randomBytes(24).toString('base64url');
  const confirm = input.partyId ? null : randomBytes(24).toString('base64url');

  // Unauthenticated inserts need bypass for RLS; authenticated use party bind.
  if (!input.partyId) {
    await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
  } else {
    await client.query(`select set_config('rbit.current_party_id', $1, true)`, [
      input.partyId,
    ]);
  }

  await client.query(
    `insert into search_alert (
       id, party_id, email_hmac, confirm_token, confirmed_at,
       submarket_id, bedrooms_min, rent_max_cents, move_in_by, has_pets,
       is_active, unsubscribe_token, created_at
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       $11,$12,$13
     )`,
    [
      id,
      input.partyId ?? null,
      hmac,
      confirm,
      input.partyId ? now : null,
      input.submarketId ?? null,
      input.bedroomsMin ?? null,
      input.rentMaxCents ?? null,
      input.moveInBy ?? null,
      input.hasPets ?? null,
      Boolean(input.partyId), // unauth inactive until confirm
      unsub,
      now,
    ],
  );

  let confirmationEmailQueued = false;
  if (!input.partyId && input.email) {
    // Queue confirmation via notification stub (party optional — use system archive)
    confirmationEmailQueued = true;
    await emitDomainEvent(client, {
      aggregateType: 'search_alert',
      aggregateId: id,
      eventType: 'search_alert.confirmation_sent',
      payload: { email_hmac_prefix: hmac!.subarray(0, 4).toString('hex') },
      actorKind: 'system',
      occurredAt: now,
    });
  }

  if (!input.partyId) {
    await client.query(`select set_config('rbit.bypass_rls', 'off', true)`);
  }

  await emitDomainEvent(client, {
    aggregateType: 'search_alert',
    aggregateId: id,
    eventType: 'search_alert.created',
    payload: {
      party_id: input.partyId ?? null,
      authenticated: Boolean(input.partyId),
    },
    actorPartyId: input.partyId ?? undefined,
    actorKind: input.partyId ? 'user' : 'system',
    occurredAt: now,
  });

  return {
    alertId: id,
    confirmationRequired: !input.partyId,
    confirmationEmailQueued,
  };
}

export async function confirmSearchAlert(
  client: DbClient,
  token: string,
): Promise<void> {
  await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
  const { rows } = await client.query<{ id: string }>(
    `update search_alert
     set is_active = true, confirmed_at = now(), confirm_token = null
     where confirm_token = $1
     returning id`,
    [token],
  );
  await client.query(`select set_config('rbit.bypass_rls', 'off', true)`);
  if (!rows[0]) throw new AppError('invalid confirm token', 'not_found', 404);
}

export async function unsubscribeSearchAlert(
  client: DbClient,
  unsubscribeToken: string,
): Promise<void> {
  await client.query(`select set_config('rbit.search_alert_unsub_token', $1, true)`, [
    unsubscribeToken,
  ]);
  const { rows } = await client.query<{ id: string }>(
    `update search_alert
     set is_active = false, unsubscribed_at = now()
     where unsubscribe_token = $1
     returning id`,
    [unsubscribeToken],
  );
  if (!rows[0]) {
    // try with bypass for token-only path
    await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
    const r2 = await client.query<{ id: string }>(
      `update search_alert
       set is_active = false, unsubscribed_at = now()
       where unsubscribe_token = $1
       returning id`,
      [unsubscribeToken],
    );
    await client.query(`select set_config('rbit.bypass_rls', 'off', true)`);
    if (!r2.rows[0]) throw new AppError('not found', 'not_found', 404);
  }
}

/** Nightly matching job — only listings published since last_notified_at. */
export async function runSearchAlertMatchingJob(
  client: DbClient,
  clock: Clock = systemClock,
): Promise<{ notified: number }> {
  const now = clock.now();
  await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
  const { rows: alerts } = await client.query<{
    id: string;
    party_id: string | null;
    submarket_id: string | null;
    bedrooms_min: string | null;
    rent_max_cents: number | null;
    move_in_by: string | null;
    has_pets: boolean | null;
    last_notified_at: Date | null;
    match_count: number;
  }>(
    `select id, party_id, submarket_id, bedrooms_min::text, rent_max_cents,
            move_in_by::text, has_pets, last_notified_at, match_count
     from search_alert where is_active = true`,
  );

  let notified = 0;
  for (const a of alerts) {
    const since = a.last_notified_at ?? new Date(0);
    const params: unknown[] = [since];
    const where = [`l.status = 'active'`, `l.published_at > $1`];
    if (a.rent_max_cents != null) {
      params.push(a.rent_max_cents);
      where.push(`l.rent_amount_cents <= $${params.length}`);
    }
    if (a.bedrooms_min != null) {
      params.push(Number(a.bedrooms_min));
      where.push(`u.bedrooms >= $${params.length}`);
    }
    if (a.submarket_id) {
      params.push(a.submarket_id);
      where.push(`addr.submarket_id = $${params.length}`);
    }

    const { rows: matches } = await client.query<{ id: string }>(
      `select l.id
       from listing l
       join unit u on u.id = l.unit_id
       join property p on p.id = u.property_id
       join address addr on addr.id = p.address_id
       where ${where.join(' and ')}
       limit 50`,
      params,
    );

    if (matches.length === 0) continue;

    const newCount = a.match_count + matches.length;
    await client.query(
      `update search_alert
       set last_notified_at = $2, match_count = $3
       where id = $1`,
      [a.id, now, newCount],
    );

    if (a.party_id) {
      await createNotification(client, {
        recipientPartyId: a.party_id,
        channel: 'email',
        eventType: 'search_alert.matches',
        templateKey: 'search_alert_matches',
        payload: {
          match_count: matches.length,
          deep_link: `https://dwel.app/search/alerts/${a.id}`,
          soft_nudge_account: false,
        },
      });
    } else {
      await emitDomainEvent(client, {
        aggregateType: 'search_alert',
        aggregateId: a.id,
        eventType: 'search_alert.matches_notified',
        payload: {
          match_count: matches.length,
          soft_nudge_account: newCount >= 3,
        },
        actorKind: 'system',
        occurredAt: now,
      });
    }
    notified += 1;
  }

  await client.query(`select set_config('rbit.bypass_rls', 'off', true)`);
  return { notified };
}

/** Admin unmet demand — replica-oriented read. */
export async function getUnmetDemand(
  client: DbClient,
): Promise<
  Array<{
    submarket_id: string | null;
    bed_band: string;
    week: string;
    alert_count: number;
  }>
> {
  const { rows } = await client.query<{
    submarket_id: string | null;
    bed_band: string;
    week: string;
    alert_count: string;
  }>(
    `select submarket_id::text,
            coalesce(floor(bedrooms_min)::text, 'unknown') as bed_band,
            date_trunc('week', created_at)::date::text as week,
            count(*)::text as alert_count
     from search_alert
     where is_active = true and match_count = 0
     group by 1, 2, 3
     order by week desc`,
  );
  return rows.map((r) => ({
    submarket_id: r.submarket_id,
    bed_band: r.bed_band,
    week: r.week,
    alert_count: Number(r.alert_count),
  }));
}
