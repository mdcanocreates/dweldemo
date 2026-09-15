import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import { getActivePackage } from './config.js';

export type PayerKind = 'applicant' | 'landlord' | 'broker' | 'rbit_promotional';

/**
 * Create screening_order. Pricing comes from package snapshot — no payer_kind branching.
 */
export async function createScreeningOrder(
  client: DbClient,
  input: {
    partyId: string;
    applicationId?: string | null;
    payerKind: PayerKind;
    payerPartyId?: string | null;
    payerOrgId?: string | null;
    packageKey?: string;
    clock?: Clock;
  },
): Promise<{ orderId: string; amountChargedCents: number; packageId: string }> {
  const clock = input.clock ?? systemClock;
  const pkg = await getActivePackage(client, input.packageKey ?? 'standard');
  const orderId = randomUUID();
  // Snapshot package cost at decision time (P4) — identical for all payer_kind values.
  const amountChargedCents = pkg.total_cost_cents;

  await client.query(
    `insert into screening_order (
       id, party_id, application_id, package_id, payer_kind,
       payer_party_id, payer_org_id, amount_charged_cents, status
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,'paid')`,
    [
      orderId,
      input.partyId,
      input.applicationId ?? null,
      pkg.id,
      input.payerKind,
      input.payerPartyId ?? null,
      input.payerOrgId ?? null,
      amountChargedCents,
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'screening_order',
    aggregateId: orderId,
    eventType: 'screening_order.created',
    payload: {
      payer_kind: input.payerKind,
      amount_charged_cents: amountChargedCents,
      package_id: pkg.id,
      application_id: input.applicationId ?? null,
    },
    actorPartyId: input.partyId,
    actorKind: 'user',
    occurredAt: clock.now(),
  });

  return { orderId, amountChargedCents, packageId: pkg.id };
}

export async function transitionOrderStatus(
  client: DbClient,
  orderId: string,
  to: string,
  clock: Clock = systemClock,
): Promise<boolean> {
  const { rows } = await client.query<{ status: string }>(
    `select status from screening_order where id = $1 for update`,
    [orderId],
  );
  const row = rows[0];
  if (!row) throw new AppError('screening_order not found', 'order_not_found', 404);
  if (row.status === to) return false;
  if (row.status === 'complete' || row.status === 'cancelled' || row.status === 'failed') {
    // Terminal — reject illegal reverse/sideways transitions with typed error.
    // Same-status is a no-op (out-of-order duplicate terminal).
    if (to !== row.status) {
      throw new AppError(
        `illegal screening_order transition ${row.status}→${to}`,
        'order_invalid_transition',
        409,
      );
    }
    return false;
  }

  const completedAt = to === 'complete' ? clock.now() : null;
  await client.query(
    `update screening_order
     set status = $2, completed_at = coalesce($3, completed_at)
     where id = $1`,
    [orderId, to, completedAt],
  );
  await emitDomainEvent(client, {
    aggregateType: 'screening_order',
    aggregateId: orderId,
    eventType: 'screening_order.status_changed',
    payload: { from: row.status, to },
    actorKind: 'system',
    occurredAt: clock.now(),
  });
  return true;
}
