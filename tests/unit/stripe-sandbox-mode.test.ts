import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import Stripe from 'stripe';
import { describe, it } from 'vitest';
import { payAndRecordConsent } from '../../src/modules/applications/pay-consent.js';
import { executePayout } from '../../src/modules/payments/payout-rail.js';
import {
  liveChargesApproved,
  publishableMatchesMode,
  readStripePaymentMode,
  realPayoutsEnabled,
  secretMatchesMode,
} from '../../src/modules/payments/stripe-mode.js';
import { constructStripeEvent, publicStripeConfig } from '../../src/modules/payments/stripe-sandbox.js';
import { AppError } from '../../src/modules/shared/errors.js';
import { handleStripeWebhook } from '../../src/http/stripe-payment-handlers.js';

describe('stripe payment mode', () => {
  it('defaults to disabled and does not infer test mode from APP_ENV', () => {
    assert.deepEqual(readStripePaymentMode({ APP_ENV: 'production' } as NodeJS.ProcessEnv), {
      mode: 'disabled',
      invalid: false,
    });
  });

  it('rejects an unknown mode instead of switching credentials', () => {
    assert.deepEqual(readStripePaymentMode({ STRIPE_PAYMENT_MODE: 'stage' } as NodeJS.ProcessEnv), {
      mode: 'disabled',
      invalid: true,
    });
  });

  it('requires the matching key prefix and keeps payouts off', () => {
    assert.equal(secretMatchesMode('sk_test_example', 'test'), true);
    assert.equal(secretMatchesMode('sk_live_example', 'test'), false);
    assert.equal(publishableMatchesMode('pk_test_example', 'test'), true);
    assert.equal(publishableMatchesMode('pk_live_example', 'test'), false);
    assert.equal(liveChargesApproved({} as NodeJS.ProcessEnv), false);
    assert.equal(realPayoutsEnabled(), false);
  });

  it('verifies a Stripe webhook signature and rejects a tampered body', () => {
    const secret = 'whsec_sandbox_unit_only';
    const payload = JSON.stringify({
      id: 'evt_test_unit',
      object: 'event',
      type: 'payment_intent.succeeded',
      livemode: false,
      data: { object: { id: 'pi_test_unit', object: 'payment_intent', amount: 2000, currency: 'usd', livemode: false } },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const event = constructStripeEvent(payload, header, secret);
    assert.equal(event.type, 'payment_intent.succeeded');
    assert.throws(() => constructStripeEvent(payload + ' ', header, secret));
  });

  it('refuses live charges and payouts before any database or Stripe call', async () => {
    const env = {
      STRIPE_PAYMENT_MODE: 'live',
      STRIPE_LIVE_PAYMENTS_APPROVED: 'true',
      APP_ENV: 'production',
    } as NodeJS.ProcessEnv;
    assert.equal(readStripePaymentMode(env).mode, 'live');
    assert.equal(liveChargesApproved(env), true);
    assert.equal(realPayoutsEnabled(), false);
    const previous = process.env.STRIPE_PAYMENT_MODE;
    process.env.STRIPE_PAYMENT_MODE = 'live';
    try {
      await assert.rejects(
        () =>
          payAndRecordConsent({} as never, {
            applicationId: '00000000-0000-0000-0000-000000000001',
            partyId: '00000000-0000-0000-0000-000000000002',
            orgId: '00000000-0000-0000-0000-000000000003',
            consentIp: null,
            consentUserAgent: null,
          }),
        (err: unknown) => err instanceof AppError && err.code === 'live_payments_not_approved',
      );
      await assert.rejects(
        () =>
          executePayout({} as never, {
            amountCents: 100,
            payoutMethodRef: 'pm_test',
            idempotencyKey: 'payout-test',
            consumer: 'screening_rebate',
            consumerId: '00000000-0000-0000-0000-000000000004',
            partyId: '00000000-0000-0000-0000-000000000002',
          }),
        (err: unknown) => err instanceof AppError && err.code === 'payouts_not_approved',
      );
    } finally {
      if (previous === undefined) delete process.env.STRIPE_PAYMENT_MODE;
      else process.env.STRIPE_PAYMENT_MODE = previous;
    }
  });

  it('publishes a test key only in explicit test mode', () => {
    assert.deepEqual(
      publicStripeConfig({ STRIPE_PAYMENT_MODE: 'disabled', STRIPE_PUBLISHABLE_KEY: 'pk_test_unit' }),
      { mode: 'disabled', invalid: false, sandbox: false, publishableKey: null },
    );
    assert.equal(
      publicStripeConfig({ STRIPE_PAYMENT_MODE: 'test', STRIPE_PUBLISHABLE_KEY: 'pk_live_unit' }).publishableKey,
      null,
    );
    assert.equal(
      publicStripeConfig({ STRIPE_PAYMENT_MODE: 'test', STRIPE_PUBLISHABLE_KEY: 'pk_test_unit' }).sandbox,
      true,
    );
  });

  it('keeps the webhook closed unless test mode and a signing secret are set', async () => {
    const previousMode = process.env.STRIPE_PAYMENT_MODE;
    const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PAYMENT_MODE;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = responseCapture();
    await handleStripeWebhook(requestCapture(''), res.res, { pool: {} as never });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'stripe_webhook_disabled');
    if (previousMode === undefined) delete process.env.STRIPE_PAYMENT_MODE;
    else process.env.STRIPE_PAYMENT_MODE = previousMode;
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
  });
});

function requestCapture(body: string): IncomingMessage {
  const req = Readable.from([Buffer.from(body)]) as IncomingMessage;
  req.headers = {};
  return req;
}

function responseCapture(): { res: ServerResponse; status: number; body: { error?: string } } {
  const captured: { status: number; body: { error?: string } } = { status: 0, body: {} };
  const res = {
    writeHead(code: number) {
      captured.status = code;
    },
    end(payload?: string) {
      captured.body = payload ? (JSON.parse(payload) as { error?: string }) : {};
    },
  } as ServerResponse;
  return {
    res,
    get status() {
      return captured.status;
    },
    get body() {
      return captured.body;
    },
  };
}
