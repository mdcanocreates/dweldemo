import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import {
  collectPayoutDestination,
  executePayout,
} from '../payments/index.js';
import { AppError } from '../shared/errors.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { journalSolarHomeownerDisbursement } from './ledger-flows.js';

/**
 * Disburse homeowner cashback. Gated on partner_paid (§13.5).
 * Uses shared payout rail with screening rebate (§13.6).
 */
export async function disburseHomeownerCashback(
  client: DbClient,
  input: {
    solarDealId: string;
    destinationToken: string;
    clock?: Clock;
  },
): Promise<{ payoutId: string; amountCents: number }> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();

  const { rows: deals } = await client.query<{
    id: string;
    status: string;
    homeowner_party_id: string;
  }>(`select id, status, homeowner_party_id from solar_deal where id = $1 for update`, [
    input.solarDealId,
  ]);
  const deal = deals[0];
  if (!deal) throw new AppError('solar_deal not found', 'solar_deal_not_found', 404);

  if (deal.status !== 'partner_paid') {
    throw new AppError(
      `homeowner disbursement requires partner_paid (status=${deal.status})`,
      'solar_disbursement_gated',
      409,
    );
  }

  const { rows: decisions } = await client.query<{
    approved_cashback_cents: number;
    decision: string;
  }>(
    `select approved_cashback_cents, decision
     from solar_underwriting_decision
     where solar_deal_id = $1
     order by computed_at desc
     limit 1`,
    [input.solarDealId],
  );
  const decision = decisions[0];
  if (!decision || decision.decision !== 'approved') {
    throw new AppError('no approved underwriting decision', 'solar_no_approval', 409);
  }
  const amountCents = decision.approved_cashback_cents;
  if (amountCents <= 0) {
    throw new AppError('approved cashback is zero', 'solar_zero_cashback', 409);
  }

  const { payoutMethodRef } = await collectPayoutDestination(client, {
    partyId: deal.homeowner_party_id,
    destinationToken: input.destinationToken,
    consumer: 'solar_homeowner',
    consumerId: input.solarDealId,
    clock,
  });

  const payout = await executePayout(client, {
    partyId: deal.homeowner_party_id,
    amountCents,
    payoutMethodRef,
    consumer: 'solar_homeowner',
    consumerId: input.solarDealId,
    idempotencyKey: `solar:payout:${input.solarDealId}`,
    clock,
  });

  if (payout.status !== 'paid') {
    throw new AppError(
      `payout failed: ${payout.failureCode ?? 'unknown'}`,
      'solar_payout_failed',
      502,
    );
  }

  await journalSolarHomeownerDisbursement(client, {
    solarDealId: input.solarDealId,
    cashbackAmountCents: amountCents,
    payoutRef: payout.payoutId,
    clock,
  });

  await client.query(`update solar_deal set status = 'homeowner_paid' where id = $1`, [
    input.solarDealId,
  ]);
  await emitDomainEvent(client, {
    aggregateType: 'solar_deal',
    aggregateId: input.solarDealId,
    eventType: 'solar_deal.homeowner_paid',
    payload: {
      amount_cents: amountCents,
      payout_id: payout.payoutId,
    },
    actorKind: 'system',
    occurredAt: now,
  });

  return { payoutId: payout.payoutId, amountCents };
}
