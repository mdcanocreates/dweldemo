/**
 * Property, listing, and provider application journey on disposable Postgres.
 * Does not connect to Aurora and does not delete application rows.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { createApiRouter } from '../../src/http/router.js';
import { migrate } from '../../src/db/migrate.js';
import { resetApplicationCreationRateLimits } from '../../src/modules/applications/create.js';
import { seedScrapingPolicy } from '../helpers/phase5.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import type { DbPool } from '../../src/db/pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const landlordEmail = `owner-${randomUUID().slice(0, 8)}@example.com`;
const otherEmail = `other-${randomUUID().slice(0, 8)}@example.com`;
const renterEmail = `renter-${randomUUID().slice(0, 8)}@example.com`;

type ApiResult = { status: number; body: Record<string, unknown>; cookie: string | null };

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
  pathName: string,
  opts?: { body?: Record<string, unknown>; cookie?: string | null },
): Promise<ApiResult> {
  return new Promise((resolve, reject) => {
    const payload = opts?.body ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    if (opts?.cookie) headers.Cookie = `rbit_session=${encodeURIComponent(opts.cookie)}`;
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path: pathName, headers },
      (res) => {
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
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function signIn(port: number, email: string): Promise<{ cookie: string; partyId: string }> {
  const issued = await request(port, 'POST', '/v1/auth/email-code', {
    body: { email, purpose: 'sign_in' },
  });
  expect(issued.status).toBe(200);
  const verified = await request(port, 'POST', '/v1/auth/email-code/verify', {
    body: { email, code: String(issued.body.debug_code), purpose: 'sign_in' },
  });
  expect(verified.status).toBe(200);
  return { cookie: verified.cookie!, partyId: String(verified.body.party_id) };
}

async function grantLandlord(db: TestDb, partyId: string, name: string): Promise<void> {
  await withBypass(db.pool, async (client) => {
    const org = await client.query<{ id: string }>(
      `insert into org (kind, legal_name, display_name, status, claim_status)
       values ('landlord', $1, $1, 'active', 'claimed') returning id`,
      [name],
    );
    await client.query(
      `insert into party_role (party_id, org_id, role, status)
       values ($1, $2, 'landlord', 'active')`,
      [partyId, org.rows[0]!.id],
    );
  });
}

describe('migration 0073 compatibility dry run', () => {
  it('refuses the unique index while duplicate open applications remain', async () => {
    const container = await new PostgreSqlContainer('postgis/postgis:16-3.4')
      .withDatabase('rbit_test')
      .withUsername('rbit')
      .withPassword('rbit')
      .start();
    const connectionString = container.getConnectionUri();
    const client = new pg.Client({ connectionString });
    try {
      await migrate(connectionString, { stopBefore: '0073_formal_application_kind.sql' });
      await client.connect();
      const party = await client.query<{ id: string }>(
        `insert into party (kind) values ('person') returning id`,
      );
      const profile = await client.query<{ id: string }>(
        `insert into renter_profile (party_id) values ($1) returning id`,
        [party.rows[0]!.id],
      );
      const org = await client.query<{ id: string }>(
        `insert into org (kind, legal_name, display_name) values ('landlord', 'Dry', 'Dry') returning id`,
      );
      const address = await client.query<{ id: string }>(
        `insert into address (raw_input, line1, normalized_hash, normalizer_vendor, normalizer_version)
         values ('1 Dry', '1 Dry', $1, 'test', '1') returning id`,
        [`dry-${randomUUID()}`],
      );
      const property = await client.query<{ id: string }>(
        `insert into property (address_id, property_type) values ($1, 'residential') returning id`,
        [address.rows[0]!.id],
      );
      const unit = await client.query<{ id: string }>(
        `insert into unit (property_id, unit_label_normalized) values ($1, '') returning id`,
        [property.rows[0]!.id],
      );
      const listing = await client.query<{ id: string }>(
        `insert into listing (org_id, unit_id, origin, rent_amount_cents, status)
         values ($1, $2, 'manual', 100000, 'active') returning id`,
        [org.rows[0]!.id, unit.rows[0]!.id],
      );
      await client.query(
        `insert into application (party_id, renter_profile_id, listing_id, org_id, entry_point, status)
         values ($1, $2, $3, $4, 'renter_initiated', 'submitted'),
         ($1, $2, $3, $4, 'renter_initiated', 'awaiting_landlord_interest')`,
        [party.rows[0]!.id, profile.rows[0]!.id, listing.rows[0]!.id, org.rows[0]!.id],
      );
      const before = await client.query<{ n: string }>(
        `select count(*)::text as n
         from (
           select party_id, listing_id
           from application
           where listing_id is not null
             and closed_at is null
             and status not in ('declined', 'withdrawn', 'closed')
           group by party_id, listing_id
           having count(*) > 1
         ) d`,
      );
      expect(before.rows[0]?.n).toBe('1');
      const sql = await readFile(path.join(here, '../../migrations/0073_formal_application_kind.sql'), 'utf8');
      await expect(client.query(sql)).rejects.toThrow(/duplicate key|could not create unique index/i);
      const after = await client.query<{ n: string }>(
        `select count(*)::text as n from application where listing_id = $1`,
        [listing.rows[0]!.id],
      );
      expect(after.rows[0]?.n).toBe('2');
      const applied = await client.query<{ id: string }>(
        `select id from schema_migrations where id like '0073%'`,
      );
      expect(applied.rows).toEqual([]);
    } finally {
      await client.end().catch(() => undefined);
      await container.stop();
    }
  }, 180_000);
});

describe('property listing and provider application journey', () => {
  let db: TestDb;
  let appPool: DbPool;
  let server: http.Server;
  let port = 0;
  let ownerCookie = '';
  let otherCookie = '';
  let renterCookie = '';
  let renterParty = '';
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    APP_ENV: process.env.APP_ENV,
    AUTH_RETURN_REDEEM_TOKEN: process.env.AUTH_RETURN_REDEEM_TOKEN,
    AUTH_EMAIL_ALLOWLIST: process.env.AUTH_EMAIL_ALLOWLIST,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'development';
    process.env.AUTH_RETURN_REDEEM_TOKEN = '1';
    process.env.AUTH_EMAIL_ALLOWLIST = `${landlordEmail},${otherEmail},${renterEmail}`;
    process.env.EMAIL_PROVIDER = 'stub';
    resetApplicationCreationRateLimits();
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);
    await withBypass(db.pool, async (client) => {
      const seeded = await seedScrapingPolicy(client, {
        allowGenericAutomation: true,
        unauthenticatedBurstLimit: 100,
      });
      await client.query(
        `insert into config_version (
           id, namespace, version, payload, effective_from,
           proposed_by_party_id, approved_by_party_id, approved_at
         ) values (
           gen_random_uuid(), 'application_access', 'listing-journey',
           '{"token_ttl_ms":604800000}'::jsonb, now(), $1, $1, now()
         )`,
        [seeded.proposerId],
      );
    });
    server = http.createServer(async (req, res) => {
      const handled = await createApiRouter({ pool: appPool })(req, res);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    const owner = await signIn(port, landlordEmail);
    const other = await signIn(port, otherEmail);
    const renter = await signIn(port, renterEmail);
    await grantLandlord(db, owner.partyId, 'Harbor Homes');
    await grantLandlord(db, other.partyId, 'Other Homes');
    ownerCookie = (await signIn(port, landlordEmail)).cookie;
    otherCookie = (await signIn(port, otherEmail)).cookie;
    renterCookie = renter.cookie;
    renterParty = renter.partyId;
  }, 240_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await appPool?.end();
    await db?.stop();
    for (const [key, value] of Object.entries(saved)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('publishes one inventory record and keeps applications after it leaves the catalog', async () => {
    const hidden = await request(port, 'POST', '/v1/landlord/listings', {
      cookie: ownerCookie,
      body: {
        address_raw: '500 Hidden Ave',
        rent_amount_cents: 120000,
        bedrooms: 1,
        bathrooms: 1,
        status: 'draft',
      },
    });
    expect(hidden.status).toBe(201);
    expect(hidden.body.status).toBe('draft');

    const blocked = await request(port, 'POST', '/v1/landlord/listings', {
      cookie: ownerCookie,
      body: {
        address_raw: '9 Incomplete St',
        rent_amount_cents: 90000,
        bedrooms: 1,
        status: 'active',
      },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('listing_not_publishable');
    const rolledBack = await withBypass(db.pool, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from address where raw_input = '9 Incomplete St'`,
      ),
    );
    expect(rolledBack.rows[0]?.n).toBe('0');

    const created = await request(port, 'POST', '/v1/landlord/listings', {
      cookie: ownerCookie,
      body: {
        address_raw: '410 Renter Lane',
        city: 'Austin',
        state: 'tx',
        postal_code: '78701',
        available_on: '2026-12-01',
        rent_amount_cents: 180000,
        bedrooms: 2,
        bathrooms: 1,
        status: 'draft',
        idempotency_key: 'listing-journey-1',
        media_urls: ['https://cdn.example/one.jpg', 'https://cdn.example/two.jpg', 'http://cdn.example/nope.jpg'],
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    const listingId = String(created.body.listing_id);
    await withBypass(db.pool, (client) =>
      client.query(
        `insert into property_authority (
           org_id, property_id, submitted_by_party_id, authority_kind, statement, status, reviewed_at
         )
         select l.org_id, u.property_id, pr.party_id, 'owner',
                'Existing inventory fixture. Not a fabricated license.', 'verified', now()
         from listing l
         join unit u on u.id = l.unit_id
         join party_role pr on pr.org_id = l.org_id and pr.role = 'landlord' and pr.revoked_at is null
         where l.id = $1
         limit 1`,
        [listingId],
      ),
    );
    const published = await request(port, 'POST', `/v1/landlord/listings/${listingId}/status`, {
      cookie: ownerCookie,
      body: { status: 'active' },
    });
    expect(published.status).toBe(200);
    expect(published.body.status).toBe('active');
    const replay = await request(port, 'POST', '/v1/landlord/listings', {
      cookie: ownerCookie,
      body: {
        address_raw: '410 Renter Lane',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701',
        available_on: '2026-12-01',
        rent_amount_cents: 180000,
        bedrooms: 2,
        status: 'active',
        idempotency_key: 'listing-journey-1',
      },
    });
    expect(replay.body.listing_id).toBe(listingId);

    const denied = await request(port, 'PUT', `/v1/landlord/listings/${listingId}`, {
      cookie: otherCookie,
      body: { rent_amount_cents: 1 },
    });
    expect(denied.status).toBe(404);

    const catalog = await request(port, 'GET', '/v1/listings?q=Austin&min_beds=2&sort=rent_asc');
    expect(catalog.status).toBe(200);
    const rows = catalog.body.listings as Array<{ id: string; media?: Array<{ url: string }> }>;
    expect(rows.map((row) => row.id)).toContain(listingId);
    expect(rows.map((row) => row.id)).not.toContain(String(hidden.body.listing_id));
    const shown = rows.find((row) => row.id === listingId);
    expect(shown?.media?.map((item) => item.url)).toEqual([
      'https://cdn.example/one.jpg',
      'https://cdn.example/two.jpg',
    ]);
    expect(catalog.body.pagination).toMatchObject({ total: rows.length });

    const empty = await request(port, 'GET', '/v1/listings?q=NoSuchCity');
    expect((empty.body.listings as unknown[]).length).toBe(0);
    expect((empty.body.pagination as { total: number }).total).toBe(0);

    const profile = await request(port, 'POST', '/v1/renter/profile', {
      cookie: renterCookie,
      body: {
        given_name: 'Ada',
        family_name: 'Lane',
        phone: '+15125550111',
        email: renterEmail,
        annual_income_cents: null,
        move_in_urgency: 'within_30_days',
        bedrooms_min: 2,
        rent_max_cents: 200000,
        state: 'TX',
        has_pets: false,
        household_size: 2,
      },
    });
    expect(profile.status).toBe(200);
    const intake = await request(port, 'POST', '/v1/renter/intake', {
      cookie: renterCookie,
      body: {
        current_address_line1: '500 Current St',
        current_address_city: 'Austin',
        current_address_state: 'TX',
        current_address_postal: '78702',
        employer_name: 'Current Co',
        job_title: 'Analyst',
        monthly_gross_income_cents: 400000,
        mark_complete: true,
      },
    });
    expect(intake.status).toBe(200);

    const interest = await request(port, 'POST', '/v1/renter/interest', {
      cookie: renterCookie,
      body: { listing_id: listingId },
    });
    expect(interest.status).toBe(201);
    const formal = await request(port, 'POST', '/v1/renter/applications', {
      cookie: renterCookie,
      body: { listing_id: listingId },
    });
    expect(formal.status).toBe(201);
    const formalId = String(formal.body.application_id);
    expect(formalId).not.toBe(String(interest.body.application_id));
    const submitted = await request(port, 'POST', `/v1/renter/applications/${formalId}/submit`, {
      cookie: renterCookie,
      body: {},
    });
    expect(submitted.status).toBe(201);

    const queue = await request(port, 'GET', `/v1/landlord/listings/${listingId}/applicants`, {
      cookie: ownerCookie,
    });
    expect(queue.status).toBe(200);
    const applicants = queue.body.applicants as Array<{ application_id: string; record_kind: string }>;
    expect(applicants.map((row) => row.record_kind).sort()).toEqual(['formal', 'interest']);
    const otherQueue = await request(port, 'GET', `/v1/landlord/listings/${listingId}/applicants`, {
      cookie: otherCookie,
    });
    expect(otherQueue.status).toBe(404);
    const detail = await request(port, 'GET', `/v1/landlord/applicants/${formalId}`, { cookie: ownerCookie });
    expect(detail.status).toBe(200);
    const snapshot = detail.body.submitted_snapshot as { intake?: { employer_name?: string }; listing?: { line1?: string } };
    expect(snapshot.intake?.employer_name).toBe('Current Co');
    expect(String(snapshot.listing?.line1 ?? '')).toContain('410');
    const otherDetail = await request(port, 'GET', `/v1/landlord/applicants/${formalId}`, {
      cookie: otherCookie,
    });
    expect(otherDetail.status).toBe(404);

    const review = await request(
      port,
      'POST',
      `/v1/landlord/listings/${listingId}/applicants/${formalId}/decision`,
      {
        cookie: ownerCookie,
        body: { decision: 'request_more_info', missing_info_categories: ['income'], note: 'Need a pay stub' },
      },
    );
    expect(review.status).toBe(200);
    expect(review.body.status).toBe('info_requested');
    const tracked = await request(port, 'GET', '/v1/renter/applications', { cookie: renterCookie });
    const trackedFormal = (tracked.body.applications as Array<{ application_id: string; status: string; listing: { line1: string } | null }>).find(
      (row) => row.application_id === formalId,
    );
    expect(trackedFormal?.status).toBe('info_requested');
    const submittedLine = trackedFormal?.listing?.line1 ?? '';

    await withBypass(db.pool, (client) =>
      client.query(`update address set line1 = '999 Changed St' where line1 ilike '%410%'`),
    );
    const paused = await request(port, 'POST', `/v1/landlord/listings/${listingId}/status`, {
      cookie: ownerCookie,
      body: { status: 'paused' },
    });
    expect(paused.status).toBe(200);
    const again = await request(port, 'POST', `/v1/landlord/listings/${listingId}/status`, {
      cookie: ownerCookie,
      body: { status: 'paused' },
    });
    expect(again.status).toBe(200);
    const events = await withBypass(db.pool, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from domain_event
         where aggregate_id = $1 and event_type = 'listing.status_changed' and payload->>'to' = 'paused'`,
        [listingId],
      ),
    );
    expect(events.rows[0]?.n).toBe('1');

    const afterPause = await request(port, 'GET', `/v1/listings/${listingId}`);
    expect(afterPause.status).toBe(404);
    const stillThere = await request(port, 'GET', '/v1/renter/applications', { cookie: renterCookie });
    const kept = (stillThere.body.applications as Array<{ application_id: string; listing: { line1: string; status: string } | null }>).find(
      (row) => row.application_id === formalId,
    );
    expect(kept?.listing?.line1).toBe(submittedLine);
    expect(kept?.listing?.line1).not.toContain('999 Changed');
    expect(kept?.listing?.status).toBe('paused');

    const legacyId = randomUUID();
    await withBypass(db.pool, async (client) => {
      const profileRow = await client.query<{ id: string }>(
        `select id from renter_profile where party_id = $1`,
        [renterParty],
      );
      const hiddenListing = String(hidden.body.listing_id);
      const unit = await client.query<{ unit_id: string; org_id: string }>(
        `select unit_id, org_id from listing where id = $1`,
        [hiddenListing],
      );
      await client.query(
        `insert into application (
           id, party_id, renter_profile_id, listing_id, unit_id, org_id, entry_point, status, record_kind
         ) values ($1, $2, $3, $4, $5, $6, 'renter_initiated', 'submitted', 'formal')`,
        [legacyId, renterParty, profileRow.rows[0]!.id, hiddenListing, unit.rows[0]!.unit_id, unit.rows[0]!.org_id],
      );
    });
    const legacy = await request(port, 'GET', `/v1/renter/applications/${legacyId}/details`, {
      cookie: renterCookie,
    });
    expect(legacy.status).toBe(200);
    expect(legacy.body.status).toBe('submitted');
  }, 120_000);
});
