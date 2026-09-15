import type { DbClient } from '../../db/pool.js';
import { resolveConfig } from '../config/index.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import type { LedgerLine } from './journal.js';

export type LeadFeeRecognition = 'immediate' | 'deferred';

/**
 * D-05 — both booking paths selectable by config_version.
 * Namespace key: ledger_policy.lead_fee_recognition = 'immediate'|'deferred'
 * No production business default in code literals.
 */
export async function resolveLeadFeeRecognition(
  client: DbClient,
  asOf: Date,
): Promise<LeadFeeRecognition> {
  const cfg = await resolveConfig(client, 'ledger_policy', asOf);
  const value = cfg?.lead_fee_recognition;
  if (value === 'immediate' || value === 'deferred') return value;
  throw new Error(
    'ledger_policy.lead_fee_recognition missing or invalid — seed approved config (D-05)',
  );
}

/** Lines for lead purchase draw-down credit side per recognition mode. */
export async function leadPurchaseCreditLines(
  client: DbClient,
  input: { feeAmountCents: number; asOf?: Date; clock?: Clock },
): Promise<LedgerLine[]> {
  const clock = input.clock ?? systemClock;
  const asOf = input.asOf ?? clock.now();
  const mode = await resolveLeadFeeRecognition(client, asOf);
  if (mode === 'deferred') {
    return [
      {
        accountCode: 'liability:unearned_revenue',
        direction: 'cr',
        amountCents: input.feeAmountCents,
      },
    ];
  }
  return [
    {
      accountCode: 'revenue:lead_fee',
      direction: 'cr',
      amountCents: input.feeAmountCents,
    },
  ];
}

/** Recognize previously deferred lead fee into revenue (post-purchase obligation discharge). */
export function recognizeDeferredLeadFeeLines(feeAmountCents: number): LedgerLine[] {
  return [
    {
      accountCode: 'liability:unearned_revenue',
      direction: 'dr',
      amountCents: feeAmountCents,
    },
    {
      accountCode: 'revenue:lead_fee',
      direction: 'cr',
      amountCents: feeAmountCents,
    },
  ];
}
