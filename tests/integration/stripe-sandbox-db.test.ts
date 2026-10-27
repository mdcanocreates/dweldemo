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
import {
  handleCreateSandboxPaymentIntent,
  handleStripePaymentConfig,
  handleStripeWebhook,
} from '../../src/http/stripe-payment-handlers.js';
import { insertUserSession } from '../../src/modules/auth/session.js';
import { executePayout } from '../../src/modules/payments/payout-rail.js';
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
      const succeededId = `evt_ok_${randomUUID()}`;
      const succeeded = await recordSandboxWebhook(client, event(succeededId, 'payment_intent.succeeded', paymentId, 2900, false));
      const duplicate = await recordSandboxWebhook(client, event(succeededId, 'payment_intent.succeeded', paymentId, 2900, false));
      expect(succeeded).toMatchObject({ duplicate: false, disposition: 'succeeded' });
      expect(duplicate).toMatchObject({ duplicate: true, disposition: 'duplicate' });

      const mismatched = await recordSandboxWebhook(
        client,
        event(`evt_mismatch_${randomUUID()}`, 'payment_intent.succeeded', paymentId, 100, false),
      );
      expect(mismatched.disposition).toBe('amount_mismatch');

      const failedId = `pi_fail_${randomUUID()}`;
      await admin.query(
        `insert into stripe_sandbox_payment
           (mode, purpose, party_id, amount_cents, payment_intent_id, status, livemode)
         values ('test', 'applicant_screening_fee', $1, 2900, $2, 'requires_payment_method', false)`,
        [partyA, failedId],
      );
      const failed = await recordSandboxWebhook(client, event(`evt_fail_${randomUUID()}`, 'payment_intent.payment_failed', failedId, 2900, false));
      const canceledId = `pi_cancel_${randomUUID()}`;
      await admin.query(
        `insert into stripe_sandbox_payment
           (mode, purpose, party_id, amount_cents, payment_intent_id, status, livemode)
         values ('test', 'applicant_screening_fee', $1, 2900, $2, 'requires_payment_method', false)`,
        [partyA, canceledId],
      );
      const canceled = await recordSandboxWebhook(client, event(`evt_cancel_${randomUUID()}`, 'payment_intent.canceled', canceledId, 2900, false));
      const rejected = await recordSandboxWebhook(client, event(`evt_live_${randomUUID()}`, 'payment_intent.succeeded', paymentId, 2900, true));
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
      const replayPool = new pg.Pool({ connectionString: adminUrl });
      try {
        const replayed = await postWebhook(replayPool, payload, header);
        expect(replayed.body).toMatchObject({ duplicate: true, disposition: 'duplicate' });
      } finally {
        await replayPool.end();
      }
      const ignoredClient = await admin.connect();
      try {
        const ignored = await recordSandboxWebhook(
          ignoredClient,
          event(`evt_unknown_${randomUUID()}`, 'charge.refunded', paymentId, 2900, false),
        );
        expect(ignored.disposition).toBe('ignored');
      } finally {
        ignoredClient.release();
      }
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

  stripeApi('confirms an authenticated sandbox PaymentIntent and leaves the ledger unchanged', async () => {
    const previousMode = process.env.STRIPE_PAYMENT_MODE;
    const previousKey = process.env.STRIPE_SECRET_KEY;
    const previousPublishable = process.env.STRIPE_PUBLISHABLE_KEY;
    process.env.STRIPE_PAYMENT_MODE = 'test';
    process.env.STRIPE_SECRET_KEY = secret;
    const stripe = new Stripe(secret, { apiVersion: '2025-02-24.acacia' });
    const client = await admin.connect();
    try {
      const seeded = await seedDisposableApplication(client, 'TX');
      const other = await seedDisposableApplication(client, 'TX');
      const session = await insertUserSession(client, {
        partyId: seeded.partyId,
        remember: false,
        now: new Date(),
        elevationTtlMs: 60_000,
      });
      const otherSession = await insertUserSession(client, {
        partyId: other.partyId,
        remember: false,
        now: new Date(),
        elevationTtlMs: 60_000,
      });

      process.env.STRIPE_SECRET_KEY = 'sk_live_not_a_real_key';
      const rejectedLive = await postJson(
        admin,
        { purpose: 'applicant_screening_fee', application_id: seeded.applicationId, amount_cents: 50 },
        session.credential,
      );
      expect(rejectedLive.status).toBe(503);
      expect(rejectedLive.body.error).toBe('stripe_mode_mismatch');
      process.env.STRIPE_SECRET_KEY = secret;

      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_not_a_real_key';
      const hiddenLiveKey = captureResponse();
      await handleStripePaymentConfig({} as IncomingMessage, hiddenLiveKey.res);
      expect(hiddenLiveKey.body.publishable_key).toBeNull();
      const publishable = previousPublishable?.startsWith('pk_test_') ? previousPublishable : '';
      process.env.STRIPE_PUBLISHABLE_KEY = publishable;
      const shownTestKey = captureResponse();
      await handleStripePaymentConfig({} as IncomingMessage, shownTestKey.res);
      expect(shownTestKey.body.sandbox).toBe(Boolean(publishable));
      expect(String(shownTestKey.body.publishable_key ?? '').startsWith('pk_live_')).toBe(false);

      const payoutsBefore = await stripe.payouts.list({ limit: 5 });
      const cashBefore = await cashLedgerCents(admin);
      const created = await postJson(
        admin,
        { purpose: 'applicant_screening_fee', application_id: seeded.applicationId, amount_cents: 50 },
        session.credential,
      );
      expect(created.status).toBe(201);
      expect(created.body.amount_cents).not.toBe(50);
      expect(String(created.body.payment_intent_id).startsWith('pi_')).toBe(true);
      expect(created.body.sandbox).toBe(true);
      const paymentIntentId = String(created.body.payment_intent_id);
      const amountCents = Number(created.body.amount_cents);

      const foreign = await postJson(
        admin,
        { purpose: 'applicant_screening_fee', application_id: seeded.applicationId },
        otherSession.credential,
      );
      expect(foreign.status).toBe(403);

      const confirmed = await stripe.paymentIntents.confirm(paymentIntentId, {
        payment_method: 'pm_card_visa',
        return_url: 'https://example.com/sandbox-return',
      });
      expect(confirmed.status).toBe('succeeded');
      expect(confirmed.livemode).toBe(false);
      expect(confirmed.currency).toBe('usd');
      expect(confirmed.amount).toBe(amountCents);
      expect(confirmed.metadata.purpose).toBe('applicant_screening_fee');
      expect(confirmed.metadata.application_id).toBe(seeded.applicationId);
      expect(confirmed.metadata.sandbox).toBe('true');

      const retrieved = await stripe.paymentIntents.retrieve(paymentIntentId);
      expect(retrieved.status).toBe('succeeded');
      expect(retrieved.livemode).toBe(false);

      const stored = await admin.query<{ party_id: string; amount_cents: number; status: string; livemode: boolean }>(
        `select party_id, amount_cents, status, livemode
         from stripe_sandbox_payment where payment_intent_id = $1`,
        [paymentIntentId],
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0]).toMatchObject({
        party_id: seeded.partyId,
        amount_cents: amountCents,
        livemode: false,
      });

      const verified = await assertSandboxPaymentSucceeded(client, {
        partyId: seeded.partyId,
        purpose: 'applicant_screening_fee',
        applicationId: seeded.applicationId,
        paymentIntentId,
        state: 'TX',
      });
      expect(verified.amountCents).toBe(amountCents);
      await expect(
        assertSandboxPaymentSucceeded(client, {
          partyId: other.partyId,
          purpose: 'applicant_screening_fee',
          applicationId: seeded.applicationId,
          paymentIntentId,
          state: 'TX',
        }),
      ).rejects.toMatchObject({ code: 'payment_not_found' });

      const webhookSecret = 'whsec_prompt11_local_only';
      process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
      const payload = JSON.stringify({
        id: `evt_prompt11_${randomUUID()}`,
        object: 'event',
        type: 'payment_intent.succeeded',
        livemode: false,
        data: { object: { id: paymentIntentId, object: 'payment_intent', amount: amountCents, currency: 'usd', livemode: false } },
      });
      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
      const delivered = await postWebhook(admin, payload, header);
      const replayPool = new pg.Pool({ connectionString: adminUrl });
      try {
        const duplicate = await postWebhook(replayPool, payload, header);
        expect(delivered.body.disposition).toBe('succeeded');
        expect(duplicate.body).toMatchObject({ duplicate: true });
      } finally {
        await replayPool.end();
      }

      const canceled = await createSandboxPaymentIntent(client, {
        partyId: seeded.partyId,
        purpose: 'applicant_screening_fee',
        applicationId: other.applicationId,
        state: 'TX',
      });
      await stripe.paymentIntents.cancel(canceled.paymentIntentId);
      const canceledEvent = event(
        `evt_cancel_${randomUUID()}`,
        'payment_intent.canceled',
        canceled.paymentIntentId,
        canceled.amountCents,
        false,
      );
      expect((await recordSandboxWebhook(client, canceledEvent)).disposition).toBe('canceled');
      await expect(
        assertSandboxPaymentSucceeded(client, {
          partyId: seeded.partyId,
          purpose: 'applicant_screening_fee',
          applicationId: other.applicationId,
          paymentIntentId: canceled.paymentIntentId,
          state: 'TX',
        }),
      ).rejects.toMatchObject({ code: 'payment_failed' });

      let declined = false;
      try {
        await stripe.paymentIntents.create(
          {
            amount: amountCents,
            currency: 'usd',
            payment_method: 'pm_card_chargeDeclined',
            confirm: true,
            automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
            metadata: { purpose: 'applicant_screening_fee', sandbox: 'true', mode: 'test' },
          },
          { idempotencyKey: `sandbox:declined:${seeded.applicationId}` },
        );
      } catch (err) {
        declined =
          err instanceof Stripe.errors.StripeCardError ||
          (err instanceof Stripe.errors.StripeError && err.code === 'card_declined');
        if (!declined) throw redact(err);
      }
      expect(declined).toBe(true);

      await executePayout(client, {
        partyId: seeded.partyId,
        amountCents: 100,
        payoutMethodRef: 'pm_prompt11_stub',
        consumer: 'screening_rebate',
        consumerId: seeded.applicationId,
        idempotencyKey: `prompt11-payout-${seeded.applicationId}`,
      });
      const payoutsAfter = await stripe.payouts.list({ limit: 5 });
      expect(payoutsAfter.data.map((row) => row.id)).toEqual(payoutsBefore.data.map((row) => row.id));
      expect(await cashLedgerCents(admin)).toBe(cashBefore);
      const ledger = await admin.query<{ n: number }>('select count(*)::int as n from ledger_transaction');
      expect(ledger.rows[0]?.n).toBe(ledgerBefore);
    } catch (err) {
      throw redact(err);
    } finally {
      client.release();
      restoreEnv('STRIPE_PAYMENT_MODE', previousMode);
      restoreEnv('STRIPE_SECRET_KEY', previousKey);
      restoreEnv('STRIPE_PUBLISHABLE_KEY', previousPublishable);
      delete process.env.STRIPE_WEBHOOK_SECRET;
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

function restoreEnv(
  name: 'STRIPE_PAYMENT_MODE' | 'STRIPE_WEBHOOK_SECRET' | 'STRIPE_SECRET_KEY' | 'STRIPE_PUBLISHABLE_KEY',
  previous: string | undefined,
) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

async function seedDisposableApplication(
  client: pg.PoolClient,
  state: string,
): Promise<{ partyId: string; applicationId: string }> {
  const label = `prompt11-${randomUUID()}`;
  const org = await client.query<{ id: string }>(
    `insert into org (kind, legal_name, display_name) values ('landlord', $1, $1) returning id`,
    [label],
  );
  const address = await client.query<{ id: string }>(
    `insert into address (raw_input, normalized_hash, normalizer_vendor, normalizer_version)
     values ('prompt11 disposable', $1, 'prompt11', '1') returning id`,
    [label],
  );
  const property = await client.query<{ id: string }>(
    `insert into property (address_id, property_type) values ($1, 'sfr') returning id`,
    [address.rows[0]!.id],
  );
  const unit = await client.query<{ id: string }>(
    `insert into unit (property_id, unit_label_normalized) values ($1, '1') returning id`,
    [property.rows[0]!.id],
  );
  const listing = await client.query<{ id: string }>(
    `insert into listing (org_id, unit_id, origin, rent_amount_cents, status)
     values ($1, $2, 'manual', 150000, 'active') returning id`,
    [org.rows[0]!.id, unit.rows[0]!.id],
  );
  const party = await client.query<{ id: string }>(
    `insert into party (kind) values ('person') returning id`,
  );
  await client.query(
    `insert into renter_profile (party_id, preferred_state) values ($1, $2)`,
    [party.rows[0]!.id, state],
  );
  const application = await client.query<{ id: string }>(
    `insert into application (
       party_id, renter_profile_id, listing_id, unit_id, org_id, entry_point, status
     )
     select $1, id, $2, $3, $4, 'renter_initiated', 'draft'
     from renter_profile where party_id = $1
     returning id`,
    [party.rows[0]!.id, listing.rows[0]!.id, unit.rows[0]!.id, org.rows[0]!.id],
  );
  return { partyId: party.rows[0]!.id, applicationId: application.rows[0]!.id };
}

async function cashLedgerCents(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `select coalesce(sum(e.amount_cents), 0)::text as n
     from ledger_entry e
     join ledger_account a on a.id = e.account_id
     where a.code in ('asset:cash:stripe', 'revenue:rbit_screening_revenue')`,
  );
  return Number(rows[0]?.n ?? 0);
}

async function postJson(
  pool: pg.Pool,
  body: unknown,
  credential: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage;
  req.headers = { cookie: `rbit_session=${encodeURIComponent(credential)}` };
  req.socket = { remoteAddress: '127.0.0.1' } as IncomingMessage['socket'];
  const captured = captureResponse();
  await handleCreateSandboxPaymentIntent(req, captured.res, { pool } as never);
  return { status: captured.status, body: captured.body };
}

function captureResponse(): {
  res: ServerResponse;
  status: number;
  body: Record<string, unknown>;
} {
  const captured: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
  const res = {
    writeHead(code: number) {
      captured.status = code;
    },
    end(payload?: string) {
      captured.body = payload ? (JSON.parse(payload) as Record<string, unknown>) : {};
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
