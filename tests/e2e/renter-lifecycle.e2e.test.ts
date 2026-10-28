/**
 * Renter lifecycle through the HTTP API on disposable Postgres.
 * Creates an account, saves a profile, signs out, signs back in, applies to a
 * listing, and checks that a later profile edit does not rewrite the snapshot.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiRouter } from '../../src/http/router.js';
import { restoreSnapshotFromFreezeEvent } from '../../src/modules/renter/intake.js';
import { resetApplicationCreationRateLimits } from '../../src/modules/applications/create.js';
import { seedPhase5Listing } from '../helpers/phase5.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import type { DbPool } from '../../src/db/pool.js';

const SERVICE_TOKEN = 'renter-lifecycle-token-32chars!';

type ApiResult = {
  status: number;
  body: Record<string, unknown>;
  cookie: string | null;
};

function cookieFrom(headers: IncomingHttpHeaders): string | null {
  const raw = headers['set-cookie'];
  const lines = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const line of lines) {
    const match = /^rbit_session=([^;]+)/.exec(line);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

function request(
  port: number,
  method: string,
  path: string,
  opts?: { body?: Record<string, unknown>; cookie?: string | null; token?: string },
): Promise<ApiResult> {
  return new Promise((resolve, reject) => {
    const payload = opts?.body ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    if (opts?.cookie) headers.Cookie = `rbit_session=${encodeURIComponent(opts.cookie)}`;
    if (opts?.token) headers.Authorization = `Bearer ${opts.token}`;
    const req = http.request({ hostname: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: Record<string, unknown> = {};
        if (raw) {
          try {
            body = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            body = { raw };
          }
        }
        resolve({ status: res.statusCode ?? 0, body, cookie: cookieFrom(res.headers) });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('renter lifecycle', () => {
  let db: TestDb;
  let appPool: DbPool;
  let server: http.Server;
  let port: number;
  let listingA = '';
  let listingB = '';
  let lineA = '';
  const email = `renter-${randomUUID().slice(0, 8)}@example.com`;
  const savedEnv = {
    NODE_ENV: process.env.NODE_ENV,
    APP_ENV: process.env.APP_ENV,
    AUTH_RETURN_REDEEM_TOKEN: process.env.AUTH_RETURN_REDEEM_TOKEN,
    AUTH_EMAIL_ALLOWLIST: process.env.AUTH_EMAIL_ALLOWLIST,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    DWEL_INTERNAL_SERVICE_TOKEN: process.env.DWEL_INTERNAL_SERVICE_TOKEN,
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'development';
    process.env.AUTH_RETURN_REDEEM_TOKEN = '1';
    process.env.AUTH_EMAIL_ALLOWLIST = email;
    process.env.EMAIL_PROVIDER = 'stub';
    process.env.DWEL_INTERNAL_SERVICE_TOKEN = SERVICE_TOKEN;
    resetApplicationCreationRateLimits();
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);
    const seeded = await withBypass(db.pool, async (client) => {
      const first = await seedPhase5Listing(client, db.kms, { rentCents: 180000 });
      const second = await seedPhase5Listing(client, db.kms, { rentCents: 210000 });
      await client.query(`update listing set status = 'active' where id = any($1::uuid[])`, [
        [first.listingId, second.listingId],
      ]);
      await client.query(
        `insert into config_version (
           id, namespace, version, payload, effective_from,
           proposed_by_party_id, approved_by_party_id, approved_at
         ) values (
           gen_random_uuid(), 'application_access', 'renter-lifecycle',
           '{"token_ttl_ms":604800000}'::jsonb, now(), $1, $1, now()
         )`,
        [first.ownerPartyId],
      );
      const address = await client.query<{ line1: string }>(
        `select coalesce(nullif(btrim(a.line1), ''), a.raw_input) as line1
           from listing l
           join unit u on u.id = l.unit_id
           join property p on p.id = u.property_id
           join address a on a.id = p.address_id
          where l.id = $1`,
        [first.listingId],
      );
      return {
        listingA: first.listingId,
        listingB: second.listingId,
        lineA: address.rows[0]?.line1 ?? '',
      };
    });
    listingA = seeded.listingA;
    listingB = seeded.listingB;
    lineA = seeded.lineA;
    const router = createApiRouter({ pool: appPool });
    server = http.createServer(async (req, res) => {
      const handled = await router(req, res);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  }, 180_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await appPool?.end();
    await db?.stop();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('keeps the profile, the listing application, and the submitted snapshot distinct', async () => {
    const issued = await request(port, 'POST', '/v1/auth/email-code', {
      body: { email, purpose: 'sign_in' },
    });
    expect(issued.status).toBe(200);
    const code = String(issued.body.debug_code ?? '');
    expect(code).toMatch(/^\d{6}$/);

    const verified = await request(port, 'POST', '/v1/auth/email-code/verify', {
      body: { email, code, purpose: 'sign_in' },
    });
    expect(verified.status).toBe(200);
    const partyId = String(verified.body.party_id);
    let cookie = verified.cookie;
    expect(cookie).toBeTruthy();

    const profileBody = {
      given_name: 'Ada',
      family_name: 'Renter',
      phone: '+13125550100',
      email,
      move_in_urgency: 'within_30_days',
      bedrooms_min: 2,
      rent_max_cents: 180000,
      state: 'IL',
      has_pets: false,
      household_size: 1,
    };
    const saved = await request(port, 'POST', '/v1/renter/profile', {
      cookie,
      body: profileBody,
    });
    expect(saved.status).toBe(200);
    expect((saved.body.profile as { given_name: string }).given_name).toBe('Ada');

    const signedOut = await request(port, 'POST', '/v1/auth/logout', { cookie });
    expect(signedOut.status).toBe(200);
    const closed = await request(port, 'GET', '/v1/auth/me', { cookie });
    expect(closed.status).toBe(401);

    const again = await request(port, 'POST', '/v1/auth/email-code', {
      body: { email, purpose: 'sign_in' },
    });
    const secondCode = String(again.body.debug_code ?? '');
    const returned = await request(port, 'POST', '/v1/auth/email-code/verify', {
      body: { email, code: secondCode, purpose: 'sign_in' },
    });
    expect(returned.status).toBe(200);
    expect(returned.body.party_id).toBe(partyId);
    cookie = returned.cookie;

    const loaded = await request(port, 'GET', '/v1/renter/profile', { cookie });
    expect(loaded.status).toBe(200);
    expect((loaded.body.profile as { given_name: string }).given_name).toBe('Ada');
    expect((loaded.body.profile as { email: string }).email).toBe(email);

    const intake = await request(port, 'POST', '/v1/renter/intake', {
      cookie,
      body: {
        current_address_line1: '100 Account Street',
        current_address_city: 'Chicago',
        current_address_state: 'IL',
        current_address_postal: '60601',
        employer_name: 'First Employer',
        job_title: 'Analyst',
        mark_complete: true,
      },
    });
    expect(intake.status).toBe(200);

    const applied = await request(port, 'POST', '/v1/renter/interest', {
      cookie,
      body: { listing_id: listingA },
    });
    expect(applied.status).toBe(201);
    const applicationA = String(applied.body.application_id);
    expect(applied.body.listing_id).toBe(listingA);
    expect(applied.body.status).toBe('awaiting_landlord_interest');

    const list = await request(port, 'GET', '/v1/renter/applications', { cookie });
    expect(list.status).toBe(200);
    const rows = list.body.applications as Array<Record<string, unknown>>;
    const row = rows.find((item) => item.application_id === applicationA);
    expect(row?.status).toBe('awaiting_landlord_interest');
    expect((row?.progress as { status_label: string }).status_label).toBe('Interest sent');
    expect((row?.progress as { next_action_owner: string }).next_action_owner).toBe('home_provider');
    expect((row?.listing as { line1: string }).line1).toBe(lineA);
    expect((row?.listing as { status: string }).status).toBe('active');

    const detail = await request(port, 'GET', `/v1/renter/applications/${applicationA}/details`, {
      cookie,
    });
    expect(detail.status).toBe(200);
    const dossier = detail.body.dossier as {
      mode: string;
      contact: { given_name: { value: string } };
      employment: { employer_name: { value: string } };
    };
    expect(dossier.mode).toBe('frozen_snapshot');
    expect(dossier.contact.given_name.value).toBe('Ada');
    expect(dossier.employment.employer_name.value).toBe('First Employer');
    expect((detail.body.progress as { status_label: string }).status_label).toBe('Interest sent');
    expect((detail.body.listing as { line1: string; status: string }).status).toBe('active');

    const renamed = await request(port, 'POST', '/v1/renter/profile', {
      cookie,
      body: { ...profileBody, given_name: 'Changed' },
    });
    expect(renamed.status).toBe(200);

    const afterRename = await request(
      port,
      'GET',
      `/v1/renter/applications/${applicationA}/details`,
      { cookie },
    );
    const frozen = afterRename.body.dossier as {
      contact: { given_name: { value: string; source: string } };
    };
    expect(frozen.contact.given_name).toEqual({ value: 'Ada', source: 'submitted_snapshot' });

    const appliedB = await request(port, 'POST', '/v1/renter/interest', {
      cookie,
      body: { listing_id: listingB },
    });
    expect(appliedB.status).toBe(201);
    const applicationB = String(appliedB.body.application_id);
    expect(applicationB).not.toBe(applicationA);
    const detailB = await request(port, 'GET', `/v1/renter/applications/${applicationB}/details`, {
      cookie,
    });
    expect(
      (detailB.body.dossier as { contact: { given_name: { value: string } } }).contact.given_name
        .value,
    ).toBe('Changed');
    expect((detailB.body.listing as { line1: string }).line1).not.toBe(lineA);

    await withBypass(db.pool, (client) =>
      client.query(`update application set intake_snapshot = null where id = $1`, [applicationA]),
    );
    const missing = await request(port, 'GET', `/v1/renter/applications/${applicationA}/details`, {
      cookie,
    });
    expect((missing.body.dossier as { mode: string }).mode).toBe('snapshot_absent');
    expect(
      (missing.body.dossier as { contact: { given_name: { source: string } } }).contact.given_name
        .source,
    ).toBe('not_on_file');
    expect(
      (
        missing.body.dossier as {
          current_account: { contact: { given_name: { value: string } } };
        }
      ).current_account.contact.given_name.value,
    ).toBe('Changed');
    expect((missing.body.snapshot_recovery as { classification: string }).classification).toBe(
      'recoverable_from_freeze_event',
    );

    const restored = await withBypass(db.pool, (client) =>
      restoreSnapshotFromFreezeEvent(client, applicationA),
    );
    expect(restored.written).toBe(true);
    const recovered = await request(
      port,
      'GET',
      `/v1/renter/applications/${applicationA}/details`,
      { cookie },
    );
    expect(
      (recovered.body.dossier as { contact: { given_name: { value: string } } }).contact.given_name
        .value,
    ).toBe('Ada');

    await withBypass(db.pool, async (client) => {
      await client.query(
        `delete from domain_event
          where aggregate_id = $1 and event_type = 'application.intake_frozen'`,
        [applicationB],
      );
      await client.query(`update application set intake_snapshot = null where id = $1`, [
        applicationB,
      ]);
    });
    const blocked = await withBypass(db.pool, (client) =>
      restoreSnapshotFromFreezeEvent(client, applicationB),
    );
    expect(blocked.written).toBe(false);
    expect(blocked.classification).toBe('not_recoverable');
    const untouched = await withBypass(db.pool, (client) =>
      client.query<{ intake_snapshot: unknown }>(
        `select intake_snapshot from application where id = $1`,
        [applicationB],
      ),
    );
    expect(untouched.rows[0]?.intake_snapshot).toBeNull();

    const staff = await request(port, 'GET', `/internal/v1/cases/${applicationA}`, {
      token: SERVICE_TOKEN,
    });
    expect(staff.status).toBe(200);
    const display = staff.body.display as Record<string, unknown>;
    expect(display.statusLabel).toBe('Interest sent');
    expect(display.listingStatusLabel).toBe('Available');
    expect(String(display.regionLabel)).toContain(lineA);
    expect(display.displayName).toBe('Ada Renter');
    expect(display.nameSource).toBe('submitted_snapshot');
    expect(staff.body.productStage).toBe('awaiting_landlord_interest');

    const queue = await request(port, 'GET', '/internal/v1/applications', { token: SERVICE_TOKEN });
    expect(queue.status).toBe(200);
    const items = queue.body.items as Array<Record<string, unknown>>;
    const staffRow = items.find((item) => item.sourceId === applicationA);
    expect(staffRow?.statusLabel).toBe('Interest sent');
    expect(String(staffRow?.regionLabel)).toContain(lineA);
    expect(staffRow?.displayName).toBe('Ada Renter');
  }, 120_000);
});
