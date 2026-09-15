import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import {
  leadPurchaseCreditLines,
  postLedgerTransaction,
  recognizeDeferredLeadFeeLines,
  resolveLeadFeeRecognition,
} from '../ledger/index.js';
import { getVendorRegistry } from '../vendors/index.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import { drawDownBrokerBalance, lockBrokerBalanceForUpdate } from './balance.js';
import { getLead } from './lead.js';

export type PurchaseEvidenceInput = {
  purchasedByPartyId: string;
  sessionId: string;
  ip: string;
  userAgent?: string | null;
  tosVersion: string;
};

/**
 * Purchase via prepaid balance draw-down.
 * Charge (draw-down + ledger) and state→purchased share one transaction boundary.
 * Release is a separate step that MUST see purchased first.
 *
 * `simulateCrashAfterCharge`: leaves lead in purchased without release (orphan for reconciler).
 */
export async function purchaseLeadWithBalance(
  client: DbClient,
  input: {
    leadId: string;
    brokerOrgId: string;
    clock?: Clock;
    simulatePaymentFailure?: boolean;
    simulateCrashAfterCharge?: boolean;
    /** Direct Stripe charge amount assertion path (optional). */
    alsoStripeCharge?: boolean;
  },
): Promise<{
  status: string;
  feeAmountCents: number;
  stripeChargeAmountCents: number | null;
  ledgerTransactionId: string | null;
  released: boolean;
}> {
  const clock = input.clock ?? systemClock;
  const lead = await getLead(client, input.leadId);
  if (!lead) throw new AppError('lead not found', 'LEAD_NOT_FOUND');
  if (!['offered', 'reoffered', 'classified'].includes(lead.status)) {
    throw new AppError(
      `cannot purchase lead in status ${lead.status}`,
      'LEAD_INVALID_STATUS',
      409,
    );
  }

  // Verify open accepted offer or auto path for this broker
  const { rows: offers } = await client.query<{ id: string; response: string | null }>(
    `select id, response from lead_offer
     where lead_id = $1 and broker_org_id = $2
     order by offered_at desc limit 1`,
    [input.leadId, input.brokerOrgId],
  );
  const offer = offers[0];
  if (!offer) {
    throw new AppError('no offer for broker', 'NO_OFFER');
  }

  if (input.simulatePaymentFailure) {
    await emitDomainEvent(client, {
      aggregateType: 'lead',
      aggregateId: input.leadId,
      eventType: 'lead.purchase_failed',
      payload: { reason: 'payment_failure_simulated', broker_org_id: input.brokerOrgId },
      actorKind: 'system',
      occurredAt: clock.now(),
    });
    return {
      status: lead.status,
      feeAmountCents: lead.feeAmountCents,
      stripeChargeAmountCents: null,
      ledgerTransactionId: null,
      released: false,
    };
  }

  const fee = lead.feeAmountCents;
  let stripeChargeAmountCents: number | null = null;

  if (input.alsoStripeCharge) {
    const rail = getVendorRegistry().paymentRail();
    const charge = await rail.createCharge({
      amountCents: fee,
      idempotencyKey: `lead-charge:${input.leadId}`,
      metadata: { lead_id: input.leadId },
    });
    if (charge.status !== 'succeeded') {
      throw new AppError('stripe charge failed', 'PAYMENT_FAILED');
    }
    stripeChargeAmountCents = charge.amountCents;
  }

  // Serialize concurrent purchases on the same broker balance BEFORE ledger post
  // so a failed draw-down cannot leave an orphaned ledger transaction.
  const available = await lockBrokerBalanceForUpdate(client, input.brokerOrgId);
  if (available < fee) {
    throw new AppError('insufficient broker balance', 'INSUFFICIENT_BALANCE');
  }

  const creditLines = await leadPurchaseCreditLines(client, {
    feeAmountCents: fee,
    clock,
  });

  const { transactionId } = await postLedgerTransaction(client, {
    kind: 'lead_purchase',
    idempotencyKey: `ledger:lead_purchase:${input.leadId}`,
    occurredAt: clock.now(),
    clock,
    memo: `lead:${input.leadId}`,
    lines: [
      {
        accountCode: 'liability:broker_prepaid_balance',
        direction: 'dr',
        amountCents: fee,
        counterpartyOrgId: input.brokerOrgId,
      },
      ...creditLines,
    ],
  });

  await drawDownBrokerBalance(client, {
    orgId: input.brokerOrgId,
    amountCents: fee,
    leadId: input.leadId,
    idempotencyKey: `bal:lead_purchase:${input.leadId}`,
    ledgerTransactionId: transactionId,
    clock,
    alreadyLocked: true,
  });

  await client.query(`update lead set status = 'purchased' where id = $1`, [
    input.leadId,
  ]);
  await emitDomainEvent(client, {
    aggregateType: 'lead',
    aggregateId: input.leadId,
    eventType: 'lead.purchased',
    payload: {
      broker_org_id: input.brokerOrgId,
      fee_amount_cents: fee,
      ledger_transaction_id: transactionId,
      stripe_charge_amount_cents: stripeChargeAmountCents,
    },
    actorKind: 'system',
    occurredAt: clock.now(),
  });

  if (input.simulateCrashAfterCharge) {
    return {
      status: 'purchased',
      feeAmountCents: fee,
      stripeChargeAmountCents,
      ledgerTransactionId: transactionId,
      released: false,
    };
  }

  return {
    status: 'purchased',
    feeAmountCents: fee,
    stripeChargeAmountCents,
    ledgerTransactionId: transactionId,
    released: false,
  };
}

