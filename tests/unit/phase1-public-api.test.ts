import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiRouter } from '../../src/http/router.js';
import {
  issueApplicationAccessToken,
  resetApplicationAccessRateLimits,
  revokeApplicationAccessTokens,
  validateApplicationAccessToken,
} from '../../src/modules/auth/index.js';
import {
  checkApplicationCreationRateLimit,
  resetApplicationCreationRateLimits,
} from '../../src/modules/applications/index.js';
import { AppError } from '../../src/modules/shared/errors.js';
import {
  recordScreeningConsent,
  resolveDisclosureVersion,
} from '../../src/modules/screening/index.js';
import {
  CertnSandboxTenantScreening,
  signCertnWebhookBody,
  verifyCertnWebhookSignature,
} from '../../src/modules/vendors/index.js';
import { resetRateLimitState } from '../../src/modules/public-api/index.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import { seedPhase5Listing, seedScrapingPolicy } from '../helpers/phase5.js';
import { seedPhase2TestConfig } from '../helpers/phase2.js';
import { MutableClock } from '../../src/modules/shared/clock.js';
import { resetApplicationRouteRateLimits } from '../../src/http/handlers.js';

function request(
  port: number,
  method: string,
  path: string,
  opts?: { body?: Record<string, unknown>; token?: string; headers?: Record<string, string> },
): Promise<{ status: number; body: Record<string, unknown>; raw: string }> {
  return new Promise((resolve, reject) => {
    const payload = opts?.body ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = { ...(opts?.headers ?? {}) };
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
            raw,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('Phase 1 / Certn vertical slice', () => {
  let db: TestDb;
  let server: http.Server;
  let port: number;
  const webhookSecret = 'test-certn-webhook-secret';

  beforeAll(async () => {
    db = await startTestDb();
    const router = createApiRouter({
      pool: db.pool,
      certnWebhookSecret: webhookSecret,
    });
    server = http.createServer(async (req, res) => {
      const handled = await router(req, res);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db?.stop();
  });

  beforeEach(() => {
    resetApplicationCreationRateLimits();
    resetApplicationAccessRateLimits();
    resetApplicationRouteRateLimits();
    resetRateLimitState();
  });

  it('resolveDisclosureVersion fails closed when screening_disclosure is not configured', async () => {
    await expect(
      withBypass(db.pool, (c) => resolveDisclosureVersion(c, new Date())),
    ).rejects.toMatchObject({
      code: 'disclosure_version_required',
      status: 503,
    });
  });

  it('recordScreeningConsent rejects mismatched disclosure_version', async () => {
    await withBypass(db.pool, async (c) => {
      await seedPhase2TestConfig(c);
      const { rows: party } = await c.query<{ id: string }>(
        `insert into party (kind) values ('person') returning id`,
      );
      const { rows: profile } = await c.query<{ id: string }>(
        `insert into renter_profile (party_id) values ($1) returning id`,
        [party[0]!.id],
      );
      const { rows: org } = await c.query<{ id: string }>(
        `insert into org (kind, legal_name, display_name) values ('landlord','t','t') returning id`,
      );
      const { rows: app } = await c.query<{ id: string }>(
        `insert into application (
           party_id, renter_profile_id, org_id, entry_point, status
         ) values ($1,$2,$3,'renter_initiated','draft') returning id`,
        [party[0]!.id, profile[0]!.id, org[0]!.id],
      );

      await expect(
        recordScreeningConsent(c, {
          applicationId: app[0]!.id,
          disclosureVersion: 'wrong-version',
        }),
      ).rejects.toMatchObject({ code: 'disclosure_version_mismatch' });
    });
  });

  it('screening_authorized_at cannot be set without consent (DB trigger)', async () => {
    await withBypass(db.pool, async (c) => {
      await seedPhase2TestConfig(c);
      const { rows: party } = await c.query<{ id: string }>(
        `insert into party (kind) values ('person') returning id`,
      );
      const { rows: profile } = await c.query<{ id: string }>(
        `insert into renter_profile (party_id) values ($1) returning id`,
        [party[0]!.id],
      );
      const { rows: org } = await c.query<{ id: string }>(
        `insert into org (kind, legal_name, display_name) values ('landlord','t','t') returning id`,
      );
      const { rows: app } = await c.query<{ id: string }>(
        `insert into application (
           party_id, renter_profile_id, org_id, entry_point, status
         ) values ($1,$2,$3,'renter_initiated','awaiting_landlord_interest') returning id`,
        [party[0]!.id, profile[0]!.id, org[0]!.id],
      );

      await expect(
        c.query(
          `update application
           set status = 'screening_authorized', screening_authorized_at = now()
           where id = $1`,
          [app[0]!.id],
        ),
      ).rejects.toThrow(/screening_consent/);
    });
  });

  it('POST /v1/applications is rate limited per IP', async () => {
    await withBypass(db.pool, async (c) => {
      await seedPhase2TestConfig(c);
      const listing = await seedPhase5Listing(c, db.kms);
      const ip = '203.0.113.99';
      for (let i = 0; i < 10; i++) {
        checkApplicationCreationRateLimit({ ip, listingId: listing.listingId, nowMs: 1_000 });
      }
      try {
        checkApplicationCreationRateLimit({ ip, listingId: listing.listingId, nowMs: 1_000 });
        throw new Error('expected rate limit');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('application_creation_rate_limited');
      }
    });
  });

  it('anonymous browse + apply + token + consent + status over HTTP', async () => {
    const listingId = await withBypass(db.pool, async (c) => {
      await seedPhase2TestConfig(c);
      await seedScrapingPolicy(c, { unauthenticatedBurstLimit: 100 });
      return (await seedPhase5Listing(c, db.kms)).listingId;
    });

    const listRes = await request(port, 'GET', '/v1/listings');
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.listings)).toBe(true);

    const createRes = await request(port, 'POST', '/v1/applications', {
      body: { listing_id: listingId },
    });
    expect(createRes.status).toBe(201);
    const applicationId = createRes.body.application_id as string;
    const token = createRes.body.access_token as string;
    expect(applicationId).toBeTruthy();
    expect(token).toBeTruthy();

    // Raw token must not be persisted
    const stored = await withBypass(db.pool, async (c) => {
      const { rows } = await c.query<{ token_hash: Buffer }>(
        `select token_hash from application_access_token where application_id = $1`,
        [applicationId],
      );
      return rows[0]!.token_hash.toString('utf8');
    });
    expect(stored).not.toContain(token);

    const consentRes = await request(port, 'POST', `/v1/applications/${applicationId}/consent`, {
      token,
      body: {},
    });
    expect(consentRes.status).toBe(402);
    expect(consentRes.body.error).toBe('payment_required');

    const payRes = await request(port, 'POST', `/v1/applications/${applicationId}/pay-consent`, {
      token,
      body: { agreed: true },
    });
    expect(payRes.status).toBe(201);
    expect(payRes.body.disclosure_version).toBe('test-disclosure-v1');
    expect(payRes.body.charge_id).toBeTruthy();

    const statusRes = await request(port, 'GET', `/v1/applications/${applicationId}`, { token });
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.application_id).toBe(applicationId);
    expect(statusRes.body.status).toBe('awaiting_landlord_interest');
  });

  it('access tokens: expired and revoked rejected; A cannot access B', async () => {
    await withBypass(db.pool, async (c) => {
      await seedPhase2TestConfig(c);
      const clock = new MutableClock(new Date('2026-01-01T00:00:00Z'));
      async function makeApp() {
        const { rows: party } = await c.query<{ id: string }>(
          `insert into party (kind) values ('person') returning id`,
        );
        const { rows: profile } = await c.query<{ id: string }>(
          `insert into renter_profile (party_id) values ($1) returning id`,
          [party[0]!.id],
        );
        const { rows: org } = await c.query<{ id: string }>(
          `insert into org (kind, legal_name, display_name) values ('landlord','t','t') returning id`,
        );
        const { rows: app } = await c.query<{ id: string }>(
          `insert into application (
             party_id, renter_profile_id, org_id, entry_point, status
           ) values ($1,$2,$3,'renter_initiated','draft') returning id`,
          [party[0]!.id, profile[0]!.id, org[0]!.id],
        );
        return app[0]!.id;
      }

      const appA = await makeApp();
      const appB = await makeApp();
      const a = await issueApplicationAccessToken(c, { applicationId: appA, clock });
      const b = await issueApplicationAccessToken(c, { applicationId: appB, clock });

      await expect(
        validateApplicationAccessToken(c, {
          applicationId: appB,
          token: a.token,
        }),
      ).rejects.toMatchObject({ code: 'application_access_invalid' });

      await revokeApplicationAccessTokens(c, appA, clock);
      await expect(
        validateApplicationAccessToken(c, {
          applicationId: appA,
          token: a.token,
        }),
      ).rejects.toMatchObject({ code: 'application_access_revoked' });

      clock.advanceMs(8 * 24 * 60 * 60 * 1000);
      await expect(
        validateApplicationAccessToken(c, {
          applicationId: appB,
          token: b.token,
          clock,
        }),
      ).rejects.toMatchObject({ code: 'application_access_expired' });
    });
  });

  it('cross-tenant application token cannot read other tenant under RLS', async () => {
    const seeded = await withBypass(db.pool, async (c) => {
      await seedPhase2TestConfig(c);
      const listingA = await seedPhase5Listing(c, db.kms);
      const listingB = await seedPhase5Listing(c, db.kms);
      return { listingA, listingB };
    });

    const createA = await request(port, 'POST', '/v1/applications', {
      body: { listing_id: seeded.listingA.listingId },
    });
    const createB = await request(port, 'POST', '/v1/applications', {
      body: { listing_id: seeded.listingB.listingId },
    });
    expect(createA.status).toBe(201);
    expect(createB.status).toBe(201);

    const cross = await request(
      port,
      'GET',
      `/v1/applications/${createB.body.application_id}`,
      { token: createA.body.access_token as string },
    );
    expect(cross.status).toBe(401);

    // App-role RLS: wrong party cannot see other application row
    const appPool = createAppPool(db.connectionString);
    try {
      const client = await appPool.connect();
      try {
        // Transaction-local GUCs only (is_local=true) — never session-scoped false.
        await client.query('begin');
        await client.query(`select set_config('rbit.current_party_id', $1, true)`, [
          (
            await withBypass(db.pool, async (c) => {
              const { rows } = await c.query<{ party_id: string }>(
                `select party_id from application where id = $1`,
                [createA.body.application_id],
              );
              return rows[0]!.party_id;
            })
          ),
        ]);
        await client.query(`select set_config('rbit.current_org_id', $1, true)`, [
          seeded.listingA.orgId,
        ]);
        const { rows } = await client.query(
          `select id from application where id = $1`,
          [createB.body.application_id],
        );
        expect(rows.length).toBe(0);
        await client.query('rollback');
      } finally {
        client.release();
      }
    } finally {
      await appPool.end();
    }
  });

  it('Certn sandbox adapter posts correct outbound request and persists vendor id', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const adapter = new CertnSandboxTenantScreening({
      apiKey: 'test-key',
      baseUrl: 'https://api.sandbox.certn.co',
      checkTypes: ['IDENTITY_VERIFICATION_1'],
      fetchImpl: async (url, init) => {
        calls.push({ url, body: init.body ?? '' });
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              id: 'case-123',
              checks: [{ id: 'check-1', type: 'IDENTITY_VERIFICATION_1', status: 'PENDING' }],
            });
          },
        };
      },
    });

    const result = await adapter.submitOrder(
      { partyId: '00000000-0000-4000-8000-000000000001', packageProductCodes: ['oneid'] },
      { correlationId: 'corr-1', partyId: '00000000-0000-4000-8000-000000000001' },
    );
    expect(result.vendorOrderRef).toBe('case-123');
    expect(calls[0]!.url).toContain('/api/public/cases/order/');
    expect(calls[0]!.body).toContain('IDENTITY_VERIFICATION_1');
  });

  it('Certn webhook: invalid signature rejected; valid+duplicate safe', async () => {
    const body = JSON.stringify({
      event_id: 'evt-1',
      event_type: 'CASE_STATUS_CHANGED',
      object_id: 'case-xyz',
      case_status: 'COMPLETE',
    });
    expect(verifyCertnWebhookSignature(body, 'deadbeef', webhookSecret)).toBe(false);
    const sig = signCertnWebhookBody(body, webhookSecret);
    expect(verifyCertnWebhookSignature(body, sig, webhookSecret)).toBe(true);

    const send = (signature: string) =>
      new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            method: 'POST',
            path: '/v1/webhooks/certn',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              'X-Signature': signature,
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(Buffer.from(c)));
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
        req.write(body);
        req.end();
      });

    const invalid = await send('00'.repeat(32));
    expect(invalid.status).toBe(401);

    const first = await send(sig);
    expect(first.status).toBe(200);
    const second = await send(sig);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
  });

  it('submit-screening fails closed without Certn config — no state or order', async () => {
    const prevKey = process.env.CERTN_API_KEY;
    const prevWh = process.env.CERTN_WEBHOOK_SECRET;
    delete process.env.CERTN_API_KEY;
    delete process.env.CERTN_WEBHOOK_SECRET;

    try {
      const listingId = await withBypass(db.pool, async (c) => {
        await seedPhase2TestConfig(c);
        await seedScrapingPolicy(c, { unauthenticatedBurstLimit: 100 });
        return (await seedPhase5Listing(c, db.kms)).listingId;
      });

      const createRes = await request(port, 'POST', '/v1/applications', {
        body: { listing_id: listingId },
      });
      expect(createRes.status).toBe(201);
      const applicationId = createRes.body.application_id as string;
      const token = createRes.body.access_token as string;

      await request(port, 'POST', `/v1/applications/${applicationId}/pay-consent`, {
        token,
        body: { agreed: true },
      });

      const submit = await request(port, 'POST', `/v1/applications/${applicationId}/submit-screening`, {
        token,
        body: {},
      });
      expect(submit.status).toBe(503);
      expect(submit.body.error).toBe('SCREENING_PROVIDER_UNAVAILABLE');

      const after = await withBypass(db.pool, async (c) => {
        const { rows: app } = await c.query<{ status: string }>(
          `select status from application where id = $1`,
          [applicationId],
        );
        const { rows: orders } = await c.query<{ n: string }>(
          `select count(*)::text as n from screening_order where application_id = $1`,
          [applicationId],
        );
        const { rows: reports } = await c.query<{ n: string }>(
          `select count(*)::text as n from screening_report sr
           join screening_order so on so.id = sr.screening_order_id
           where so.application_id = $1`,
          [applicationId],
        );
        return {
          status: app[0]!.status,
          orders: Number(orders[0]!.n),
          reports: Number(reports[0]!.n),
        };
      });
      expect(after.status).toBe('awaiting_landlord_interest');
      expect(after.orders).toBe(0);
      expect(after.reports).toBe(0);
    } finally {
      if (prevKey !== undefined) process.env.CERTN_API_KEY = prevKey;
      else delete process.env.CERTN_API_KEY;
      if (prevWh !== undefined) process.env.CERTN_WEBHOOK_SECRET = prevWh;
      else delete process.env.CERTN_WEBHOOK_SECRET;
    }
  });

  it('GET webhook challenge echoes challenge', async () => {
    const res = await new Promise<{ status: number; raw: string }>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/v1/webhooks/certn?challenge=abc123`, (r) => {
          const chunks: Buffer[] = [];
          r.on('data', (c) => chunks.push(Buffer.from(c)));
          r.on('end', () =>
            resolve({ status: r.statusCode ?? 0, raw: Buffer.concat(chunks).toString('utf8') }),
          );
        })
        .on('error', reject);
    });
    expect(res.status).toBe(200);
    expect(res.raw).toBe('abc123');
  });
});
