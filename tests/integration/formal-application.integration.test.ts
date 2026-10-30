/**
 * Interest stays separate from a formal application.
 * Disposable Postgres and the HTTP API. No production database.
 */
import http from 'node:http';
import type { AddressInfo, IncomingHttpHeaders } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiRouter } from '../../src/http/router.js';
import { submitFormalApplication } from '../../src/modules/applications/formal.js';
import { resetApplicationCreationRateLimits } from '../../src/modules/applications/create.js';
import { seedPhase5Listing } from '../helpers/phase5.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import type { DbPool } from '../../src/db/pool.js';

const emailA = `formal-a-${randomUUID().slice(0, 8)}@example.com`;
const emailB = `formal-b-${randomUUID().slice(0, 8)}@example.com`;

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
  path: string,
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

async function signIn(port: number, email: string): Promise<{ cookie: string; partyId: string }> {
  const issued = await request(port, 'POST', '/v1/auth/email-code', {
    body: { email, purpose: 'sign_in' },
  });
  expect(issued.status).toBe(200);
  const verified = await request(port, 'POST', '/v1/auth/email-code/verify', {
    body: { email, code: String(issued.body.debug_code), purpose: 'sign_in' },
  });
  expect(verified.status).toBe(200);
  expect(verified.cookie).toBeTruthy();
  return { cookie: verified.cookie!, partyId: String(verified.body.party_id) };
}

function profileBody(email: string, family: string, expected?: string | null) {
  return {
    given_name: 'Ada',
    family_name: family,
    phone: '+13125550100',
    email,
    annual_income_cents: null,
    move_in_urgency: 'within_30_days',
    bedrooms_min: 2,
    rent_max_cents: 180000,
    state: 'TX',
    has_pets: false,
    household_size: 2,
    expected_updated_at: expected ?? null,
  };
}

const intakeBody = {
  current_address_line1: '500 Current St',
  current_address_city: 'Austin',
  current_address_state: 'TX',
  current_address_postal: '78702',
  employer_name: 'Current Co',
  job_title: 'Analyst',
  mark_complete: true,
};

