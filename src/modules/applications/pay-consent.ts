import type { DbClient } from '../../db/pool.js';
import { postLedgerTransaction } from '../ledger/index.js';
import {
  recordScreeningConsent,
  grantReportAccess,
  findReusableScreening,
} from '../screening/index.js';
import { AppError } from '../shared/errors.js';
import { getVendorRegistry } from '../vendors/index.js';
import { readStripePaymentMode } from '../payments/stripe-mode.js';
import { assertSandboxPaymentSucceeded } from '../payments/stripe-sandbox.js';
import {
  recordApplicantPurchasedReport,
  screeningFeeForState,
  getRenterProfile,
} from '../renter/index.js';

/**
 * Atomic screening fee charge + FCRA consent.
 *
 * DEV: PaymentRail (stripe_stub) createCharge success is the only payment proof.
 * Client-supplied payment_confirmed is ignored — never trust the browser.
 *
 * Before Part I / production Connect: replace stub charge with server-side
 * Stripe PaymentIntent retrieval/confirm (status=succeeded) using payment_intent_id
 * from Elements; do not reintroduce a client boolean as authority.
 */
export async function payAndRecordConsent(
  client: DbClient,
  input: {
    applicationId: string;
    partyId: string;
    orgId: string;
    consentIp: string | null;
    consentUserAgent: string | null;
    /** @deprecated Ignored. Kept so old clients do not 400; never authorizes payment. */
    paymentConfirmed?: boolean;
    /** When true, also stamp NY Path 2 applicant_purchased report (interim_v1). */
    nyPath2?: boolean;
    /**
     * Future (Part I): Stripe PaymentIntent id from Elements.
     * When set, server must verify PI succeeded before consent (not yet implemented).
     */
    paymentIntentId?: string | null;
    /**
     * Internal preview only — uses PaymentRail stub, never live Stripe/Certn/SES.
     * Ownership must already be resolved to preview_party_id by the HTTP layer.
     */
    preview?: boolean;
  },
): Promise<{
  consent_id: string;
  disclosure_version: string;
  fee_cents: number;
  charge_id: string | null;
  ledger_transaction_id: string | null;
  status: string;
  preview: boolean;
  reused_existing_report: boolean;
  reuse_reason: string | null;
}> {
  void input.paymentConfirmed; // never authoritative
  const preview = Boolean(input.preview);

  const stripeMode = readStripePaymentMode();
  if (stripeMode.invalid && !preview) {
    throw new AppError('Stripe payment mode is invalid', 'stripe_mode_invalid', 503);
  }
  if (stripeMode.mode === 'live' && !preview) {
    throw new AppError('Live Stripe charges are not approved', 'live_payments_not_approved', 403);
  }

  const { rows: apps } = await client.query<{
    id: string;
    status: string;
    party_id: string;
    org_id: string;
  }>(
    `select id, status, party_id, org_id from application where id = $1 for update`,
    [input.applicationId],
  );
  const app = apps[0];
  if (!app) throw new AppError('application not found', 'application_not_found', 404);
  if (app.party_id !== input.partyId) {
    throw new AppError('forbidden', 'auth_forbidden', 403);
  }

  const profile = await getRenterProfile(client, input.partyId);
  const fee = await screeningFeeForState(client, profile?.preferred_state ?? null);
  const reuse = await findReusableScreening(client, {
    partyId: input.partyId,
    applicationId: input.applicationId,
    feeCentsIfNew: fee.amount_cents,
  });

  let chargeId: string | null = null;
  let ledgerTransactionId: string | null = null;
  let feeCharged = fee.amount_cents;

  let sharedExistingReport = false;
  if (reuse.reusable) {
    feeCharged = 0;
    if (reuse.report_id) {
      const grant = await grantReportAccess(client, {
        reportId: reuse.report_id,
        grantedToOrgId: app.org_id,
        actorPartyId: input.partyId,
        applicationId: input.applicationId,
      });
      // Successful share of a live report — do not open a second Certn order.
      sharedExistingReport = grant.granted === true && grant.repull === false;
    }
  } else if (stripeMode.mode === 'test' && !preview) {
    if (!input.paymentIntentId) {
      throw new AppError('A succeeded sandbox PaymentIntent is required', 'payment_required', 402);
    }
    const verified = await assertSandboxPaymentSucceeded(client, {
      partyId: input.partyId,
      purpose: 'applicant_screening_fee',
      applicationId: input.applicationId,
      paymentIntentId: input.paymentIntentId,
      state: profile?.preferred_state ?? null,
    });
    chargeId = verified.paymentIntentId;
    feeCharged = verified.amountCents;
  } else {
    // Disabled mode keeps the in-memory rail. Sandbox mode never posts that rail to the ledger.
    const rail = getVendorRegistry().paymentRail();
    const charge = await rail.createCharge({
      amountCents: fee.amount_cents,
      currency: 'usd',
      idempotencyKey: preview
        ? `preview_screening_fee:${input.applicationId}`
        : `screening_fee:${input.applicationId}`,
      metadata: {
        application_id: input.applicationId,
        party_id: input.partyId,
        kind: 'applicant_screening_fee',
        preview: preview ? 'true' : 'false',
        external_side_effects: 'false',
      },
    });
    if (charge.status === 'failed') {
      throw new AppError(
        charge.failureCode ?? 'payment failed',
        'payment_failed',
        402,
      );
    }
    chargeId = charge.chargeId;

    const ledger = await postLedgerTransaction(client, {
      kind: 'applicant_screening_fee',
      idempotencyKey: preview
        ? `ledger:preview_screening_fee:${input.applicationId}`
        : `ledger:screening_fee:${input.applicationId}`,
      memo: preview
        ? `preview applicant_screening_fee ${fee.amount_cents}c (no live Stripe)`
        : `applicant_screening_fee ${fee.amount_cents}c → rbit_screening_revenue`,
      lines: [
        {
          accountCode: 'asset:cash:stripe',
          direction: 'dr',
          amountCents: fee.amount_cents,
          counterpartyPartyId: input.partyId,
        },
        {
          accountCode: 'revenue:rbit_screening_revenue',
          direction: 'cr',
          amountCents: fee.amount_cents,
        },
      ],
    });
    ledgerTransactionId = ledger.transactionId;
  }

  // Consent is always application-scoped — reuse never skips authorization.
  const consent = await recordScreeningConsent(client, {
    applicationId: input.applicationId,
    consentIp: input.consentIp,
    consentUserAgent: input.consentUserAgent,
  });

  // Case B share complete: authorized screening result available without new vendor order.
  if (sharedExistingReport) {
    await client.query(
      `update application
       set status = 'screening_complete',
           screening_authorized_at = coalesce(screening_authorized_at, now()),
           screened_at = coalesce(screened_at, now())
       where id = $1
         and status in ('awaiting_consent', 'screening_authorized', 'draft')`,
      [input.applicationId],
    );
  } else if (app.status === 'awaiting_consent') {
    // Case A: ready for provider submit (new Certn/demo order).
    await client.query(
      `update application set status = 'screening_authorized' where id = $1 and status = 'awaiting_consent'`,
      [input.applicationId],
    );
  }
  if (!sharedExistingReport && app.status === 'draft') {
    await client.query(
      `update application set status = 'awaiting_landlord_interest' where id = $1 and status = 'draft'`,
      [input.applicationId],
    );
  }

  if (!preview && !reuse.reusable && (input.nyPath2 || profile?.preferred_state === 'NY')) {
    await recordApplicantPurchasedReport(client, {
      partyId: input.partyId,
      stateJurisdiction: profile?.preferred_state ?? 'NY',
    });
  }

  const { rows: after } = await client.query<{ status: string }>(
    `select status from application where id = $1`,
    [input.applicationId],
  );

  return {
    consent_id: consent.consentId,
    disclosure_version: consent.disclosureVersion,
    fee_cents: feeCharged,
    charge_id: chargeId,
    ledger_transaction_id: ledgerTransactionId,
    status: after[0]!.status,
    preview,
    reused_existing_report: reuse.reusable,
    reuse_reason: reuse.reusable ? reuse.reason : null,
  };
}
