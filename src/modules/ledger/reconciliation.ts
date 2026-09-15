import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { getVendorRegistry } from '../vendors/index.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';

export type ReconciliationResult = {
  runId: string;
  matchedCount: number;
  unmatchedCount: number;
  amountMismatchCount: number;
  status: 'clean' | 'breaks_detected';
  breaks: Array<{
    breakKind: 'unmatched_stripe' | 'unmatched_ledger' | 'amount_mismatch';
    stripeObjectId?: string;
    ledgerTransactionId?: string;
    stripeAmountCents?: number;
    ledgerAmountCents?: number;
  }>;
};

/**
 * Nightly-style reconciler (§11.4).
 * Breaks alert via domain_event and are never auto-resolved.
 */
export async function runStripeReconciliation(
  client: DbClient,
  input: {
    periodStart: Date;
    periodEnd: Date;
    clock?: Clock;
  },
): Promise<ReconciliationResult> {
  const clock = input.clock ?? systemClock;
  const rail = getVendorRegistry().paymentRail();
  const stripeTxns = await rail.listBalanceTransactions(
    input.periodStart,
    input.periodEnd,
  );

  // Match ledger_transaction.memo or idempotency_key containing Stripe object id.
  const { rows: ledgerRows } = await client.query<{
    id: string;
    idempotency_key: string;
    memo: string | null;
    amount_cents: string;
  }>(
    `select t.id, t.idempotency_key, t.memo,
            coalesce((
              select sum(e.amount_cents) from ledger_entry e
              where e.transaction_id = t.id and e.direction = 'dr'
            ), 0)::text as amount_cents
     from ledger_transaction t
     where t.occurred_at >= $1 and t.occurred_at < $2
       and t.kind in ('broker_funding','lead_purchase_charge','stripe_charge')`,
    [input.periodStart, input.periodEnd],
  );

  const breaks: ReconciliationResult['breaks'] = [];
  let matchedCount = 0;
  let unmatchedCount = 0;
  let amountMismatchCount = 0;

  const matchedLedger = new Set<string>();

  for (const st of stripeTxns) {
    const stripeId = st.chargeId ?? st.id;
    const ledger = ledgerRows.find(
      (l) =>
        l.idempotency_key.includes(stripeId) ||
        (l.memo != null && l.memo.includes(stripeId)),
    );
    if (!ledger) {
      unmatchedCount += 1;
      breaks.push({
        breakKind: 'unmatched_stripe',
        stripeObjectId: stripeId,
        stripeAmountCents: st.amountCents,
      });
      continue;
    }
    matchedLedger.add(ledger.id);
    const ledgerAmt = Number(ledger.amount_cents);
    if (ledgerAmt !== st.amountCents) {
      amountMismatchCount += 1;
      breaks.push({
        breakKind: 'amount_mismatch',
        stripeObjectId: stripeId,
        ledgerTransactionId: ledger.id,
        stripeAmountCents: st.amountCents,
        ledgerAmountCents: ledgerAmt,
      });
    } else {
      matchedCount += 1;
    }
  }

  for (const l of ledgerRows) {
    if (matchedLedger.has(l.id)) continue;
    unmatchedCount += 1;
    breaks.push({
      breakKind: 'unmatched_ledger',
      ledgerTransactionId: l.id,
      ledgerAmountCents: Number(l.amount_cents),
    });
  }

  const status = breaks.length === 0 ? 'clean' : 'breaks_detected';
  const runId = randomUUID();
  await client.query(
    `insert into reconciliation_run (
       id, provider, period_start, period_end,
       matched_count, unmatched_count, amount_mismatch_count, status, ran_at
     ) values ($1,'stripe',$2,$3,$4,$5,$6,$7,$8)`,
    [
      runId,
      input.periodStart,
      input.periodEnd,
      matchedCount,
      unmatchedCount,
      amountMismatchCount,
      status,
      clock.now(),
    ],
  );

  if (breaks.length > 0) {
    await emitDomainEvent(client, {
      aggregateType: 'reconciliation_run',
      aggregateId: runId,
      eventType: 'reconciliation.breaks_alerted',
      payload: {
        provider: 'stripe',
        break_count: breaks.length,
        breaks,
        auto_resolved: false,
      },
      actorKind: 'system',
      occurredAt: clock.now(),
    });
  } else {
    await emitDomainEvent(client, {
      aggregateType: 'reconciliation_run',
      aggregateId: runId,
      eventType: 'reconciliation.completed',
      payload: { provider: 'stripe', matched_count: matchedCount },
      actorKind: 'system',
      occurredAt: clock.now(),
    });
  }

  return {
    runId,
    matchedCount,
    unmatchedCount,
    amountMismatchCount,
    status,
    breaks,
  };
}
