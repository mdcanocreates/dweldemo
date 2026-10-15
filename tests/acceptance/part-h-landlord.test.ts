import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiRouter } from '../../src/http/router.js';
import { resetObjectStore } from '../../src/infra/object-store/index.js';
import { startTestDb, withBypass, type TestDb } from '../helpers/db.js';

function request(
  port: number,
  method: string,
  path: string,
  opts?: { body?: Record<string, unknown>; token?: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
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
          resolve({
            status: res.statusCode ?? 0,
            body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('Part H — landlord portal APIs', () => {
  let db: TestDb;
  let server: http.Server;
  let port: number;
  let landlordToken: string;
  let renterToken: string;
  let listingId: string;
  let applicationId: string;
  let landlordOrgId: string;

  beforeAll(async () => {
    resetObjectStore();
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
         values ('landlord','H Landlord','H Landlord') returning id`,
      );
      const orgId = org[0]!.id;
      const { rows: llParty } = await c.query<{ id: string }>(
        `insert into party (kind) values ('person') returning id`,
      );
      await c.query(
        `insert into party_role (party_id, org_id, role) values ($1,$2,'landlord')`,
        [llParty[0]!.id, orgId],
      );
      const { rows: llSession } = await c.query<{ id: string }>(
        `insert into session (party_id, expires_at, elevated_until)
         values ($1, now() + interval '1 day', now() + interval '1 hour')
         returning id`,
        [llParty[0]!.id],
      );

      const { rows: rParty } = await c.query<{ id: string }>(
        `insert into party (kind) values ('person') returning id`,
      );
      const { rows: rp } = await c.query<{ id: string }>(
        `insert into renter_profile (
           party_id, given_name, family_name, email, phone_e164,
           annual_income_cents, household_size, has_pets, move_in_urgency
         ) values ($1,'Secret','Applicant','secret@example.com','+15551234567',
                   9000000, 2, true, 'within_30_days')
         returning id`,
        [rParty[0]!.id],
      );
      const { rows: rSession } = await c.query<{ id: string }>(
        `insert into session (party_id, expires_at, elevated_until)
         values ($1, now() + interval '1 day', now() + interval '1 hour')
         returning id`,
        [rParty[0]!.id],
      );

      return {
        orgId,
        landlordToken: llSession[0]!.id,
        renterToken: rSession[0]!.id,
        renterPartyId: rParty[0]!.id,
        renterProfileId: rp[0]!.id,
      };
    });

    landlordToken = seeded.landlordToken;
    renterToken = seeded.renterToken;
    landlordOrgId = seeded.orgId;

    const created = await request(port, 'POST', '/v1/landlord/listings', {
      token: landlordToken,
      body: {
        address_raw: '1200 Congress Ave, Austin, TX 78701',
        rent_amount_cents: 220000,
        bedrooms: 2,
        bathrooms: 1,
        status: 'draft',
        pets_allowed: true,
        amenities: ['laundry'],
      },
    });
    expect(created.status).toBe(201);
    listingId = String(created.body.listing_id);

    await withBypass(db.pool, async (c) => {
      const { rows: app } = await c.query<{ id: string }>(
        `insert into application (
           party_id, renter_profile_id, listing_id, org_id, unit_id,
           entry_point, status
         )
         select $1, $2, l.id, l.org_id, l.unit_id, 'renter_initiated', 'screening_complete'
         from listing l where l.id = $3
         returning id`,
        [seeded.renterPartyId, seeded.renterProfileId, listingId],
      );
      applicationId = app[0]!.id;

      // Approve requires at least one completed/failed screening_report (P0).
      const { rows: pkg } = await c.query<{ id: string }>(
        `select id from screening_package where is_active = true limit 1`,
      );
      if (!pkg[0]) {
        throw new Error('no screening_package seeded for part-h fixture');
      }
      const { rows: order } = await c.query<{ id: string }>(
        `insert into screening_order (
           party_id, application_id, package_id, payer_kind, amount_charged_cents, status
         ) values ($1,$2,$3,'applicant',0,'complete') returning id`,
        [seeded.renterPartyId, applicationId, pkg[0].id],
      );
      await c.query(
        `insert into screening_report (
           screening_order_id, party_id, vendor, vendor_report_id, report_kind, status
         ) values ($1,$2,'certn',$3,'identity','complete')`,
        [order[0]!.id, seeded.renterPartyId, `part-h-ident-${applicationId}`],
      );
    });
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db?.stop();
  });

  it('H-0 settings default auto_screen and persist toggle', async () => {
    const get = await request(port, 'GET', '/v1/landlord/settings', { token: landlordToken });
    expect(get.status).toBe(200);
    expect(get.body.screening_mode).toBe('auto_screen');

    const put = await request(port, 'PUT', '/v1/landlord/settings', {
      token: landlordToken,
      body: { screening_mode: 'manual_review' },
    });
    expect(put.status).toBe(200);
    expect(put.body.screening_mode).toBe('manual_review');

    const again = await request(port, 'GET', '/v1/landlord/settings', { token: landlordToken });
    expect(again.body.screening_mode).toBe('manual_review');
  });

  it('H-0 non-landlord gets 403', async () => {
    const res = await request(port, 'GET', '/v1/landlord/settings', { token: renterToken });
    expect(res.status).toBe(403);
  });

  it('H-1 create listing is org-scoped and rent is cents', async () => {
    const list = await request(port, 'GET', '/v1/landlord/listings', { token: landlordToken });
    expect(list.status).toBe(200);
    const listings = list.body.listings as Array<Record<string, unknown>>;
    expect(listings.some((l) => l.id === listingId)).toBe(true);
    const row = listings.find((l) => l.id === listingId)!;
    expect(row.rent_amount_cents).toBe(220000);
    expect(row.status).toBe('draft');
  });

  it('H-1 draft not on public listings; active is', async () => {
    const before = await request(port, 'GET', '/v1/listings');
    const beforeIds = ((before.body.listings as Array<{ id: string }>) ?? []).map((l) => l.id);
    expect(beforeIds).not.toContain(listingId);

    const pub = await request(port, 'POST', `/v1/landlord/listings/${listingId}/status`, {
      token: landlordToken,
      body: { status: 'active' },
    });
    expect(pub.status).toBe(200);

    const after = await request(port, 'GET', '/v1/listings');
    const afterIds = ((after.body.listings as Array<{ id: string }>) ?? []).map((l) => l.id);
    expect(afterIds).toContain(listingId);
  });

  it('H-1 S3 photo upload round-trip', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const up = await request(port, 'POST', `/v1/landlord/listings/${listingId}/photos`, {
      token: landlordToken,
      body: {
        content_type: 'image/png',
        filename: 'dot.png',
        file_base64: png.toString('base64'),
      },
    });
    expect(up.status).toBe(201);
    expect(up.body.storage_key).toBeTruthy();
    expect(String(up.body.url)).toContain('memory://');

    const list = await request(port, 'GET', '/v1/landlord/listings', { token: landlordToken });
    const row = (list.body.listings as Array<Record<string, unknown>>).find((l) => l.id === listingId)!;
    expect(row.photo_url).toBeTruthy();
  });

  it('H-2 pre-approval masks contact; approve reveals + stamps contact_revealed_at', async () => {
    const pre = await request(port, 'GET', `/v1/landlord/listings/${listingId}/applicants`, {
      token: landlordToken,
    });
    expect(pre.status).toBe(200);
    const apps = pre.body.applicants as Array<Record<string, unknown>>;
    expect(apps).toHaveLength(1);
    expect(apps[0]!.contact).toBeNull();
    expect(JSON.stringify(apps[0])).not.toContain('secret@example.com');
    expect(JSON.stringify(apps[0])).not.toContain('Secret');

    const decide1 = await request(
      port,
      'POST',
      `/v1/landlord/listings/${listingId}/applicants/${applicationId}/decision`,
      { token: landlordToken, body: { decision: 'approve' } },
    );
    expect(decide1.status).toBe(200);
    expect(decide1.body.status).toBe('approved');
    expect(decide1.body.contact_revealed_at).toBeTruthy();

    const decide2 = await request(
      port,
      'POST',
      `/v1/landlord/listings/${listingId}/applicants/${applicationId}/decision`,
      { token: landlordToken, body: { decision: 'approve' } },
    );
    expect(decide2.status).toBe(200);
    expect(decide2.body.contact_revealed_at).toBe(decide1.body.contact_revealed_at);

    const post = await request(port, 'GET', `/v1/landlord/listings/${listingId}/applicants`, {
      token: landlordToken,
    });
    const contact = (post.body.applicants as Array<Record<string, unknown>>)[0]!.contact as Record<
      string,
      unknown
    >;
    expect(contact.email).toBe('secret@example.com');
    expect(contact.revealed_at).toBeTruthy();
  });

  it('H-2 decline does not reveal contact', async () => {
    const other = await withBypass(db.pool, async (c) => {
      const { rows: party } = await c.query<{ id: string }>(
        `insert into party (kind) values ('person') returning id`,
      );
      const { rows: rp } = await c.query<{ id: string }>(
        `insert into renter_profile (party_id, given_name, email, annual_income_cents)
         values ($1,'Hidden','hidden@example.com',5000000) returning id`,
        [party[0]!.id],
      );
      const { rows: app } = await c.query<{ id: string }>(
        `insert into application (
           party_id, renter_profile_id, listing_id, org_id, unit_id, entry_point, status
         )
         select $1,$2,l.id,l.org_id,l.unit_id,'renter_initiated','screening_complete'
         from listing l where l.id = $3
         returning id`,
        [party[0]!.id, rp[0]!.id, listingId],
      );
      return app[0]!.id;
    });

    const declined = await request(
      port,
      'POST',
      `/v1/landlord/listings/${listingId}/applicants/${other}/decision`,
      { token: landlordToken, body: { decision: 'decline' } },
    );
    expect(declined.status).toBe(200);
    expect(declined.body.contact_revealed_at).toBeNull();

    const list = await request(port, 'GET', `/v1/landlord/listings/${listingId}/applicants`, {
      token: landlordToken,
    });
    const row = (list.body.applicants as Array<Record<string, unknown>>).find(
      (a) => a.application_id === other,
    )!;
    expect(row.contact).toBeNull();
    expect(JSON.stringify(row)).not.toContain('hidden@example.com');
  });

  it('H-3 self-execution pending blocks resubmit; interim_v1 tagged', async () => {
    const first = await request(port, 'POST', '/v1/landlord/settings/self-execution', {
      token: landlordToken,
      body: {
        license_state: 'TX',
        license_type: 'licensed_broker',
        license_number: 'BR-123',
        file_base64: Buffer.from('evidence').toString('base64'),
        content_type: 'application/pdf',
        original_filename: 'license.pdf',
      },
    });
    expect(first.status).toBe(201);
    expect(first.body.compliance_tag).toBe('interim_v1');
    expect(first.body.status).toBe('pending');

    const second = await request(port, 'POST', '/v1/landlord/settings/self-execution', {
      token: landlordToken,
      body: {
        license_state: 'TX',
        license_type: 'owner_occupant',
      },
    });
    expect(second.status).toBe(409);

    const status = await request(port, 'GET', '/v1/landlord/settings/self-execution', {
      token: landlordToken,
    });
    expect(status.status).toBe(200);
    expect(status.body.compliance_tag).toBe('interim_v1');
  });

  it('keeps landlord org id stable for RLS evidence', () => {
    expect(landlordOrgId).toBeTruthy();
  });
});
