import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { resolveAuthSla } from '../config/index.js';
import {
  collectPayoutDestination,
  executePayout,
} from '../payments/index.js';
import { postLedgerTransaction } from '../ledger/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';

/**
 * Accrue screening rebate on placement.funded (NOT lease_signed).
 * One rebate per screening_order (unique constraint).
 */
export async function evaluateRebateOnFunded(
  client: DbClient,
  placementId: string,
  clock: Clock = systemClock,
): Promise<{ rebateId: string | null; created: boolean }> {
  const now = clock.now();
  const { rows: placements } = await client.query<{
    id: string;
    status: string;
    party_id: string;
    application_id: string;
    funded_at: Date | null;
  }>(
    `select id, status, party_id, application_id, funded_at
     from placement where id = $1 for update`,
    [placementId],
  );
  const placement = placements[0];
  if (!placement) throw new AppError('placement not found', 'placement_not_found', 404);
  if (placement.status !== 'funded') {
    return { rebateId: null, created: false };
  }

  // Find rebate-eligible screening order for this party linked to the application
  // Prefer order on this application; else most recent eligible order for party.
  const { rows: orders } = await client.query<{
    id: string;
    amount_charged_cents: number;
    is_rebate_eligible: boolean;
  }>(
    `select id, amount_charged_cents, is_rebate_eligible
     from screening_order
     where party_id = $1
       and is_rebate_eligible = true
       and status = 'complete'
       and (application_id = $2 or application_id is null)
     order by
       case when application_id = $2 then 0 else 1 end,
       created_at desc
     limit 1`,
    [placement.party_id, placement.application_id],
  );
  const order = orders[0];
  if (!order) return { rebateId: null, created: false };

  // Unique on screening_order_id — second app same order → no second rebate
  const existing = await client.query<{ id: string }>(
    `select id from screening_rebate where screening_order_id = $1`,
    [order.id],
  );
  if (existing.rows[0]) {
    return { rebateId: existing.rows[0].id, created: false };
  }

  const rebateId = randomUUID();
  const sla = await resolveAuthSla(client, now);
  const expiresAt = new Date(
    now.getTime() + sla.rebatePayoutDetailsTtlDays * 86400000,
  );
  try {
    await client.query(
      `insert into screening_rebate (
         id, screening_order_id, party_id, placement_id, amount_cents,
         status, eligible_at, expires_at
       ) values ($1,$2,$3,$4,$5,'eligible',$6,$7)`,
      [
        rebateId,
        order.id,
        placement.party_id,
        placementId,
        order.amount_charged_cents,
        now,
        expiresAt,
      ],
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      const again = await client.query<{ id: string }>(
        `select id from screening_rebate where screening_order_id = $1`,
        [order.id],
      );
      return { rebateId: again.rows[0]?.id ?? null, created: false };
    }
    throw err;
  }

  await emitDomainEvent(client, {
    aggregateType: 'screening_rebate',
    aggregateId: rebateId,
    eventType: 'screening_rebate.eligible',
    payload: {
      screening_order_id: order.id,
      placement_id: placementId,
      amount_cents: order.amount_charged_cents,
    },
    actorKind: 'system',
    occurredAt: now,
  });

  return { rebateId, created: true };
}

/**
 * Collect payout destination at rebate time (not intake) via shared payout rail (§7.8 / §13.6).
 */
export async function requestRebatePayoutDetails(
  client: DbClient,
  input: {
    rebateId: string;
    destinationToken: string;
    clock?: Clock;
  },
): Promise<{ payoutMethodRef: string }> {
  const clock = input.clock ?? systemClock;
  const { rows } = await client.query<{
    id: string;
    party_id: string;
    status: string;
  }>(`select id, party_id, status from screening_rebate where id = $1 for update`, [
    input.rebateId,
  ]);
  const rebate = rows[0];
  if (!rebate) throw new AppError('rebate not found', 'rebate_not_found', 404);
  if (rebate.status !== 'eligible' && rebate.status !== 'payout_details_requested') {
    throw new AppError(
      `cannot collect payout details in status=${rebate.status}`,
      'rebate_invalid_status',
      409,
    );
  }

  const { payoutMethodRef } = await collectPayoutDestination(client, {
    partyId: rebate.party_id,
    destinationToken: input.destinationToken,
    consumer: 'screening_rebate',
    consumerId: rebate.id,
    clock,
  });

  await client.query(
    `update screening_rebate
     set status = 'payout_details_requested', payout_method_ref = $2
     where id = $1`,
    [rebate.id, payoutMethodRef],
  );

  await emitDomainEvent(client, {
    aggregateType: 'screening_rebate',
    aggregateId: rebate.id,
    eventType: 'screening_rebate.payout_details_requested',
    payload: {},
    actorPartyId: rebate.party_id,
    actorKind: 'user',
    occurredAt: clock.now(),
  });

  return { payoutMethodRef };
}

/** Pay screening rebate via shared Stripe payout rail. */
export async function payScreeningRebate(
  client: DbClient,
  input: { rebateId: string; clock?: Clock },
): Promise<{ payoutId: string }> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const { rows } = await client.query<{
    id: string;
    party_id: string;
    status: string;
    amount_cents: number;
    payout_method_ref: string | null;
  }>(
    `select id, party_id, status, amount_cents, payout_method_ref
     from screening_rebate where id = $1 for update`,
    [input.rebateId],
  );
  const rebate = rows[0];
  if (!rebate) throw new AppError('rebate not found', 'rebate_not_found', 404);
  if (!rebate.payout_method_ref) {
    throw new AppError('payout details not collected', 'rebate_no_payout_method', 409);
  }

  await client.query(`update screening_rebate set status = 'processing' where id = $1`, [
    rebate.id,
  ]);

  const payout = await executePayout(client, {
    partyId: rebate.party_id,
    amountCents: rebate.amount_cents,
    payoutMethodRef: rebate.payout_method_ref,
    consumer: 'screening_rebate',
    consumerId: rebate.id,
    idempotencyKey: `rebate:payout:${rebate.id}`,
    clock,
  });

  if (payout.status !== 'paid') {
    await client.query(`update screening_rebate set status = 'failed' where id = $1`, [
      rebate.id,
    ]);
    throw new AppError('rebate payout failed', 'rebate_payout_failed', 502);
  }

  await postLedgerTransaction(client, {
    kind: 'screening_rebate_paid',
    idempotencyKey: `rebate:ledger:${rebate.id}`,
    memo: `screening_rebate:${rebate.id};payout:${payout.payoutId}`,
    clock,
    lines: [
      {
        accountCode: 'liability:payable:screening_rebate',
        direction: 'dr',
        amountCents: rebate.amount_cents,
      },
      {
        accountCode: 'asset:cash:stripe',
        direction: 'cr',
        amountCents: rebate.amount_cents,
      },
    ],
  });

  await client.query(
    `update screening_rebate set status = 'paid', paid_at = $2 where id = $1`,
    [rebate.id, now],
  );
  await emitDomainEvent(client, {
    aggregateType: 'screening_rebate',
    aggregateId: rebate.id,
    eventType: 'screening_rebate.paid',
    payload: { payout_id: payout.payoutId, amount_cents: rebate.amount_cents },
    actorKind: 'system',
    occurredAt: now,
  });

  return { payoutId: payout.payoutId };
}
