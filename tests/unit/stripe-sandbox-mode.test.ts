import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { describe, it } from 'vitest';
import {
  liveChargesApproved,
  publishableMatchesMode,
  readStripePaymentMode,
  realPayoutsEnabled,
  secretMatchesMode,
} from '../../src/modules/payments/stripe-mode.js';
import { constructStripeEvent } from '../../src/modules/payments/stripe-sandbox.js';

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
});
