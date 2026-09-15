import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { getLedgerAccountId } from './accounts.js';

export type LedgerLine = {
  accountCode: string;
  direction: 'dr' | 'cr';
  amountCents: number;
  counterpartyOrgId?: string | null;
  counterpartyPartyId?: string | null;
};

export async function postLedgerTransaction(
  client: DbClient,
  input: {
    kind: string;
    idempotencyKey: string;
    lines: LedgerLine[];
    memo?: string;
    sourceEventId?: string | null;
    reversesTxnId?: string | null;
    occurredAt?: Date;
    clock?: Clock;
  },
): Promise<{ transactionId: string; reused: boolean }> {
  const existing = await client.query<{ id: string }>(
    `select id from ledger_transaction where idempotency_key = $1`,
    [input.idempotencyKey],
  );
  if (existing.rows[0]) {
    return { transactionId: existing.rows[0].id, reused: true };
  }

  const debits = input.lines
    .filter((l) => l.direction === 'dr')
    .reduce((s, l) => s + l.amountCents, 0);
  const credits = input.lines
    .filter((l) => l.direction === 'cr')
    .reduce((s, l) => s + l.amountCents, 0);
  if (debits !== credits) {
    throw new AppError(
      `unbalanced ledger transaction: dr=${debits} cr=${credits}`,
      'LEDGER_UNBALANCED',
    );
  }
  if (input.lines.some((l) => l.amountCents <= 0)) {
    throw new AppError('ledger amounts must be positive', 'LEDGER_INVALID_AMOUNT');
  }

  const clock = input.clock ?? systemClock;
  const transactionId = randomUUID();
  const occurredAt = input.occurredAt ?? clock.now();

  await client.query(
    `insert into ledger_transaction (
       id, occurred_at, kind, idempotency_key, source_event_id, reverses_txn_id, memo
     ) values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      transactionId,
      occurredAt,
      input.kind,
      input.idempotencyKey,
      input.sourceEventId ?? null,
      input.reversesTxnId ?? null,
      input.memo ?? null,
    ],
  );

  for (const line of input.lines) {
    const accountId = await getLedgerAccountId(
      client,
      line.accountCode,
      line.counterpartyOrgId,
      line.counterpartyPartyId,
    );
    await client.query(
      `insert into ledger_entry (transaction_id, account_id, direction, amount_cents)
       values ($1,$2,$3,$4)`,
      [transactionId, accountId, line.direction, line.amountCents],
    );
  }

  await emitDomainEvent(client, {
    aggregateType: 'ledger_transaction',
    aggregateId: transactionId,
    eventType: 'ledger.transaction_posted',
    payload: {
      kind: input.kind,
      idempotency_key: input.idempotencyKey,
      line_count: input.lines.length,
    },
    actorKind: 'system',
    occurredAt,
  });

  return { transactionId, reused: false };
}
