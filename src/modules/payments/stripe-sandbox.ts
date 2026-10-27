import Stripe from 'stripe';
import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';
import { screeningFeeForState } from '../renter/index.js';
import {
  liveChargesApproved,
  publishableMatchesMode,
  readStripePaymentMode,
  secretMatchesMode,
  type StripePaymentMode,
} from './stripe-mode.js';

const API_VERSION = '2025-02-24.acacia' as const;

export type SandboxPurpose = 'applicant_screening_fee' | 'ny_path2_screening';

export type StripeSandboxConfig = {
  mode: StripePaymentMode;
  invalid: boolean;
  sandbox: boolean;
  publishableKey: string | null;
};

export function publicStripeConfig(env: NodeJS.ProcessEnv = process.env): StripeSandboxConfig {
  const decision = readStripePaymentMode(env);
  if (decision.invalid || decision.mode !== 'test') {
    return { mode: decision.invalid ? 'disabled' : decision.mode, invalid: decision.invalid, sandbox: false, publishableKey: null };
  }
  const key = env.STRIPE_PUBLISHABLE_KEY?.trim() ?? '';
  return {
    mode: 'test',
    invalid: false,
    sandbox: true,
    publishableKey: publishableMatchesMode(key, 'test') ? key : null,
  };
}

function requireTestSecret(env: NodeJS.ProcessEnv): string {
  const decision = readStripePaymentMode(env);
  if (decision.invalid) {
    throw new AppError('Stripe payment mode is invalid', 'stripe_mode_invalid', 503);
  }
  if (decision.mode === 'disabled') {
    throw new AppError('Stripe sandbox payments are disabled', 'stripe_payments_disabled', 403);
  }
  if (decision.mode === 'live') {
    if (!liveChargesApproved(env)) {
      throw new AppError('Live Stripe charges are not approved', 'live_payments_not_approved', 403);
    }
    throw new AppError('Live Stripe charges are not enabled in this release', 'live_payments_not_approved', 403);
  }
  const secret = env.STRIPE_SECRET_KEY?.trim() ?? '';
  if (!secretMatchesMode(secret, 'test')) {
    throw new AppError('Sandbox mode requires a test secret key', 'stripe_mode_mismatch', 503);
  }
  return secret;
}

function stripeClient(secret: string): Stripe {
  return new Stripe(secret, { apiVersion: API_VERSION });
}

export async function createSandboxPaymentIntent(
  client: DbClient,
  input: {
    partyId: string;
    purpose: SandboxPurpose;
    applicationId?: string | null;
    state: string | null;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ paymentIntentId: string; clientSecret: string; amountCents: number; sandbox: true }> {
  const secret = requireTestSecret(env);
  const fee = await screeningFeeForState(client, input.purpose === 'ny_path2_screening' ? 'NY' : input.state);
  if (fee.amount_cents <= 0) {
    throw new AppError('No screening fee is due', 'payment_not_required', 409);
  }
  const stripe = stripeClient(secret);
  const intent = await stripe.paymentIntents.create(
    {
      amount: fee.amount_cents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        purpose: input.purpose,
        application_id: input.applicationId ?? '',
        sandbox: 'true',
        mode: 'test',
      },
    },
    { idempotencyKey: `sandbox:${input.purpose}:${input.applicationId ?? input.partyId}:${fee.amount_cents}` },
  );
  if (intent.livemode || !intent.client_secret) {
    throw new AppError('Refusing a live PaymentIntent in sandbox mode', 'stripe_mode_mismatch', 503);
  }
  await client.query(
    `insert into stripe_sandbox_payment (
       mode, purpose, application_id, party_id, amount_cents, currency, payment_intent_id, status, livemode
     ) values ('test', $1, $2, $3, $4, 'usd', $5, $6, false)
     on conflict (payment_intent_id) do update
       set status = excluded.status, updated_at = now()`,
    [
      input.purpose,
      input.applicationId ?? null,
      input.partyId,
      fee.amount_cents,
      intent.id,
      intent.status,
    ],
  );
  return {
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    amountCents: fee.amount_cents,
    sandbox: true,
  };
}

