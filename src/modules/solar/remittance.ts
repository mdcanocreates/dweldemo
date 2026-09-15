import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { journalSolarRemittanceReceived } from './ledger-flows.js';

export type DealRemittanceLine = {
  solarDealId: string;
  amountCents: number;
};

/**
 * Ingest PBC remittance. Variance between expected and received writes a
 * reconciliation_run break — never silently absorbed (§13.5).
 */
export async function ingestPartnerRemittance(
  client: DbClient,
  input: {
    partnerOrgId: string;
    periodStart: string; // YYYY-MM-DD
    periodEnd: string;
    expectedAmountCents: number;
    receivedAmountCents: number;
    dealLines: DealRemittanceLine[];
    statementDocumentId?: string | null;
    clock?: Clock;
  },
): Promise<{
  remittanceId: string;
  status: 'received' | 'variance';
  varianceCents: number;
  reconciliationRunId: string | null;
}> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const varianceCents = input.receivedAmountCents - input.expectedAmountCents;
  const status: 'received' | 'variance' =
    varianceCents === 0 ? 'received' : 'variance';

  const remittanceId = randomUUID();
  await client.query(
    `insert into solar_partner_remittance (
       id, partner_org_id, period_start, period_end,
       expected_amount_cents, received_amount_cents, received_at,
       variance_cents, status, statement_document_id
     ) values ($1,$2,$3::date,$4::date,$5,$6,$7,$8,$9,$10)`,
    [
      remittanceId,
      input.partnerOrgId,
      input.periodStart,
      input.periodEnd,
      input.expectedAmountCents,
      input.receivedAmountCents,
      now,
      varianceCents,
      status,
      input.statementDocumentId ?? null,
    ],
  );

  for (const line of input.dealLines) {
    await client.query(
      `insert into solar_deal_remittance (solar_deal_id, remittance_id, amount_cents)
       values ($1,$2,$3)`,
      [line.solarDealId, remittanceId, line.amountCents],
    );

    // Advance deal to partner_paid when installed (or already installed)
    const { rows: deals } = await client.query<{ status: string }>(
      `select status from solar_deal where id = $1 for update`,
      [line.solarDealId],
    );
    const deal = deals[0];
    if (!deal) {
      throw new AppError('solar_deal not found for remittance', 'solar_deal_not_found', 404);
    }
    if (deal.status !== 'installed' && deal.status !== 'partner_paid') {
      throw new AppError(
        `deal ${line.solarDealId} must be installed before remittance (status=${deal.status})`,
        'solar_invalid_transition',
        409,
      );
    }
    if (deal.status === 'installed') {
      await client.query(`update solar_deal set status = 'partner_paid' where id = $1`, [
        line.solarDealId,
      ]);
      await emitDomainEvent(client, {
        aggregateType: 'solar_deal',
        aggregateId: line.solarDealId,
        eventType: 'solar_deal.partner_paid',
        payload: {
          remittance_id: remittanceId,
          amount_cents: line.amountCents,
        },
        actorKind: 'system',
        occurredAt: now,
      });
    }
  }

  if (input.receivedAmountCents > 0) {
    await journalSolarRemittanceReceived(client, {
      remittanceId,
      receivedAmountCents: input.receivedAmountCents,
      clock,
    });
  }

  let reconciliationRunId: string | null = null;
  if (status === 'variance') {
    reconciliationRunId = randomUUID();
    await client.query(
      `insert into reconciliation_run (
         id, provider, period_start, period_end,
         matched_count, unmatched_count, amount_mismatch_count, status, ran_at
       ) values ($1,'pbc_solar',$2::timestamptz,$3::timestamptz,0,0,1,'breaks_detected',$4)`,
      [
        reconciliationRunId,
        `${input.periodStart}T00:00:00Z`,
        `${input.periodEnd}T23:59:59Z`,
        now,
      ],
    );

    await emitDomainEvent(client, {
      aggregateType: 'reconciliation_run',
      aggregateId: reconciliationRunId,
      eventType: 'reconciliation.breaks_alerted',
      payload: {
        provider: 'pbc_solar',
        remittance_id: remittanceId,
        break_kind: 'amount_mismatch',
        expected_amount_cents: input.expectedAmountCents,
        received_amount_cents: input.receivedAmountCents,
        variance_cents: varianceCents,
        auto_resolved: false,
        silent_absorption: false,
      },
      actorKind: 'system',
      occurredAt: now,
    });
  }

  await emitDomainEvent(client, {
    aggregateType: 'solar_partner_remittance',
    aggregateId: remittanceId,
    eventType:
      status === 'variance'
        ? 'solar_remittance.variance'
        : 'solar_remittance.received',
    payload: {
      partner_org_id: input.partnerOrgId,
      expected_amount_cents: input.expectedAmountCents,
      received_amount_cents: input.receivedAmountCents,
      variance_cents: varianceCents,
      reconciliation_run_id: reconciliationRunId,
    },
    actorKind: 'system',
    occurredAt: now,
  });

  return {
    remittanceId,
    status,
    varianceCents,
    reconciliationRunId,
  };
}
