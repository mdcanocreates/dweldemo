/**
 * Disposable-database validation for migration 0071.
 * Skips unless STRIPE_SANDBOX_TEST_DATABASE_URL points at localhost.
 * A Stripe test secret is read only inside this process and is never asserted or logged.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import pg from 'pg';
import Stripe from 'stripe';
import { afterAll, describe, expect, it } from 'vitest';
import { handleStripeWebhook } from '../../src/http/stripe-payment-handlers.js';
import {
  assertSandboxPaymentSucceeded,
  createSandboxPaymentIntent,
  recordSandboxWebhook,
} from '../../src/modules/payments/stripe-sandbox.js';
import { AppError } from '../../src/modules/shared/errors.js';

const adminUrl = localDatabaseUrl();
const appUrl = adminUrl ? adminUrl.replace('://rbit:rbit@', '://rbit_app_user:rbit_app_user@') : '';
const db = adminUrl ? describe : describe.skip;

function localDatabaseUrl(): string {
  const url = process.env.STRIPE_SANDBOX_TEST_DATABASE_URL?.trim() ?? '';
  if (!url) return '';
  const lower = url.toLowerCase();
  if (lower.includes('rds.amazonaws.com') || lower.includes('rbitfinancial.com')) return '';
  if (!/127\.0\.0\.1|localhost/.test(lower)) return '';
  return url;
}

function localTestSecret(): string {
  const candidates = [
    process.env.STRIPE_SECRET_KEY?.trim() ?? '',
    envValue(path.resolve(process.cwd(), '.env'), 'STRIPE_SECRET_KEY'),
    envValue(path.resolve(process.cwd(), '.env.local'), 'STRIPE_SECRET_KEY'),
    envValue(path.resolve(process.cwd(), '../dwel/.env'), 'STRIPE_SECRET_KEY'),
    envValue(path.resolve(process.cwd(), '../dwel/.env.local'), 'STRIPE_SECRET_KEY'),
  ];
  return candidates.find((value) => value.startsWith('sk_test_')) ?? '';
}

function envValue(file: string, name: string): string {
  if (!existsSync(file)) return '';
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0 || trimmed.slice(0, eq).trim() !== name) continue;
    return trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
}

function redact(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const cleaned = message
    .replace(/sk_(test|live)_[A-Za-z0-9]+/g, 'sk_[redacted]')
    .replace(/pk_(test|live)_[A-Za-z0-9]+/g, 'pk_[redacted]')
        .replace(/whsec_[A-Za-z0-9]+/g, 'whsec_[redacted]')
    .replace(/_secret_[A-Za-z0-9]+/g, '_secret_[redacted]');
  return new Error(cleaned);
}

db('stripe sandbox database', () => {
  const admin = new pg.Pool({ connectionString: adminUrl });
  const app = new pg.Pool({ connectionString: appUrl });
  const partyA = randomUUID();
  const partyB = randomUUID();
  let ledgerBefore = 0;

  afterAll(async () => {
    await admin.end();
    await app.end();
  });

  it('forces row level security and stores no payload or contact columns', async () => {
    const flags = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relrowsecurity, relforcerowsecurity
       from pg_class
       where relname in ('stripe_sandbox_payment', 'stripe_webhook_event')`,
    );
    expect(flags.rows).toHaveLength(2);
    expect(flags.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    const columns = await admin.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
       from information_schema.columns
       where table_name in ('stripe_sandbox_payment', 'stripe_webhook_event')`,
    );
    const names = columns.rows.map((row) => `${row.table_name}.${row.column_name}`);
    for (const forbidden of ['raw_payload', 'email', 'phone', 'name', 'client_secret']) {
      expect(names.some((name) => name.endsWith(`.${forbidden}`))).toBe(false);
    }
    const ledger = await admin.query<{ n: number }>('select count(*)::int as n from ledger_transaction');
    ledgerBefore = ledger.rows[0]?.n ?? 0;
  });

  it('rejects live mode, livemode, and a real ledger link', async () => {
    await expect(
      admin.query(
        `insert into stripe_sandbox_payment
           (mode, purpose, party_id, amount_cents, payment_intent_id, status, livemode)
         values ('live', 'applicant_screening_fee', $1, 2900, $2, 'requires_payment_method', false)`,
        [partyA, `pi_mode_${randomUUID()}`],
      ),
    ).rejects.toThrow(/check constraint|violates/);
    await expect(
      admin.query(
        `insert into stripe_sandbox_payment
           (mode, purpose, party_id, amount_cents, payment_intent_id, status, livemode)
         values ('test', 'applicant_screening_fee', $1, 2900, $2, 'requires_payment_method', true)`,
        [partyA, `pi_live_${randomUUID()}`],
      ),
    ).rejects.toThrow(/check constraint|violates/);
    await expect(
      admin.query(
        `insert into stripe_sandbox_payment
           (mode, purpose, party_id, amount_cents, payment_intent_id, status, livemode, ledger_transaction_id)
         values ('test', 'applicant_screening_fee', $1, 2900, $2, 'succeeded', false, $3)`,
        [partyA, `pi_ledger_${randomUUID()}`, randomUUID()],
      ),
    ).rejects.toThrow(/check constraint|violates/);
  });

  it('shows a party only its own sandbox rows and hides webhook events', async () => {
    const paymentA = `pi_rls_${randomUUID()}`;
    const paymentB = `pi_rls_${randomUUID()}`;
    await withBypass(app, async (client) => {
      await client.query(
        `insert into stripe_sandbox_payment
           (mode, purpose, party_id, amount_cents, payment_intent_id, status, livemode)
         values
           ('test', 'applicant_screening_fee', $1, 2900, $3, 'succeeded', false),
           ('test', 'ny_path2_screening', $2, 2000, $4, 'succeeded', false)`,
        [partyA, partyB, paymentA, paymentB],
      );
    });

    const seenA = await withParty(app, partyA, async (client) => {
      const { rows } = await client.query<{ payment_intent_id: string }>(
        'select payment_intent_id from stripe_sandbox_payment',
      );
      return rows.map((row) => row.payment_intent_id);
    });
    const seenB = await withParty(app, partyB, async (client) => {
      const { rows } = await client.query<{ n: number }>('select count(*)::int as n from stripe_sandbox_payment');
      return rows[0]?.n ?? 0;
    });
    const seenNone = await withParty(app, '', async (client) => {
      const { rows } = await client.query<{ n: number }>('select count(*)::int as n from stripe_sandbox_payment');
      return rows[0]?.n ?? 0;
    });
    expect(seenA).toEqual([paymentA]);
    expect(seenB).toBe(1);
    expect(seenNone).toBe(0);

    const client = await app.connect();
    try {
      await expect(
        client.query(
          `insert into stripe_webhook_event
             (mode, provider_event_id, event_type, livemode, disposition)
           values ('test', $1, 'payment_intent.succeeded', false, 'succeeded')`,
          [`evt_hidden_${randomUUID()}`],
        ),
      ).rejects.toThrow(/row-level security|violates/);
    } finally {
      client.release();
    }
  });

  it('deduplicates webhooks and ignores failed, canceled, live, and mismatched events', async () => {
    const paymentId = `pi_evt_${randomUUID()}`;
    await admin.query(
      `insert into stripe_sandbox_payment
         (mode, purpose, party_id, amount_cents, payment_intent_id, status, livemode)
       values ('test', 'applicant_screening_fee', $1, 2900, $2, 'requires_payment_method', false)`,
      [partyA, paymentId],
    );
    const client = await admin.connect();
    try {
      const succeeded = await recordSandboxWebhook(client, event('evt_ok', 'payment_intent.succeeded', paymentId, 2900, false));
      const duplicate = await recordSandboxWebhook(client, event('evt_ok', 'payment_intent.succeeded', paymentId, 2900, false));
      expect(succeeded).toMatchObject({ duplicate: false, disposition: 'succeeded' });
      expect(duplicate).toMatchObject({ duplicate: true, disposition: 'duplicate' });

      const mismatched = await recordSandboxWebhook(
        client,
        event('evt_mismatch', 'payment_intent.succeeded', paymentId, 100, false),
      );
      expect(mismatched.disposition).toBe('amount_mismatch');

      const failedId = `pi_fail_${randomUUID()}`;
      await admin.query(
        `insert into stripe_sandbox_payment
           (mode, purpose, party_id, amount_cents, payment_intent_id, status, livemode)
         values ('test', 'applicant_screening_fee', $1, 2900, $2, 'requires_payment_method', false)`,
        [partyA, failedId],
      );
      const failed = await recordSandboxWebhook(client, event('evt_fail', 'payment_intent.payment_failed', failedId, 2900, false));
      const canceledId = `pi_cancel_${randomUUID()}`;
      await admin.query(
        `insert into stripe_sandbox_payment
           (mode, purpose, party_id, amount_cents, payment_intent_id, status, livemode)
         values ('test', 'applicant_screening_fee', $1, 2900, $2, 'requires_payment_method', false)`,
        [partyA, canceledId],
      );
      const canceled = await recordSandboxWebhook(client, event('evt_cancel', 'payment_intent.canceled', canceledId, 2900, false));
      const rejected = await recordSandboxWebhook(client, event('evt_live', 'payment_intent.succeeded', paymentId, 2900, true));
      expect(failed.disposition).toBe('failed');
      expect(canceled.disposition).toBe('canceled');
      expect(rejected.disposition).toBe('rejected_live');

      const statuses = await admin.query<{ payment_intent_id: string; status: string }>(
        `select payment_intent_id, status from stripe_sandbox_payment
         where payment_intent_id = any($1::text[])`,
        [[paymentId, failedId, canceledId]],
      );
      const byId = new Map(statuses.rows.map((row) => [row.payment_intent_id, row.status]));
      expect(byId.get(paymentId)).toBe('succeeded');
      expect(byId.get(failedId)).toBe('failed');
      expect(byId.get(canceledId)).toBe('canceled');
    } finally {
      client.release();
    }
  });

  it('accepts one signed webhook delivery and marks the replay as a duplicate', async () => {
    const previousMode = process.env.STRIPE_PAYMENT_MODE;
    const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const secret = 'whsec_prompt10_local_only';
    process.env.STRIPE_PAYMENT_MODE = 'test';
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    const paymentId = `pi_http_${randomUUID()}`;
    await admin.query(
      `insert into stripe_sandbox_payment
         (mode, purpose, party_id, amount_cents, payment_intent_id, status, livemode)
       values ('test', 'applicant_screening_fee', $1, 2900, $2, 'requires_payment_method', false)`,
      [partyA, paymentId],
    );
    const payload = JSON.stringify({
      id: `evt_http_${randomUUID()}`,
      object: 'event',
      type: 'payment_intent.succeeded',
      livemode: false,
      data: { object: { id: paymentId, object: 'payment_intent', amount: 2900, currency: 'usd', livemode: false } },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    try {
      const first = await postWebhook(admin, payload, header);
      const second = await postWebhook(admin, payload, header);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ received: true, duplicate: false, disposition: 'succeeded' });
      expect(second.body).toMatchObject({ duplicate: true, disposition: 'duplicate' });
      const bad = await postWebhook(admin, `${payload} `, header);
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe('invalid_signature');
    } finally {
      restoreEnv('STRIPE_PAYMENT_MODE', previousMode);
      restoreEnv('STRIPE_WEBHOOK_SECRET', previousSecret);
    }
  });

  it('does not write sandbox activity into the ledger', async () => {
    const ledger = await admin.query<{ n: number }>('select count(*)::int as n from ledger_transaction');
    expect(ledger.rows[0]?.n).toBe(ledgerBefore);
    const linked = await admin.query<{ n: number }>(
      'select count(*)::int as n from stripe_sandbox_payment where ledger_transaction_id is not null',
    );
    expect(linked.rows[0]?.n).toBe(0);
  });

  const secret = localTestSecret();
  const stripeApi = secret ? it : it.skip;

  stripeApi('creates, confirms, and retries one test PaymentIntent without a live charge', async () => {
    const previousMode = process.env.STRIPE_PAYMENT_MODE;
    const previousKey = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_PAYMENT_MODE = 'test';
    process.env.STRIPE_SECRET_KEY = secret;
    const stripe = new Stripe(secret, { apiVersion: '2025-02-24.acacia' });
    const applicationId = randomUUID();
    const client = await admin.connect();
    try {
      const created = await createSandboxPaymentIntent(client, {
        partyId: partyA,
        purpose: 'applicant_screening_fee',
        applicationId,
        state: null,
      });
      expect(created.sandbox).toBe(true);
      expect(created.paymentIntentId.startsWith('pi_')).toBe(true);
      expect(created.clientSecret.includes('_secret_')).toBe(true);

      const confirmed = await stripe.paymentIntents.confirm(created.paymentIntentId, {
        payment_method: 'pm_card_visa',
        return_url: 'https://example.com/sandbox-return',
      });
      expect(confirmed.status).toBe('succeeded');
      expect(confirmed.livemode).toBe(false);
      expect(confirmed.currency).toBe('usd');
      expect(confirmed.amount).toBe(created.amountCents);
      expect(confirmed.metadata.purpose).toBe('applicant_screening_fee');
      expect(confirmed.metadata.sandbox).toBe('true');
      expect(confirmed.metadata.mode).toBe('test');

      const retried = await createSandboxPaymentIntent(client, {
        partyId: partyA,
        purpose: 'applicant_screening_fee',
        applicationId,
        state: null,
      });
      expect(retried.paymentIntentId).toBe(created.paymentIntentId);
      const rows = await admin.query<{ n: number }>(
        'select count(*)::int as n from stripe_sandbox_payment where payment_intent_id = $1',
        [created.paymentIntentId],
      );
      expect(rows.rows[0]?.n).toBe(1);

      const verified = await assertSandboxPaymentSucceeded(client, {
        partyId: partyA,
        purpose: 'applicant_screening_fee',
        applicationId,
        paymentIntentId: created.paymentIntentId,
        state: null,
      });
      expect(verified.amountCents).toBe(created.amountCents);
      await expect(
        assertSandboxPaymentSucceeded(client, {
          partyId: partyB,
          purpose: 'applicant_screening_fee',
          applicationId,
          paymentIntentId: created.paymentIntentId,
          state: null,
        }),
      ).rejects.toMatchObject({ code: 'payment_not_found' });

      let declined = false;
      try {
        await stripe.paymentIntents.create(
          {
            amount: created.amountCents,
            currency: 'usd',
            payment_method: 'pm_card_chargeDeclined',
            confirm: true,
            automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
            metadata: { purpose: 'applicant_screening_fee', sandbox: 'true', mode: 'test' },
          },
          { idempotencyKey: `sandbox:declined:${applicationId}` },
        );
      } catch (err) {
        declined = err instanceof Stripe.errors.StripeError && (err.type === 'card_error' || err.code === 'card_declined');
        if (!declined) throw redact(err);
      }
      expect(declined).toBe(true);
      void declinedId;

      const ledger = await admin.query<{ n: number }>('select count(*)::int as n from ledger_transaction');
      expect(ledger.rows[0]?.n).toBe(ledgerBefore);
    } catch (err) {
      throw redact(err);
    } finally {
      client.release();
      restoreEnv('STRIPE_PAYMENT_MODE', previousMode);
      restoreEnv('STRIPE_SECRET_KEY', previousKey);
    }
  });
});

function event(
  id: string,
  type: string,
  paymentIntentId: string,
  amount: number,
  livemode: boolean,
): Stripe.Event {
  return {
    id,
    object: 'event',
    type,
    livemode,
    data: { object: { id: paymentIntentId, object: 'payment_intent', amount, currency: 'usd', livemode } },
  } as Stripe.Event;
}

async function withBypass<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function withParty<T>(pool: pg.Pool, partyId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('rbit.bypass_rls', 'off', true)`);
    await client.query(`select set_config('rbit.current_party_id', $1, true)`, [partyId]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function postWebhook(
  pool: pg.Pool,
  payload: string,
  signature: string,
): Promise<{ status: number; body: { error?: string; duplicate?: boolean; disposition?: string } }> {
  const req = Readable.from([Buffer.from(payload)]) as IncomingMessage;
  req.headers = { 'stripe-signature': signature };
  const captured: { status: number; body: { error?: string; duplicate?: boolean; disposition?: string } } = {
    status: 0,
    body: {},
  };
  const res = {
    writeHead(code: number) {
      captured.status = code;
    },
    end(body?: string) {
      captured.body = body ? JSON.parse(body) : {};
    },
  } as ServerResponse;
  await handleStripeWebhook(req, res, { pool } as never);
  return captured;
}

function restoreEnv(name: 'STRIPE_PAYMENT_MODE' | 'STRIPE_WEBHOOK_SECRET' | 'STRIPE_SECRET_KEY', previous: string | undefined) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}
