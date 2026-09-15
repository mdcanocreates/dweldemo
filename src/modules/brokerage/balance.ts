import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import {
  ensureBrokerPrepaidAccount,
  postLedgerTransaction,
} from '../ledger/index.js';
import { getVendorRegistry } from '../vendors/index.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';

export async function ensureBrokerBalance(
  client: DbClient,
  orgId: string,
): Promise<void> {
  await client.query(
    `insert into broker_balance (org_id, balance_cents) values ($1, 0)
     on conflict (org_id) do nothing`,
    [orgId],
  );
  await ensureBrokerPrepaidAccount(client, orgId);
}

/**
 * Fund prepaid balance via Stripe stub charge + ledger funding entry (§11.3).
 */
export async function fundBrokerBalance(
  client: DbClient,
  input: {
    orgId: string;
    amountCents: number;
    idempotencyKey: string;
    clock?: Clock;
    forceChargeFailure?: boolean;
  },
): Promise<{ balanceCents: number; ledgerTransactionId: string; chargeId: string }> {
  if (input.amountCents <= 0) {
    throw new AppError('funding amount must be positive', 'INVALID_AMOUNT');
  }
  const clock = input.clock ?? systemClock;
  await ensureBrokerBalance(client, input.orgId);

  const existing = await client.query<{
    balance_after_cents: string;
    ledger_transaction_id: string | null;
  }>(
    `select balance_after_cents::text, ledger_transaction_id
     from broker_balance_txn where idempotency_key = $1`,
    [input.idempotencyKey],
  );
  if (existing.rows[0]) {
    return {
      balanceCents: Number(existing.rows[0].balance_after_cents),
      ledgerTransactionId: existing.rows[0].ledger_transaction_id ?? '',
      chargeId: 'idempotent-reuse',
    };
  }

  const rail = getVendorRegistry().paymentRail();
  const charge = await rail.createCharge({
    amountCents: input.amountCents,
    idempotencyKey: input.idempotencyKey,
    forceFailure: input.forceChargeFailure,
    metadata: { org_id: input.orgId, kind: 'broker_funding' },
  });
  if (charge.status !== 'succeeded') {
    throw new AppError('funding charge failed', 'PAYMENT_FAILED');
  }

  const feeCents = charge.feeCents;
  const netCents = input.amountCents - feeCents;
  if (netCents <= 0) {
    throw new AppError('funding net after fees non-positive', 'INVALID_FEE');
  }

  const { transactionId } = await postLedgerTransaction(client, {
    kind: 'broker_funding',
    idempotencyKey: `ledger:funding:${input.idempotencyKey}`,
    occurredAt: clock.now(),
    clock,
    memo: charge.chargeId,
    lines: [
      {
        accountCode: 'asset:cash:stripe',
        direction: 'dr',
        amountCents: netCents,
      },
      {
        accountCode: 'expense:processing_fees',
        direction: 'dr',
        amountCents: feeCents,
      },
      {
        accountCode: 'liability:broker_prepaid_balance',
        direction: 'cr',
        amountCents: input.amountCents,
        counterpartyOrgId: input.orgId,
      },
    ],
  });

  // Lock row then credit — CHECK (balance_cents >= 0) enforces non-negative.
  const { rows: bal } = await client.query<{ balance_cents: string }>(
    `select balance_cents::text from broker_balance where org_id = $1 for update`,
    [input.orgId],
  );
  const next = Number(bal[0]!.balance_cents) + input.amountCents;
  await client.query(
    `update broker_balance set balance_cents = $2, updated_at = $3 where org_id = $1`,
    [input.orgId, next, clock.now()],
  );

  const txnId = randomUUID();
  await client.query(
    `insert into broker_balance_txn (
       id, org_id, kind, amount_cents, balance_after_cents,
       ledger_transaction_id, idempotency_key, created_at
     ) values ($1,$2,'funding',$3,$4,$5,$6,$7)`,
    [
      txnId,
      input.orgId,
      input.amountCents,
      next,
      transactionId,
      input.idempotencyKey,
      clock.now(),
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'broker_balance',
    aggregateId: input.orgId,
    eventType: 'broker_balance.funded',
    payload: {
      amount_cents: input.amountCents,
      balance_after_cents: next,
      charge_id: charge.chargeId,
      ledger_transaction_id: transactionId,
    },
    actorKind: 'system',
    occurredAt: clock.now(),
  });

  return {
    balanceCents: next,
    ledgerTransactionId: transactionId,
    chargeId: charge.chargeId,
  };
}

