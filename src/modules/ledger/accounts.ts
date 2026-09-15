import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';

export async function getLedgerAccountId(
  client: DbClient,
  code: string,
  counterpartyOrgId?: string | null,
  counterpartyPartyId?: string | null,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `select id from ledger_account
     where code = $1
       and coalesce(counterparty_org_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
       and coalesce(counterparty_party_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
     limit 1`,
    [code, counterpartyOrgId ?? null, counterpartyPartyId ?? null],
  );
  if (rows[0]) return rows[0].id;

  const kind = code.split(':')[0];
  if (!kind || !['asset', 'liability', 'equity', 'revenue', 'expense'].includes(kind)) {
    throw new Error(`cannot infer ledger account kind from code ${code}`);
  }
  const id = randomUUID();
  try {
    await client.query(
      `insert into ledger_account (id, code, kind, counterparty_org_id, counterparty_party_id)
       values ($1,$2,$3,$4,$5)`,
      [id, code, kind, counterpartyOrgId ?? null, counterpartyPartyId ?? null],
    );
    return id;
  } catch (err: unknown) {
    // Concurrent creators of the same counterparty account — re-select winner.
    const codeName = (err as { code?: string }).code;
    if (codeName !== '23505') throw err;
    const { rows: again } = await client.query<{ id: string }>(
      `select id from ledger_account
       where code = $1
         and coalesce(counterparty_org_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         and coalesce(counterparty_party_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
       limit 1`,
      [code, counterpartyOrgId ?? null, counterpartyPartyId ?? null],
    );
    if (!again[0]) throw err;
    return again[0].id;
  }
}

export async function ensureBrokerPrepaidAccount(
  client: DbClient,
  orgId: string,
): Promise<string> {
  return getLedgerAccountId(client, 'liability:broker_prepaid_balance', orgId, null);
}