export async function releaseLeadData(
  client: DbClient,
  input: {
    leadId: string;
    evidence: PurchaseEvidenceInput;
    clock?: Clock;
  },
): Promise<{ payloadReleased: Record<string, unknown> }> {
  const clock = input.clock ?? systemClock;
  const { rows } = await client.query<{
    id: string;
    status: string;
    party_id: string;
    application_id: string;
    listing_id: string;
    fee_amount_cents: number;
    rs_tier: string;
  }>(
    `select id, status, party_id, application_id, listing_id, fee_amount_cents, rs_tier
     from lead where id = $1 for update`,
    [input.leadId],
  );
  const lead = rows[0];
  if (!lead) throw new AppError('lead not found', 'LEAD_NOT_FOUND');
  if (lead.status !== 'purchased') {
    throw new AppError(
      'lead data release requires purchased status (payment confirmed)',
      'RELEASE_BEFORE_PAYMENT',
    );
  }

  const existing = await client.query(
    `select 1 from lead_purchase_evidence where lead_id = $1`,
    [input.leadId],
  );
  if (existing.rows.length > 0) {
    const { rows: ev } = await client.query<{ payload_released: Record<string, unknown> }>(
      `select payload_released from lead_purchase_evidence where lead_id = $1`,
      [input.leadId],
    );
    return { payloadReleased: ev[0]!.payload_released };
  }

  // Exact payload handed over — contact + report access grant marker (no PII in events).
  const payloadReleased = {
    lead_id: lead.id,
    application_id: lead.application_id,
    listing_id: lead.listing_id,
    party_id: lead.party_id,
    rs_tier: lead.rs_tier,
    fee_amount_cents: lead.fee_amount_cents,
    contact_grant: true,
    report_access_grant: true,
    released_at: clock.now().toISOString(),
  };

  await client.query(
    `insert into lead_purchase_evidence (
       lead_id, purchased_by_party_id, session_id, ip, user_agent,
       tos_version, payload_released, released_at
     ) values ($1,$2,$3,$4::inet,$5,$6,$7::jsonb,$8)`,
    [
      input.leadId,
      input.evidence.purchasedByPartyId,
      input.evidence.sessionId,
      input.evidence.ip,
      input.evidence.userAgent ?? null,
      input.evidence.tosVersion,
      JSON.stringify(payloadReleased),
      clock.now(),
    ],
  );

  await client.query(`update lead set status = 'released' where id = $1`, [
    input.leadId,
  ]);

  // If recognition was deferred at purchase, recognize on release (obligation discharge).
  const mode = await resolveLeadFeeRecognition(client, clock.now());
  if (mode === 'deferred') {
    await postLedgerTransaction(client, {
      kind: 'lead_fee_recognition',
      idempotencyKey: `ledger:lead_fee_recognize:${input.leadId}`,
      occurredAt: clock.now(),
      clock,
      memo: `lead:${input.leadId}`,
      lines: recognizeDeferredLeadFeeLines(lead.fee_amount_cents),
    });
  }

  await emitDomainEvent(client, {
    aggregateType: 'lead',
    aggregateId: input.leadId,
    eventType: 'lead.released',
    payload: {
      evidence: true,
      session_id: input.evidence.sessionId,
      tos_version: input.evidence.tosVersion,
      // no IP / PII in domain event
      payload_keys: Object.keys(payloadReleased),
    },
    actorPartyId: input.evidence.purchasedByPartyId,
    actorKind: 'user',
    occurredAt: clock.now(),
  });

  return { payloadReleased };
}

