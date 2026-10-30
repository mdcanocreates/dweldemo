/**
 * Provider verification, broker property assignment, and publication authority.
 * Disposable Postgres. Does not approve a renter or call a screening vendor.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiRouter } from '../../src/http/router.js';
import { withTenantContext } from '../../src/db/tenant.js';
import { ingestManualListing } from '../../src/modules/ingestion/index.js';
import { setListingStatus } from '../../src/modules/listings/index.js';
import { resetApplicationCreationRateLimits } from '../../src/modules/applications/create.js';
import { seedScrapingPolicy } from '../helpers/phase5.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import type { DbPool } from '../../src/db/pool.js';

const providerEmail = `provider-${randomUUID().slice(0, 8)}@example.com`;
const brokerEmail = `broker-${randomUUID().slice(0, 8)}@example.com`;
const renterEmail = `renter-${randomUUID().slice(0, 8)}@example.com`;
const adminEmail = `admin-${randomUUID().slice(0, 8)}@example.com`;
const otherEmail = `other-${randomUUID().slice(0, 8)}@example.com`;

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

describe('provider and broker authority', () => {
  let db: TestDb;
  let appPool: DbPool;
  let server: http.Server;
  let port = 0;
  let providerCookie = '';
  let brokerCookie = '';
  let renterCookie = '';
  let adminCookie = '';
  let otherCookie = '';
  let providerParty = '';
  let brokerParty = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'development';
    process.env.AUTH_RETURN_REDEEM_TOKEN = '1';
    process.env.AUTH_EMAIL_ALLOWLIST = [providerEmail, brokerEmail, renterEmail, adminEmail, otherEmail].join(',');
    process.env.EMAIL_PROVIDER = 'stub';
    resetApplicationCreationRateLimits();
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);
    await withBypass(db.pool, (client) =>
      seedScrapingPolicy(client, { allowGenericAutomation: true, unauthenticatedBurstLimit: 200 }),
    );
    server = http.createServer(async (req, res) => {
      const handled = await createApiRouter({ pool: appPool })(req, res);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    const provider = await signIn(port, providerEmail);
    const broker = await signIn(port, brokerEmail);
    const renter = await signIn(port, renterEmail);
    const admin = await signIn(port, adminEmail);
    const other = await signIn(port, otherEmail);
    providerParty = provider.partyId;
    brokerParty = broker.partyId;
    providerCookie = provider.cookie;
    brokerCookie = broker.cookie;
    renterCookie = renter.cookie;
    otherCookie = other.cookie;
    await withBypass(db.pool, (client) =>
      client.query(
        `insert into party_role (party_id, role, status) values ($1, 'rbit_admin', 'active')`,
        [admin.partyId],
      ),
    );
    adminCookie = (await signIn(port, adminEmail)).cookie;
  }, 240_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await appPool?.end();
    await db?.stop();
  });

  it('verifies a provider, blocks unverified publication, and limits a broker to one property', async () => {
    const intakeBody = {
      full_name: 'Pat Provider',
      email: providerEmail,
      phone: '+15125550100',
      organization_name: 'Pat Homes',
      market: 'Austin',
      portfolio_size: '4',
      property_types: 'residential',
    };
    const submitted = await request(port, 'POST', '/v1/partner-intakes/landlord', {
      cookie: providerCookie,
      body: intakeBody,
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const intake = submitted.body.intake as { id: string; status: string };
    expect(intake.status).toBe('new');
    const closed = await request(port, 'GET', '/v1/landlord/listings', { cookie: providerCookie });
    expect(closed.status).toBe(403);

    const asked = await request(port, 'POST', `/v1/admin/partner-intakes/${intake.id}/decision`, {
      cookie: adminCookie,
      body: { decision: 'under_review', note: 'Send the management agreement' },
    });
    expect(asked.status).toBe(200);
    expect((asked.body.intake as { reviewer_note: string }).reviewer_note).toContain('management agreement');
    const answered = await request(port, 'POST', '/v1/partner-intakes/landlord/response', {
      cookie: providerCookie,
      body: { response: 'I manage the property. I am not attaching a fabricated license.' },
    });
    expect(answered.status).toBe(200);
    expect((answered.body.intake as { status: string }).status).toBe('under_review');

    const approved = await request(port, 'POST', `/v1/admin/partner-intakes/${intake.id}/decision`, {
      cookie: adminCookie,
      body: { decision: 'approved' },
    });
    expect(approved.status).toBe(200);
    const orgId = String((approved.body.intake as { org_id: string }).org_id);
    const again = await request(port, 'POST', `/v1/admin/partner-intakes/${intake.id}/decision`, {
      cookie: adminCookie,
      body: { decision: 'approved' },
    });
    expect(String((again.body.intake as { org_id: string }).org_id)).toBe(orgId);
    const roles = await withBypass(db.pool, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from party_role
         where party_id = $1 and role = 'landlord' and revoked_at is null`,
        [providerParty],
      ),
    );
    expect(roles.rows[0]?.n).toBe('1');
    providerCookie = (await signIn(port, providerEmail)).cookie;

    const draft = await request(port, 'POST', '/v1/landlord/listings', {
      cookie: providerCookie,
      body: {
        address_raw: '410 Authority Lane',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701',
        available_on: '2026-12-01',
        rent_amount_cents: 175000,
        bedrooms: 2,
        bathrooms: 1,
        status: 'draft',
        idempotency_key: 'authority-listing-1',
      },
    });
    expect(draft.status).toBe(201);
    const listingId = String(draft.body.listing_id);
    const [first, second] = await Promise.all([
      request(port, 'POST', '/v1/landlord/listings', {
        cookie: providerCookie,
        body: {
          address_raw: '410 Authority Lane',
          city: 'Austin',
          state: 'TX',
          postal_code: '78701',
          available_on: '2026-12-01',
          rent_amount_cents: 175000,
          bedrooms: 2,
          status: 'draft',
          idempotency_key: 'authority-listing-1',
        },
      }),
      request(port, 'POST', '/v1/landlord/listings', {
        cookie: providerCookie,
        body: {
          address_raw: '410 Authority Lane',
          city: 'Austin',
          state: 'TX',
          postal_code: '78701',
          available_on: '2026-12-01',
          rent_amount_cents: 175000,
          bedrooms: 2,
          status: 'draft',
          idempotency_key: 'authority-listing-1',
        },
      }),
    ]);
    expect(first.body.listing_id).toBe(listingId);
    expect(second.body.listing_id).toBe(listingId);

    const unpublished = await request(port, 'POST', `/v1/landlord/listings/${listingId}/status`, {
      cookie: providerCookie,
      body: { status: 'active' },
    });
    expect(unpublished.status).toBe(409);
    expect(String(unpublished.body.message ?? unpublished.body.error)).toContain('property_authority');
    const stillDraft = await withBypass(db.pool, (client) =>
      client.query<{ status: string }>(`select status from listing where id = $1`, [listingId]),
    );
    expect(stillDraft.rows[0]?.status).toBe('draft');

    await expect(
      withTenantContext(appPool, { orgId, partyId: providerParty }, (client) =>
        setListingStatus(client, {
          listingId,
          orgId,
          status: 'active',
          actorPartyId: providerParty,
        }),
      ),
    ).rejects.toThrow(/property_authority/);

    const ingested = await withBypass(db.pool, async (client) => {
      await ingestManualListing(client, {
        orgId,
        externalId: 'bypass-attempt-1',
        addressRaw: '9 Bypass Lane',
        rentAmountCents: 150000,
        bedrooms: 2,
      });
      const { rows } = await client.query<{ status: string }>(
        `select l.status
         from listing l
         join source_listing sl on sl.id = l.primary_source_listing_id
         where sl.external_id = 'bypass-attempt-1'`,
      );
      return rows[0]?.status;
    });
    expect(ingested).toBe('draft');

    const claim = await request(port, 'POST', '/v1/landlord/property-authority', {
      cookie: providerCookie,
      body: {
        listing_id: listingId,
        authority_kind: 'manager',
        statement: 'I manage 410 Authority Lane for the owner.',
      },
    });
    expect(claim.status).toBe(201);
    const authorityId = String((claim.body.authority as { id: string; status: string }).id);
    expect((claim.body.authority as { status: string }).status).toBe('pending');
    const stillBlocked = await request(port, 'POST', `/v1/landlord/listings/${listingId}/status`, {
      cookie: providerCookie,
      body: { status: 'active' },
    });
    expect(stillBlocked.status).toBe(409);
    const verified = await request(port, 'POST', `/v1/admin/property-authorities/${authorityId}/decision`, {
      cookie: adminCookie,
      body: { decision: 'verified', note: 'Statement recorded. No license number was invented.' },
    });
    expect(verified.status).toBe(200);
    const published = await request(port, 'POST', `/v1/landlord/listings/${listingId}/status`, {
      cookie: providerCookie,
      body: { status: 'active' },
    });
    expect(published.status).toBe(200);
    expect(published.body.status).toBe('active');

    const otherDenied = await request(port, 'PUT', `/v1/landlord/listings/${listingId}`, {
      cookie: otherCookie,
      body: { rent_amount_cents: 1 },
    });
    expect(otherDenied.status).toBe(403);

    const brokerIntake = await request(port, 'POST', '/v1/partner-intakes/broker', {
      cookie: brokerCookie,
      body: {
        full_name: 'Bea Broker',
        email: brokerEmail,
        phone: '+15125550101',
        organization_name: 'Bea Brokerage',
        market: 'Austin',
        portfolio_size: '2',
      },
    });
    expect(brokerIntake.status).toBe(201);
    const brokerIntakeId = String((brokerIntake.body.intake as { id: string }).id);
    const brokerApproved = await request(port, 'POST', `/v1/admin/partner-intakes/${brokerIntakeId}/decision`, {
      cookie: adminCookie,
      body: { decision: 'approved' },
    });
    const brokerOrgId = String((brokerApproved.body.intake as { org_id: string }).org_id);
    brokerCookie = (await signIn(port, brokerEmail)).cookie;
    const assignment = await request(port, 'POST', '/v1/landlord/broker-assignments', {
      cookie: providerCookie,
      body: { listing_id: listingId, broker_org_id: brokerOrgId },
    });
    expect(assignment.status).toBe(201);
    const assignmentId = String((assignment.body.assignment as { id: string }).id);
    const forged = await request(port, 'POST', '/v1/landlord/broker-assignments', {
      cookie: providerCookie,
      body: { listing_id: listingId, broker_org_id: randomUUID() },
    });
    expect(forged.status).toBe(403);

    const managed = await request(port, 'PUT', `/v1/broker/listings/${listingId}`, {
      cookie: brokerCookie,
      body: { rent_amount_cents: 176000 },
    });
    expect(managed.status).toBe(200);
    const hidden = await request(port, 'GET', `/v1/broker/listings/${randomUUID()}/applicants`, {
      cookie: brokerCookie,
    });
    expect(hidden.status).toBe(404);

    const profile = await request(port, 'POST', '/v1/renter/profile', {
      cookie: renterCookie,
      body: {
        given_name: 'Rae',
        family_name: 'Renter',
        phone: '+15125550111',
        email: renterEmail,
        annual_income_cents: null,
        move_in_urgency: 'within_30_days',
        bedrooms_min: 2,
        rent_max_cents: 200000,
        state: 'TX',
        has_pets: false,
        household_size: 1,
      },
    });
    expect(profile.status).toBe(200);
    const intakeOk = await request(port, 'POST', '/v1/renter/intake', {
      cookie: renterCookie,
      body: {
        current_address_line1: '1 Current St',
        current_address_city: 'Austin',
        current_address_state: 'TX',
        current_address_postal: '78702',
        employer_name: 'Current Co',
        job_title: 'Analyst',
        monthly_gross_income_cents: 400000,
        mark_complete: true,
      },
    });
    expect(intakeOk.status).toBe(200);
    const formal = await request(port, 'POST', '/v1/renter/applications', {
      cookie: renterCookie,
      body: { listing_id: listingId },
    });
    const formalId = String(formal.body.application_id);
    const submittedApp = await request(port, 'POST', `/v1/renter/applications/${formalId}/submit`, {
      cookie: renterCookie,
      body: {},
    });
    expect(submittedApp.status).toBe(201);
    const providerView = await request(port, 'GET', `/v1/landlord/applicants/${formalId}`, {
      cookie: providerCookie,
    });
    expect(providerView.status).toBe(200);
    expect(providerView.body.status).toBe('submitted');
    const adminView = await request(port, 'GET', `/v1/admin/applications/${formalId}`, { cookie: adminCookie });
    expect((adminView.body.application as { status: string }).status).toBe(providerView.body.status);
    const brokerView = await request(port, 'GET', `/v1/broker/listings/${listingId}/applicants`, {
      cookie: brokerCookie,
    });
    expect(brokerView.status).toBe(200);
    expect((brokerView.body.applicants as Array<{ application_id: string }>).map((row) => row.application_id)).toContain(
      formalId,
    );

    const revoked = await request(port, 'POST', `/v1/landlord/broker-assignments/${assignmentId}/revoke`, {
      cookie: providerCookie,
      body: {},
    });
    expect(revoked.status).toBe(200);
    await withBypass(db.pool, (client) =>
      client.query(
        `update party_role set revoked_at = now()
         where party_id = $1 and role = 'broker' and revoked_at is null`,
        [brokerParty],
      ),
    );
    brokerCookie = (await signIn(port, brokerEmail)).cookie;
    const lost = await request(port, 'GET', '/v1/broker/assignments', { cookie: brokerCookie });
    expect(lost.status).toBe(403);

    const paused = await request(port, 'POST', `/v1/landlord/listings/${listingId}/status`, {
      cookie: providerCookie,
      body: { status: 'paused' },
    });
    expect(paused.status).toBe(200);
    const tracked = await request(port, 'GET', '/v1/renter/applications', { cookie: renterCookie });
    const kept = (tracked.body.applications as Array<{ application_id: string; listing: { line1: string } | null }>).find(
      (row) => row.application_id === formalId,
    );
    expect(String(kept?.listing?.line1 ?? '')).toContain('410');
    const catalog = await request(port, 'GET', '/v1/listings?q=Authority');
    expect((catalog.body.listings as unknown[]).length).toBe(0);
  }, 120_000);
});
