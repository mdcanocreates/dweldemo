import type { DbClient } from '../../db/pool.js';

export type TrialBalanceRow = {
  accountCode: string;
  accountKind: string;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
};

export type GlDetailRow = {
  occurredAt: Date;
  transactionId: string;
  kind: string;
  accountCode: string;
  direction: 'dr' | 'cr';
  amountCents: number;
  memo: string | null;
  idempotencyKey: string;
};

/** Trial balance as of date — sum of all entries through asOf. */
export async function exportTrialBalance(
  client: DbClient,
  asOf: Date,
): Promise<{ rows: TrialBalanceRow[]; totalDebits: number; totalCredits: number }> {
  // Aggregate by account code across per-org sub-accounts (§11.2).
  const { rows } = await client.query<{
    code: string;
    kind: string;
    debit_cents: string;
    credit_cents: string;
  }>(
    `select a.code, a.kind,
            coalesce(sum(case when x.direction = 'dr' then x.amount_cents else 0 end), 0)::text as debit_cents,
            coalesce(sum(case when x.direction = 'cr' then x.amount_cents else 0 end), 0)::text as credit_cents
     from ledger_account a
     left join (
       select e.account_id, e.direction, e.amount_cents
       from ledger_entry e
       join ledger_transaction t on t.id = e.transaction_id
       where t.occurred_at <= $1
     ) x on x.account_id = a.id
     group by a.code, a.kind
     order by a.code`,
    [asOf],
  );

  const out: TrialBalanceRow[] = rows.map((r) => {
    const debitCents = Number(r.debit_cents);
    const creditCents = Number(r.credit_cents);
    return {
      accountCode: r.code,
      accountKind: r.kind,
      debitCents,
      creditCents,
      balanceCents: debitCents - creditCents,
    };
  });

  const totalDebits = out.reduce((s, r) => s + r.debitCents, 0);
  const totalCredits = out.reduce((s, r) => s + r.creditCents, 0);
  return { rows: out, totalDebits, totalCredits };
}

export async function exportGlDetail(
  client: DbClient,
  input: { accountCode?: string; from: Date; to: Date },
): Promise<{ rows: GlDetailRow[]; totalDebits: number; totalCredits: number }> {
  const params: unknown[] = [input.from, input.to];
  let accountFilter = '';
  if (input.accountCode) {
    params.push(input.accountCode);
    accountFilter = `and a.code = $${params.length}`;
  }

  const { rows } = await client.query<{
    occurred_at: Date;
    transaction_id: string;
    kind: string;
    code: string;
    direction: 'dr' | 'cr';
    amount_cents: string;
    memo: string | null;
    idempotency_key: string;
  }>(
    `select t.occurred_at, t.id as transaction_id, t.kind, a.code,
            e.direction, e.amount_cents::text, t.memo, t.idempotency_key
     from ledger_entry e
     join ledger_transaction t on t.id = e.transaction_id
     join ledger_account a on a.id = e.account_id
     where t.occurred_at >= $1 and t.occurred_at < $2
       ${accountFilter}
     order by t.occurred_at, e.id`,
    params,
  );

  const out: GlDetailRow[] = rows.map((r) => ({
    occurredAt: r.occurred_at,
    transactionId: r.transaction_id,
    kind: r.kind,
    accountCode: r.code,
    direction: r.direction,
    amountCents: Number(r.amount_cents),
    memo: r.memo,
    idempotencyKey: r.idempotency_key,
  }));

  const totalDebits = out
    .filter((r) => r.direction === 'dr')
    .reduce((s, r) => s + r.amountCents, 0);
  const totalCredits = out
    .filter((r) => r.direction === 'cr')
    .reduce((s, r) => s + r.amountCents, 0);

  return { rows: out, totalDebits, totalCredits };
}

export function trialBalanceToCsv(rows: TrialBalanceRow[]): string {
  const header = 'account_code,kind,debit_cents,credit_cents,balance_cents';
  const lines = rows.map(
    (r) =>
      `${r.accountCode},${r.accountKind},${r.debitCents},${r.creditCents},${r.balanceCents}`,
  );
  return [header, ...lines].join('\n') + '\n';
}

export function glDetailToCsv(rows: GlDetailRow[]): string {
  const header =
    'occurred_at,transaction_id,kind,account_code,direction,amount_cents,memo,idempotency_key';
  const lines = rows.map(
    (r) =>
      `${r.occurredAt.toISOString()},${r.transactionId},${r.kind},${r.accountCode},${r.direction},${r.amountCents},${JSON.stringify(r.memo ?? '')},${r.idempotencyKey}`,
  );
  return [header, ...lines].join('\n') + '\n';
}
