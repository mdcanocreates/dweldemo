/**
 * Shared payout rail (§7.8 + §13.6).
 * One implementation for screening rebate and solar homeowner cashback:
 * collect payout destination at payout time (not intake), then execute payout.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { getVendorRegistry } from '../vendors/index.js';
import { AppError } from '../shared/errors.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { readStripePaymentMode } from './stripe-mode.js';

export type PayoutConsumer = 'screening_rebate' | 'solar_homeowner';

export type CollectPayoutDestinationInput = {
  partyId: string;
  /** Opaque bank/account token from Stripe Connect / Financial Connections — never raw account numbers. */
  destinationToken: string;
  consumer: PayoutConsumer;
  consumerId: string;
  clock?: Clock;
};

export type CollectPayoutDestinationResult = {
  payoutMethodRef: string;
};

/**
 * Collect Stripe payout destination at payout time.
 * Stores only the opaque payout_method_ref — never bank account numbers.
 */
export async function collectPayoutDestination(
  client: DbClient,
  input: CollectPayoutDestinationInput,
): Promise<CollectPayoutDestinationResult> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const rail = getVendorRegistry().paymentRail();

  if (!input.destinationToken || input.destinationToken.length < 8) {
    throw new AppError('invalid payout destination token', 'payout_destination_invalid', 400);
  }

  const payoutMethodRef = await rail.createPayoutDestination({
    partyId: input.partyId,
    destinationToken: input.destinationToken,
  });

  await emitDomainEvent(client, {
    aggregateType: input.consumer,
    aggregateId: input.consumerId,
    eventType: 'payout.destination_collected',
    payload: {
      consumer: input.consumer,
      party_id: input.partyId,
      // never log destinationToken
      payout_method_ref_fingerprint: createHash('sha256')
        .update(payoutMethodRef)
        .digest('hex')
        .slice(0, 16),
    },
    actorPartyId: input.partyId,
    actorKind: 'user',
    occurredAt: now,
  });

  return { payoutMethodRef };
}

export type ExecutePayoutInput = {
  partyId: string;
  amountCents: number;
  payoutMethodRef: string;
  consumer: PayoutConsumer;
  consumerId: string;
  idempotencyKey: string;
  clock?: Clock;
};

export type ExecutePayoutResult = {
  payoutId: string;
  status: 'paid' | 'failed';
  failureCode?: string;
};

/** Execute a Stripe payout against a previously collected destination. */
export async function executePayout(
  client: DbClient,
  input: ExecutePayoutInput,
): Promise<ExecutePayoutResult> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const rail = getVendorRegistry().paymentRail();

  if (input.amountCents <= 0) {
    throw new AppError('payout amount must be positive', 'payout_invalid_amount', 400);
  }
  if (readStripePaymentMode().mode === 'live') {
    throw new AppError('Real Stripe payouts are disabled', 'payouts_not_approved', 403);
  }

  const result = await rail.createPayout({
    amountCents: input.amountCents,
    payoutMethodRef: input.payoutMethodRef,
    idempotencyKey: input.idempotencyKey,
    metadata: {
      consumer: input.consumer,
      consumer_id: input.consumerId,
      party_id: input.partyId,
    },
  });

  await emitDomainEvent(client, {
    aggregateType: input.consumer,
    aggregateId: input.consumerId,
    eventType:
      result.status === 'paid' ? 'payout.completed' : 'payout.failed',
    payload: {
      consumer: input.consumer,
      payout_id: result.payoutId,
      amount_cents: input.amountCents,
      status: result.status,
      failure_code: result.failureCode ?? null,
    },
    actorKind: 'system',
    occurredAt: now,
  });

  return {
    payoutId: result.payoutId,
    status: result.status,
    failureCode: result.failureCode,
  };
}

/** Stable idempotency helper for consumers. */
export function payoutIdempotencyKey(
  consumer: PayoutConsumer,
  consumerId: string,
): string {
  return `payout:${consumer}:${consumerId}:${randomUUID().slice(0, 8)}`;
}