describe('formal application lifecycle', () => {
  let db: TestDb;
  let appPool: DbPool;
  let server: http.Server;
  let port = 0;
  let listingA = '';
  let listingB = '';
  let listingC = '';
  let lineA = '';
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
    process.env.AUTH_EMAIL_ALLOWLIST = `${emailA},${emailB}`;
    process.env.EMAIL_PROVIDER = 'stub';
    resetApplicationCreationRateLimits();
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);
    const seeded = await withBypass(db.pool, async (client) => {
      const first = await seedPhase5Listing(client, db.kms, { rentCents: 180000 });
      const second = await seedPhase5Listing(client, db.kms, { rentCents: 190000 });
      const third = await seedPhase5Listing(client, db.kms, { rentCents: 200000 });
      await client.query(`update listing set status = 'active' where id = any($1::uuid[])`, [
        [first.listingId, second.listingId, third.listingId],
      ]);
      await client.query(
        `insert into config_version (
           id, namespace, version, payload, effective_from,
           proposed_by_party_id, approved_by_party_id, approved_at
         ) values (
           gen_random_uuid(), 'application_access', 'formal-lifecycle',
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
        listingC: third.listingId,
        lineA: address.rows[0]?.line1 ?? '',
      };
    });
    listingA = seeded.listingA;
    listingB = seeded.listingB;
    listingC = seeded.listingC;
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
    for (const [key, value] of Object.entries(saved)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('keeps profiles, interest, and formal submissions independent', async () => {
    const first = await signIn(port, emailA);
    const savedProfile = await request(port, 'POST', '/v1/renter/profile', {
      cookie: first.cookie,
      body: profileBody(emailA, 'Renter'),
    });
    expect(savedProfile.status).toBe(200);
    const revision = String((savedProfile.body.profile as { updated_at: string }).updated_at);

    await request(port, 'POST', '/v1/auth/logout', { cookie: first.cookie, body: {} });
    const again = await signIn(port, emailA);
    expect(again.partyId).toBe(first.partyId);
    const reloaded = await request(port, 'GET', '/v1/renter/profile', { cookie: again.cookie });
    expect(reloaded.status).toBe(200);
    expect((reloaded.body.profile as { family_name: string }).family_name).toBe('Renter');
    expect((reloaded.body.profile as { annual_income_cents: number | null }).annual_income_cents).toBeNull();

    const otherSession = await signIn(port, emailA);
    const winner = await request(port, 'POST', '/v1/renter/profile', {
      cookie: again.cookie,
      body: profileBody(emailA, 'Winner', revision),
    });
    expect(winner.status).toBe(200);
    const loser = await request(port, 'POST', '/v1/renter/profile', {
      cookie: otherSession.cookie,
      body: profileBody(emailA, 'Loser', revision),
    });
    expect(loser.status).toBe(409);
    expect(loser.body.error).toBe('profile_conflict');
    const afterConflict = await request(port, 'GET', '/v1/renter/profile', { cookie: again.cookie });
    expect((afterConflict.body.profile as { family_name: string }).family_name).toBe('Winner');

    const intake = await request(port, 'POST', '/v1/renter/intake', {
      cookie: again.cookie,
      body: intakeBody,
    });
    expect(intake.status).toBe(200);

    const interest = await request(port, 'POST', '/v1/renter/interest', {
      cookie: again.cookie,
      body: { listing_id: listingA },
    });
    expect(interest.status).toBe(201);
    expect(interest.body.status).toBe('awaiting_landlord_interest');

    const draft = await request(port, 'POST', '/v1/renter/applications', {
      cookie: again.cookie,
      body: { listing_id: listingA },
    });
    expect(draft.status).toBe(201);
    expect(draft.body.status).toBe('draft');
    expect(draft.body.application_id).not.toBe(interest.body.application_id);

    const incomplete = await request(
      port,
      'POST',
      `/v1/renter/applications/${String(draft.body.application_id)}/submit`,
      { cookie: again.cookie, body: {} },
    );
    expect(incomplete.status).toBe(409);
    expect(incomplete.body.error).toBe('formal_incomplete');

    const withIncome = await request(port, 'POST', '/v1/renter/intake', {
      cookie: again.cookie,
      body: { ...intakeBody, monthly_gross_income_cents: 400000 },
    });
    expect(withIncome.status).toBe(200);

    const formalId = String(draft.body.application_id);
    await expect(
      withBypass(db.pool, async (client) => {
        await submitFormalApplication(client, { applicationId: formalId, partyId: again.partyId });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const rolled = await withBypass(db.pool, (client) =>
      client.query<{ status: string; intake_snapshot: unknown }>(
        `select status, intake_snapshot from application where id = $1`,
        [formalId],
      ),
    );
    expect(rolled.rows[0]?.status).toBe('draft');
    expect(rolled.rows[0]?.intake_snapshot).toBeNull();

    const submitted = await request(port, 'POST', `/v1/renter/applications/${formalId}/submit`, {
      cookie: again.cookie,
      body: {},
    });
    expect(submitted.status).toBe(201);
    expect(submitted.body.status).toBe('submitted');
    const replay = await request(port, 'POST', `/v1/renter/applications/${formalId}/submit`, {
      cookie: again.cookie,
      body: {},
    });
    expect(replay.status).toBe(200);
    expect(replay.body.reused).toBe(true);

    const beforeRename = await request(port, 'GET', '/v1/renter/profile', { cookie: again.cookie });
    const renamed = await request(port, 'POST', '/v1/renter/profile', {
      cookie: again.cookie,
      body: profileBody(
        emailA,
        'Edited',
        String((beforeRename.body.profile as { updated_at: string }).updated_at),
      ),
    });
    expect(renamed.status).toBe(200);
    const detail = await request(port, 'GET', `/v1/renter/applications/${formalId}/details`, {
      cookie: again.cookie,
    });
    expect(detail.status).toBe(200);
    const snapshot = detail.body.snapshot as { contact?: { family_name?: string } };
    expect(snapshot.contact?.family_name).toBe('Winner');

    const secondHome = await request(port, 'POST', '/v1/renter/applications', {
      cookie: again.cookie,
      body: { listing_id: listingB },
    });
    expect(secondHome.status).toBe(201);
    const againHome = await request(port, 'POST', '/v1/renter/applications', {
      cookie: again.cookie,
      body: { listing_id: listingB },
    });
    expect(againHome.body.application_id).toBe(secondHome.body.application_id);
    const raced = await Promise.all([
      request(port, 'POST', '/v1/renter/applications', {
        cookie: again.cookie,
        body: { listing_id: listingB },
      }),
      request(port, 'POST', '/v1/renter/applications', {
        cookie: again.cookie,
        body: { listing_id: listingB },
      }),
    ]);
    expect(raced[0]?.body.application_id).toBe(secondHome.body.application_id);
    expect(raced[1]?.body.application_id).toBe(secondHome.body.application_id);

    await withBypass(db.pool, (client) =>
      client.query(`update listing set status = 'paused' where id = $1`, [listingA]),
    );
    const tracked = await request(port, 'GET', '/v1/renter/applications', { cookie: again.cookie });
    expect(tracked.status).toBe(200);
    const rows = tracked.body.applications as Array<{
      application_id: string;
      status: string;
      record_kind: string;
      listing: { line1: string | null; status: string | null } | null;
      progress: { status_label: string };
    }>;
    const interestRow = rows.find((row) => row.application_id === interest.body.application_id);
    const formalRow = rows.find((row) => row.application_id === formalId);
    expect(interestRow?.record_kind).toBe('interest');
    expect(interestRow?.status).toBe('awaiting_landlord_interest');
    expect(interestRow?.progress.status_label).toBe('Interest sent');
    expect(interestRow?.listing?.line1).toBe(lineA);
    expect(interestRow?.listing?.status).toBe('paused');
    expect(formalRow?.record_kind).toBe('formal');
    expect(formalRow?.status).toBe('submitted');
    expect(formalRow?.progress.status_label).toBe('Submitted');
    expect(formalRow?.listing?.line1).toBe(lineA);

    const stranger = await signIn(port, emailB);
    const hidden = await request(port, 'GET', `/v1/renter/applications/${formalId}/details`, {
      cookie: stranger.cookie,
    });
    expect(hidden.status).toBe(404);
    const hiddenList = await request(port, 'GET', '/v1/renter/applications', { cookie: stranger.cookie });
    const hiddenRows = (hiddenList.body.applications as Array<{ application_id: string }>) ?? [];
    expect(hiddenRows.some((row) => row.application_id === formalId)).toBe(false);
    const doc = await request(
      port,
      'GET',
      `/v1/renter/applications/${formalId}/missing-info/documents/${randomUUID()}/url`,
      { cookie: stranger.cookie },
    );
    expect(doc.status).not.toBe(200);

    const legacyParty = again.partyId;
    const legacy = await withBypass(db.pool, async (client) => {
      const profile = await client.query<{ id: string }>(
        `select id from renter_profile where party_id = $1`,
        [legacyParty],
      );
      const home = await client.query<{ unit_id: string; org_id: string }>(
        `select unit_id, org_id from listing where id = $1`,
        [listingC],
      );
      const inserted = await client.query<{ id: string }>(
        `insert into application (
           party_id, renter_profile_id, listing_id, unit_id, org_id,
           entry_point, status, record_kind
         ) values ($1,$2,$3,$4,$5,'renter_initiated','awaiting_landlord_interest','interest')
         returning id`,
        [
          legacyParty,
          profile.rows[0]!.id,
          listingC,
          home.rows[0]!.unit_id,
          home.rows[0]!.org_id,
        ],
      );
      return inserted.rows[0]!.id;
    });
    const legacyDetail = await request(port, 'GET', `/v1/renter/applications/${legacy}/details`, {
      cookie: again.cookie,
    });
    expect(legacyDetail.status).toBe(200);
    expect(legacyDetail.body.snapshot).toBeNull();
    const dossier = legacyDetail.body.dossier as {
      mode?: string;
      contact?: { given_name?: { value?: string | null } };
    };
    expect(dossier.mode).toBe('snapshot_absent');
    expect(dossier.contact?.given_name?.value ?? null).toBeNull();
  });
});