export async function assertSandboxPaymentSucceeded(
  client: DbClient,
  input: {
    partyId: string;
    purpose: SandboxPurpose;
    applicationId?: string | null;
    paymentIntentId: string;
    state: string | null;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ paymentIntentId: string; amountCents: number }> {
  const secret = requireTestSecret(env);
  const fee = await screeningFeeForState(client, input.purpose === 'ny_path2_screening' ? 'NY' : input.state);
  const { rows } = await client.query<{
    amount_cents: number;
    purpose: string;
    application_id: string | null;
    party_id: string | null;
  }>(
    `select amount_cents, purpose, application_id, party_id
     from stripe_sandbox_payment
     where payment_intent_id = $1 and mode = 'test'`,
    [input.paymentIntentId],
  );
  const row = rows[0];
  if (!row || row.party_id !== input.partyId || row.purpose !== input.purpose) {
    throw new AppError('Sandbox payment was not found', 'payment_not_found', 402);
  }
  if (input.applicationId && row.application_id !== input.applicationId) {
    throw new AppError('Sandbox payment does not match this application', 'payment_not_found', 402);
  }
  if (row.amount_cents !== fee.amount_cents) {
    throw new AppError('Sandbox payment amount does not match the server fee', 'payment_amount_mismatch', 402);
  }
  const intent = await stripeClient(secret).paymentIntents.retrieve(input.paymentIntentId);
  if (intent.livemode || intent.currency !== 'usd' || intent.amount !== fee.amount_cents) {
    throw new AppError('Stripe payment does not match the sandbox fee', 'payment_amount_mismatch', 402);
  }
  if (intent.status !== 'succeeded') {
    throw new AppError('Stripe payment has not succeeded', 'payment_failed', 402);
  }
  if (intent.metadata?.purpose !== input.purpose) {
    throw new AppError('Stripe payment purpose does not match', 'payment_not_found', 402);
  }
  await client.query(
    `update stripe_sandbox_payment
     set status = 'succeeded', updated_at = now()
     where payment_intent_id = $1 and ledger_transaction_id is null`,
    [input.paymentIntentId],
  );
  return { paymentIntentId: intent.id, amountCents: fee.amount_cents };
}

export function constructStripeEvent(rawBody: string, signature: string, secret: string): Stripe.Event {
  return stripeClient('sk_test_webhook_parser').webhooks.constructEvent(rawBody, signature, secret);
}

export async function recordSandboxWebhook(
  client: DbClient,
  event: Stripe.Event,
): Promise<{ duplicate: boolean; disposition: string }> {
  const object = event.data.object as { id?: string; amount?: number; livemode?: boolean; status?: string };
  const paymentIntentId = event.type.startsWith('payment_intent.') ? object.id ?? null : null;
  const livemode = Boolean(event.livemode || object.livemode);
  let disposition = 'ignored';
  if (livemode) disposition = 'rejected_live';
  else if (event.type === 'payment_intent.succeeded') disposition = 'succeeded';
  else if (event.type === 'payment_intent.payment_failed') disposition = 'failed';
  else if (event.type === 'payment_intent.canceled') disposition = 'canceled';

  if (!livemode && paymentIntentId && disposition === 'succeeded') {
    const existing = await client.query<{ amount_cents: number }>(
      `select amount_cents from stripe_sandbox_payment
       where payment_intent_id = $1 and mode = 'test' and livemode = false`,
      [paymentIntentId],
    );
    if (!existing.rows[0]) disposition = 'unmatched';
    else if (existing.rows[0].amount_cents !== object.amount) disposition = 'amount_mismatch';
  }

  const inserted = await client.query(
    `insert into stripe_webhook_event (
       mode, provider_event_id, event_type, payment_intent_id, livemode, disposition, processed_at
     ) values ('test', $1, $2, $3, $4, $5, now())
     on conflict (provider_event_id) do nothing
     returning id`,
    [event.id, event.type, paymentIntentId, livemode, disposition],
  );
  if (!inserted.rows[0]) return { duplicate: true, disposition: 'duplicate' };
  if (!livemode && paymentIntentId && (disposition === 'succeeded' || disposition === 'failed' || disposition === 'canceled')) {
    await client.query(
      `update stripe_sandbox_payment
       set status = $2, updated_at = now()
       where payment_intent_id = $1
         and mode = 'test'
         and livemode = false`,
      [paymentIntentId, disposition],
    );
  }
  return { duplicate: false, disposition };
}
