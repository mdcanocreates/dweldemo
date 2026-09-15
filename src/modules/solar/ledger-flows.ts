/**
 * Solar ledger flows per §13.5 — uses shared journal helpers.
 */

import type { DbClient } from '../../db/pool.js';
import { postLedgerTransaction } from '../ledger/index.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';

/** Approval — accrue receivable + homeowner payable obligation. */
export async function journalSolarApprovalAccrual(
  client: DbClient,
  input: {
    solarDealId: string;
    expectedProfitShareCents: number;
    approvedCashbackCents: number;
    clock?: Clock;
  },
): Promise<{ receivableTxnId: string; payableTxnId: string }> {
  const clock = input.clock ?? systemClock;
  const receivable = await postLedgerTransaction(client, {
    kind: 'solar_profit_share_accrual',
    idempotencyKey: `solar:accrual:receivable:${input.solarDealId}`,
    memo: `solar_deal:${input.solarDealId}`,
    clock,
    lines: [
      {
        accountCode: 'asset:receivable:pbc_solar',
        direction: 'dr',
        amountCents: input.expectedProfitShareCents,
      },
      {
        accountCode: 'revenue:profit_share',
        direction: 'cr',
        amountCents: input.expectedProfitShareCents,
      },
    ],
  });

  const payable = await postLedgerTransaction(client, {
    kind: 'solar_cashback_accrual',
    idempotencyKey: `solar:accrual:payable:${input.solarDealId}`,
    memo: `solar_deal:${input.solarDealId}`,
    clock,
    lines: [
      {
        accountCode: 'expense:solar_cashback',
        direction: 'dr',
        amountCents: input.approvedCashbackCents,
      },
      {
        accountCode: 'liability:payable:solar_homeowner',
        direction: 'cr',
        amountCents: input.approvedCashbackCents,
      },
    ],
  });

  return {
    receivableTxnId: receivable.transactionId,
    payableTxnId: payable.transactionId,
  };
}

/** PBC Solar remits profit share. */
export async function journalSolarRemittanceReceived(
  client: DbClient,
  input: {
    remittanceId: string;
    receivedAmountCents: number;
    clock?: Clock;
  },
): Promise<{ transactionId: string }> {
  const clock = input.clock ?? systemClock;
  const result = await postLedgerTransaction(client, {
    kind: 'solar_partner_remittance',
    idempotencyKey: `solar:remittance:${input.remittanceId}`,
    memo: `solar_partner_remittance:${input.remittanceId}`,
    clock,
    lines: [
      {
        accountCode: 'asset:cash:operating',
        direction: 'dr',
        amountCents: input.receivedAmountCents,
      },
      {
        accountCode: 'asset:receivable:pbc_solar',
        direction: 'cr',
        amountCents: input.receivedAmountCents,
      },
    ],
  });
  return { transactionId: result.transactionId };
}

/** Homeowner disbursed via Stripe payout rail. */
export async function journalSolarHomeownerDisbursement(
  client: DbClient,
  input: {
    solarDealId: string;
    cashbackAmountCents: number;
    payoutRef?: string;
    clock?: Clock;
  },
): Promise<{ transactionId: string }> {
  const clock = input.clock ?? systemClock;
  const result = await postLedgerTransaction(client, {
    kind: 'solar_homeowner_disbursement',
    idempotencyKey: `solar:disburse:${input.solarDealId}`,
    memo: input.payoutRef
      ? `solar_deal:${input.solarDealId};payout:${input.payoutRef}`
      : `solar_deal:${input.solarDealId}`,
    clock,
    lines: [
      {
        accountCode: 'liability:payable:solar_homeowner',
        direction: 'dr',
        amountCents: input.cashbackAmountCents,
      },
      {
        accountCode: 'asset:cash:stripe',
        direction: 'cr',
        amountCents: input.cashbackAmountCents,
      },
    ],
  });
  return { transactionId: result.transactionId };
}