/**
 * Purchase + release happy path. Payment failure prevents release.
 */
export async function purchaseAndReleaseLead(
  client: DbClient,
  input: {
    leadId: string;
    brokerOrgId: string;
    evidence: PurchaseEvidenceInput;
    clock?: Clock;
    simulatePaymentFailure?: boolean;
    alsoStripeCharge?: boolean;
  },
): Promise<{
  status: string;
  feeAmountCents: number;
  stripeChargeAmountCents: number | null;
  released: boolean;
  payloadReleased: Record<string, unknown> | null;
}> {
  const purchased = await purchaseLeadWithBalance(client, {
    leadId: input.leadId,
    brokerOrgId: input.brokerOrgId,
    clock: input.clock,
    simulatePaymentFailure: input.simulatePaymentFailure,
    alsoStripeCharge: input.alsoStripeCharge,
  });

  if (purchased.status !== 'purchased') {
    // Ensure no evidence / release
    const { rows } = await client.query(
      `select 1 from lead_purchase_evidence where lead_id = $1`,
      [input.leadId],
    );
    if (rows.length > 0) {
      throw new AppError('evidence written without payment', 'INVARIANT');
    }
    return {
      status: purchased.status,
      feeAmountCents: purchased.feeAmountCents,
      stripeChargeAmountCents: purchased.stripeChargeAmountCents,
      released: false,
      payloadReleased: null,
    };
  }

  const { payloadReleased } = await releaseLeadData(client, {
    leadId: input.leadId,
    evidence: input.evidence,
    clock: input.clock,
  });

  return {
    status: 'released',
    feeAmountCents: purchased.feeAmountCents,
    stripeChargeAmountCents: purchased.stripeChargeAmountCents,
    released: true,
    payloadReleased,
  };
}

/**
 * Reconciler: purchased leads without evidence/release → complete release.
 * Orphans from post-charge crash.
 */
export async function reconcileOrphanPurchases(
  client: DbClient,
  input: {
    defaultEvidence: PurchaseEvidenceInput;
    clock?: Clock;
  },
): Promise<{ resolvedLeadIds: string[] }> {
  const clock = input.clock ?? systemClock;
  const { rows } = await client.query<{ id: string }>(
    `select l.id from lead l
     left join lead_purchase_evidence e on e.lead_id = l.id
     where l.status = 'purchased' and e.lead_id is null`,
  );
  const resolved: string[] = [];
  for (const r of rows) {
    await releaseLeadData(client, {
      leadId: r.id,
      evidence: input.defaultEvidence,
      clock,
    });
    resolved.push(r.id);
    await emitDomainEvent(client, {
      aggregateType: 'lead',
      aggregateId: r.id,
      eventType: 'lead.orphan_reconciled',
      payload: { action: 'released' },
      actorKind: 'system',
      occurredAt: clock.now(),
    });
  }
  return { resolvedLeadIds: resolved };
}
