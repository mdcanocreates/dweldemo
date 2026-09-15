import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiRouter } from '../../src/http/router.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';

function request(
  port: number,
  method: string,
  path: string,
  opts?: { body?: Record<string, unknown>; token?: string; raw?: boolean },
): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = opts?.body ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    if (opts?.token) headers.Authorization = `Bearer ${opts.token}`;
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: Record<string, unknown> = {};
          if (raw && !opts?.raw) {
            try {
              body = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              body = { raw };
            }
          }
          resolve({ status: res.statusCode ?? 0, body, text: raw });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('Part J + L — admin console + intake + rules_based_v1', () => {
  let db: TestDb;
  let server: http.Server;
  let port: number;
  let superToken: string;
  let adminToken: string;
  let renterToken: string;
  let landlordToken: string;
  let listingId: string;
  let renterPartyId: string;
  let landlordOrgId: string;

  beforeAll(async () => {
    db = await startTestDb();
    const router = createApiRouter({ pool: db.pool });
    server = http.createServer(async (req, res) => {
      const handled = await router(req, res);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;

    const seeded = await withBypass(db.pool, async (c) => {
      const { rows: org } = await c.query<{ id: string }>(
        `insert into org (kind, legal_name, display_name)
         values ('landlord','JL Landlord','JL Landlord') returning id`,
      );
      const orgId = org[0]!.id;

      const mk = async (role: string, org: string | null) => {
        const { rows: p } = await c.query<{ id: string }>(
          `insert into party (kind) values ('person') returning id`,
        );
        await c.query(
          `insert into party_role (party_id, org_id, role) values ($1,$2,$3)`,
          [p[0]!.id, org, role],
        );
        const { rows: s } = await c.query<{ id: string }>(
          `insert into session (party_id, expires_at, elevated_until)
           values ($1, now() + interval '1 day', now() + interval '1 hour') returning id`,
          [p[0]!.id],
        );
        return { partyId: p[0]!.id, token: s[0]!.id };
      };

      const superA = await mk('rbit_super_admin', null);
      const admin = await mk('rbit_admin', null);
      const landlord = await mk('landlord', orgId);
      const renter = await mk('renter', null);

      await c.query(
        `insert into renter_profile (
           party_id, given_name, family_name, phone_e164, email,
           annual_income_cents, move_in_urgency, bedrooms_min, rent_max_cents,
           preferred_state, has_pets, household_size
         ) values ($1,'Ada','Renter','+15551112222','ada@example.com',
           9600000,'within_30_days',1,250000,'OH',false,1)`,
        [renter.partyId],
      );

      await c.query(
        `insert into config_version (
           id, namespace, version, payload, effective_from,
           proposed_by_party_id, approved_by_party_id, approved_at
         ) values (
           gen_random_uuid(), 'application_access', 'test-jl-1',
           '{"token_ttl_ms":604800000}'::jsonb, now(), $1, $1, now()
         )`,
        [superA.partyId],
      );

      return {
        orgId,
        superToken: superA.token,
        adminToken: admin.token,
        landlordToken: landlord.token,
        renterToken: renter.token,
        renterPartyId: renter.partyId,
      };
    });

    superToken = seeded.superToken;
    adminToken = seeded.adminToken;
    landlordToken = seeded.landlordToken;
    renterToken = seeded.renterToken;
    renterPartyId = seeded.renterPartyId;
    landlordOrgId = seeded.orgId;

    const created = await request(port, 'POST', '/v1/landlord/listings', {
      token: landlordToken,
      body: {
        address_raw: '9 Admin St, Columbus, OH 43215',
        rent_amount_cents: 200000,
        bedrooms: 2,
        bathrooms: 1,
        status: 'active',
        pets_allowed: false,
        amenities: [],
      },
    });
    expect(created.status).toBe(201);
    listingId = String(created.body.listing_id);
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await db.stop();
  });

  it('J — non-admin gets 403 on admin routes', async () => {
    const res = await request(port, 'GET', '/v1/admin/users', { token: renterToken });
    expect(res.status).toBe(403);
  });

  it('J — rbit_admin can read users; cannot assign roles', async () => {
    const list = await request(port, 'GET', '/v1/admin/users', { token: adminToken });
    expect(list.status).toBe(200);
    const assign = await request(port, 'POST', '/v1/admin/users/roles', {
      token: adminToken,
      body: { party_id: renterPartyId, role: 'rbit_admin' },
    });
    expect(assign.status).toBe(403);
  });

  it('J — rbit_super_admin can toggle flags and read audit', async () => {
    const flags = await request(port, 'GET', '/v1/admin/config/flags', { token: superToken });
    expect(flags.status).toBe(200);
    const set = await request(port, 'PUT', '/v1/admin/config/flags/ny_path2_enabled', {
      token: superToken,
      body: { enabled: false },
    });
    expect(set.status).toBe(200);
    const audit = await request(port, 'GET', '/v1/admin/audit?format=csv', {
      token: superToken,
      raw: true,
    });
    expect(audit.status).toBe(200);
    expect(audit.text).toContain('event_type');
  });

  it('L — intake required before interest; score stored as rules_based_v1', async () => {
    const blocked = await request(port, 'POST', '/v1/renter/interest', {
      token: renterToken,
      body: { listing_id: listingId },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('intake_required');

    const intake = await request(port, 'POST', '/v1/renter/intake', {
      token: renterToken,
      body: {
        current_address_line1: '1 Main',
        current_address_city: 'Columbus',
        current_address_state: 'OH',
        current_address_move_in: '2024-01-01',
        employer_name: 'Acme',
        job_title: 'Engineer',
        employer_phone: '+15550001111',
        employment_length_months: 24,
        monthly_gross_income_cents: 800000,
        occupants: [],
        pets: [],
        emergency_contact: { name: 'Pat', relationship: 'friend', phone: '+15550002222' },
        mark_complete: true,
      },
    });
    expect(intake.status).toBe(200);

    const interest = await request(port, 'POST', '/v1/renter/interest', {
      token: renterToken,
      body: { listing_id: listingId },
    });
    expect([200, 201]).toContain(interest.status);
    expect(interest.body.match_score_version).toBe('rules_based_v1');
    expect(typeof interest.body.match_score_value).toBe('number');

    const apps = await request(port, 'GET', `/v1/landlord/listings/${listingId}/applicants`, {
      token: landlordToken,
    });
    expect(apps.status).toBe(200);
    const applicants = apps.body.applicants as Array<Record<string, unknown>>;
    expect(applicants[0]?.match_score_version).toBe('rules_based_v1');
    expect(applicants[0]?.contact).toBeNull();

    const detail = await request(
      port,
      'GET',
      `/v1/renter/applications/${String(interest.body.application_id)}/details`,
      { token: renterToken },
    );
    expect(detail.status).toBe(200);
    expect(detail.body.snapshot_is_frozen).toBe(true);
    expect((detail.body.snapshot as { intake?: { employer_name?: string } })?.intake?.employer_name).toBe(
      'Acme',
    );

    // Editing live dossier must not rewrite frozen snapshot
    await request(port, 'POST', '/v1/renter/intake', {
      token: renterToken,
      body: { employer_name: 'ChangedCo', mark_complete: true },
    });
    const detail2 = await request(
      port,
      'GET',
      `/v1/renter/applications/${String(interest.body.application_id)}/details`,
      { token: renterToken },
    );
    expect(
      (detail2.body.snapshot as { intake?: { employer_name?: string } })?.intake?.employer_name,
    ).toBe('Acme');
    expect(
      (detail2.body.live_intake as { employer_name?: string } | null)?.employer_name,
    ).toBe('ChangedCo');
    void landlordOrgId;
  });
});
