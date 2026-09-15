import type { DbClient } from '../../db/pool.js';
import { postLedgerTransaction } from '../ledger/index.js';
import { recordScreeningConsent } from '../screening/consent.js';
import { AppError } from '../shared/errors.js';
import { getVendorRegistry } from '../vendors/index.js';
import { recordApplicantPurchasedReport } from '../renter/ny-report.js';
import { screeningFeeForState } from '../renter/screening-fee.js';
import { getRenterProfile } from '../renter/profile.js';

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
  },
): Promise<{
  consent_id: string;
  disclosure_version: string;
  fee_cents: number;
  charge_id: string;
  ledger_transaction_id: string;
  status: string;
}> {
  void input.paymentConfirmed; // never authoritative

  if (input.paymentIntentId) {
    // Placeholder until real Stripe verification lands in Part I.
    throw new AppError(
      'payment_intent verification not yet enabled — DEV uses PaymentRail charge only',
      'payment_intent_unsupported',
      501,
    );
  }

  const { rows: apps } = await client.query<{
    id: string;
    status: string;
    party_id: string;
  }>(
    `select id, status, party_id from application where id = $1 for update`,
    [input.applicationId],
  );
  const app = apps[0];
  if (!app) throw new AppError('application not found', 'application_not_found', 404);
  if (app.party_id !== input.partyId) {
    throw new AppError('forbidden', 'auth_forbidden', 403);
  }

  const profile = await getRenterProfile(client, input.partyId);
  const fee = await screeningFeeForState(client, profile?.preferred_state ?? null);

  // Server-side charge is the payment verification (stub in DEV).
  const rail = getVendorRegistry().paymentRail();
  const charge = await rail.createCharge({
    amountCents: fee.amount_cents,
    currency: 'usd',
    idempotencyKey: `screening_fee:${input.applicationId}`,
    metadata: {
      application_id: input.applicationId,
      party_id: input.partyId,
      kind: 'applicant_screening_fee',
    },
  });
  if (charge.status === 'failed') {
    throw new AppError(
      charge.failureCode ?? 'payment failed',
      'payment_failed',
      402,
    );
  }

  const ledger = await postLedgerTransaction(client, {
    kind: 'applicant_screening_fee',
    idempotencyKey: `ledger:screening_fee:${input.applicationId}`,
    memo: `applicant_screening_fee ${fee.amount_cents}c → rbit_screening_revenue`,
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

  const consent = await recordScreeningConsent(client, {
    applicationId: input.applicationId,
    consentIp: input.consentIp,
    consentUserAgent: input.consentUserAgent,
  });

  // Move into awaiting_consent → screening_authorized path marker for tracker UX.
  // Keep draft/awaiting_landlord_interest semantics: after paid consent, mark awaiting_landlord_interest
  // if still draft so G-3 can show "Waiting for landlord review".
  if (app.status === 'draft') {
    await client.query(
      `update application set status = 'awaiting_landlord_interest' where id = $1 and status = 'draft'`,
      [input.applicationId],
    );
  }

  if (input.nyPath2 || profile?.preferred_state === 'NY') {
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
    fee_cents: fee.amount_cents,
    charge_id: charge.chargeId,
    ledger_transaction_id: ledger.transactionId,
    status: after[0]!.status,
  };
}
