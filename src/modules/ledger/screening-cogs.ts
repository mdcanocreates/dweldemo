import type { DbClient } from '../../db/pool.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { postLedgerTransaction } from './journal.js';

/**
 * Optional bridge: journal screening vendor_cost_entry into expense:screening_cogs.
 * Not auto-wired into the screening pipeline (documented in evidence/phase3/spec-gaps.txt).
 */
export async function journalVendorCostEntry(
  client: DbClient,
  input: {
    vendorCostEntryId: string;
    costCents: number;
    vendor: string;
    clock?: Clock;
  },
): Promise<{ transactionId: string } | null> {
  if (input.costCents <= 0) return null;
  const clock = input.clock ?? systemClock;
  const result = await postLedgerTransaction(client, {
    kind: 'screening_cogs',
    idempotencyKey: `screening_cogs:${input.vendorCostEntryId}`,
    occurredAt: clock.now(),
    clock,
    memo: `vendor=${input.vendor}`,
    lines: [
      {
        accountCode: 'expense:screening_cogs',
        direction: 'dr',
        amountCents: input.costCents,
      },
      {
        accountCode: 'asset:cash:operating',
        direction: 'cr',
        amountCents: input.costCents,
      },
    ],
  });
  return { transactionId: result.transactionId };
}