/**
 * Atomic draw-down. Concurrent callers cannot drive balance negative
 * (SELECT FOR UPDATE + conditional update + CHECK constraint).
 *
 * Callers that also post ledger entries MUST call this (or lockBrokerBalanceForUpdate)
 * before posting ledger so concurrent purchases serialize on the same balance row
 * and cannot leave orphan ledger posts after a failed draw-down race.
 */
export async function lockBrokerBalanceForUpdate(
  client: DbClient,
  orgId: string,
): Promise<number> {
  const { rows } = await client.query<{ balance_cents: string }>(
    `select balance_cents::text from broker_balance where org_id = $1 for update`,
    [orgId],
  );
  if (!rows[0]) {
    throw new AppError('broker balance not found', 'BALANCE_NOT_FOUND');
  }
  return Number(rows[0].balance_cents);
}

export async function drawDownBrokerBalance(
  client: DbClient,
  input: {
    orgId: string;
    amountCents: number;
    leadId: string;
    idempotencyKey: string;
    ledgerTransactionId: string;
    clock?: Clock;
    /** When true, caller already holds FOR UPDATE on broker_balance. */
    alreadyLocked?: boolean;
  },
): Promise<{ balanceAfterCents: number }> {
  const clock = input.clock ?? systemClock;
  const existing = await client.query<{ balance_after_cents: string }>(
    `select balance_after_cents::text from broker_balance_txn where idempotency_key = $1`,
    [input.idempotencyKey],
  );
  if (existing.rows[0]) {
    return { balanceAfterCents: Number(existing.rows[0].balance_after_cents) };
  }

  if (!input.alreadyLocked) {
    await lockBrokerBalanceForUpdate(client, input.orgId);
  }

  const { rows } = await client.query<{ balance_cents: string }>(
    `update broker_balance
     set balance_cents = balance_cents - $2,
         updated_at = $3
     where org_id = $1
       and balance_cents >= $2
     returning balance_cents::text`,
    [input.orgId, input.amountCents, clock.now()],
  );
  if (!rows[0]) {
    throw new AppError('insufficient broker balance', 'INSUFFICIENT_BALANCE');
  }
  const balanceAfter = Number(rows[0].balance_cents);

  await client.query(
    `insert into broker_balance_txn (
       id, org_id, kind, amount_cents, balance_after_cents,
       ledger_transaction_id, lead_id, idempotency_key, created_at
     ) values ($1,$2,'lead_purchase',$3,$4,$5,$6,$7,$8)`,
    [
      randomUUID(),
      input.orgId,
      -input.amountCents,
      balanceAfter,
      input.ledgerTransactionId,
      input.leadId,
      input.idempotencyKey,
      clock.now(),
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'broker_balance',
    aggregateId: input.orgId,
    eventType: 'broker_balance.drawn_down',
    payload: {
      amount_cents: input.amountCents,
      balance_after_cents: balanceAfter,
      lead_id: input.leadId,
    },
    actorKind: 'system',
    occurredAt: clock.now(),
  });

  return { balanceAfterCents: balanceAfter };
}

export async function getBrokerBalanceCents(
  client: DbClient,
  orgId: string,
): Promise<number> {
  const { rows } = await client.query<{ balance_cents: string }>(
    `select balance_cents::text from broker_balance where org_id = $1`,
    [orgId],
  );
  return rows[0] ? Number(rows[0].balance_cents) : 0;
}
