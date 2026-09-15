import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postLedgerTransaction } from '../../src/modules/ledger/journal.js';
import {
  recognizeDeferredLeadFeeLines,
} from '../../src/modules/ledger/recognition.js';
import { trialBalanceToCsv } from '../../src/modules/ledger/exports.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';

describe('ledger unit', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  }, 300_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('recognizeDeferredLeadFeeLines balances liability→revenue', () => {
    const lines = recognizeDeferredLeadFeeLines(14000);
    expect(lines).toHaveLength(2);
    const dr = lines.filter((l) => l.direction === 'dr').reduce((s, l) => s + l.amountCents, 0);
    const cr = lines.filter((l) => l.direction === 'cr').reduce((s, l) => s + l.amountCents, 0);
    expect(dr).toBe(cr);
    expect(lines[0]!.accountCode).toBe('liability:unearned_revenue');
    expect(lines[1]!.accountCode).toBe('revenue:lead_fee');
  });

  it('rejects unbalanced and non-positive amounts', async () => {
    await withBypass(db.pool, async (c) => {
      await expect(
        postLedgerTransaction(c, {
          kind: 'test',
          idempotencyKey: `unbal-${Date.now()}`,
          lines: [
            { accountCode: 'cash', direction: 'dr', amountCents: 100 },
            { accountCode: 'revenue:lead_fee', direction: 'cr', amountCents: 50 },
          ],
        }),
      ).rejects.toMatchObject({ code: 'LEDGER_UNBALANCED' });

      await expect(
        postLedgerTransaction(c, {
          kind: 'test',
          idempotencyKey: `neg-${Date.now()}`,
          lines: [
            { accountCode: 'cash', direction: 'dr', amountCents: 0 },
            { accountCode: 'revenue:lead_fee', direction: 'cr', amountCents: 0 },
          ],
        }),
      ).rejects.toMatchObject({ code: 'LEDGER_INVALID_AMOUNT' });
    });
  });

  it('idempotency key reuses prior transaction', async () => {
    const key = `idem-${Date.now()}`;
    await withBypass(db.pool, async (c) => {
      // Ensure cash + revenue accounts exist via first successful post using known codes from migrations
      const first = await postLedgerTransaction(c, {
        kind: 'test_idem',
        idempotencyKey: key,
        lines: [
          { accountCode: 'asset:cash', direction: 'dr', amountCents: 1000 },
          { accountCode: 'revenue:lead_fee', direction: 'cr', amountCents: 1000 },
        ],
      });
      expect(first.reused).toBe(false);
      const second = await postLedgerTransaction(c, {
        kind: 'test_idem',
        idempotencyKey: key,
        lines: [
          { accountCode: 'asset:cash', direction: 'dr', amountCents: 9999 },
          { accountCode: 'revenue:lead_fee', direction: 'cr', amountCents: 9999 },
        ],
      });
      expect(second.reused).toBe(true);
      expect(second.transactionId).toBe(first.transactionId);

      // Reversal linkage
      const rev = await postLedgerTransaction(c, {
        kind: 'test_reversal',
        idempotencyKey: `${key}-rev`,
        reversesTxnId: first.transactionId,
        lines: [
          { accountCode: 'revenue:lead_fee', direction: 'dr', amountCents: 1000 },
          { accountCode: 'asset:cash', direction: 'cr', amountCents: 1000 },
        ],
      });
      const { rows } = await c.query<{ reverses_txn_id: string | null }>(
        `select reverses_txn_id::text from ledger_transaction where id = $1`,
        [rev.transactionId],
      );
      expect(rows[0]!.reverses_txn_id).toBe(first.transactionId);
    });
  });

  it('trialBalanceToCsv formats rows', () => {
    const csv = trialBalanceToCsv([
      {
        accountCode: 'asset:cash',
        accountKind: 'asset',
        debitCents: 100,
        creditCents: 0,
        balanceCents: 100,
      },
    ]);
    expect(csv).toContain('account_code');
    expect(csv).toContain('asset:cash');
  });
});
