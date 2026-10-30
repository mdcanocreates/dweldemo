import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { constructStripeEvent } from '../../src/modules/payments/stripe-sandbox.js';

describe('stripe webhook signature', () => {
  it('accepts the matching secret and rejects a different one', () => {
    const payload = JSON.stringify({
      id: 'evt_test_isolation',
      object: 'event',
      api_version: '2025-02-24.acacia',
      created: 1_700_000_000,
      type: 'payment_intent.succeeded',
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      data: { object: { id: 'pi_test', object: 'payment_intent' } },
    });
    const secret = 'whsec_isolation_test_secret';
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(constructStripeEvent(payload, header, secret).id).toBe('evt_test_isolation');
    expect(() => constructStripeEvent(payload, header, 'whsec_other_secret')).toThrow();
  });
});
