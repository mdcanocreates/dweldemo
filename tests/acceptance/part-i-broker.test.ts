import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiRouter } from '../../src/http/router.js';
import { ensureBrokerBalance, ensureBrokerPerformance } from '../../src/modules/brokerage/index.js';
import {
  MemoryStripeConnectAdapter,
  resetStripeConnectAdapter,
  setStripeConnectAdapter,
} from '../../src/modules/payments/index.js';
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

describe('Part I — broker dashboard + Stripe Connect', () => {
  let db: TestDb;
  let server: http.Server;
  let port: number;
  let brokerToken: string;
  let landlordToken: string;
  let orgId: string;
  let connect: MemoryStripeConnectAdapter;

  beforeAll(async () => {
    connect = resetStripeConnectAdapter();
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
         values ('brokerage','I Broker','I Broker') returning id`,
      );
      const brokerageId = org[0]!.id;
      const { rows: llOrg } = await c.query<{ id: string }>(
        `insert into org (kind, legal_name, display_name)
         values ('landlord','I Landlord','I Landlord') returning id`,
      );

      const { rows: brokerParty } = await c.query<{ id: string }>(
        `insert into party (kind) values ('person') returning id`,
      );
      await c.query(
        `insert into party_role (party_id, org_id, role) values ($1,$2,'broker_admin')`,
        [brokerParty[0]!.id, brokerageId],
      );
      const { rows: brokerSession } = await c.query<{ id: string }>(
        `insert into session (party_id, expires_at, elevated_until)
         values ($1, now() + interval '1 day', now() + interval '1 hour')
         returning id`,
        [brokerParty[0]!.id],
      );

      const { rows: llParty } = await c.query<{ id: string }>(
        `insert into party (kind) values ('person') returning id`,
      );
      await c.query(
        `insert into party_role (party_id, org_id, role) values ($1,$2,'landlord')`,
        [llParty[0]!.id, llOrg[0]!.id],
      );
      const { rows: llSession } = await c.query<{ id: string }>(
        `insert into session (party_id, expires_at, elevated_until)
         values ($1, now() + interval '1 day', now() + interval '1 hour')
         returning id`,
        [llParty[0]!.id],
      );

      await c.query(
        `insert into config_version (
           id, namespace, version, payload, effective_from,
           proposed_by_party_id, approved_by_party_id, approved_at
         ) values ($1,'broker_economics','i-1',$2::jsonb, now(), $3, $3, now())`,
        [
          randomUUID(),
          JSON.stringify({ blended_broker_margin: 40000 }),
          brokerParty[0]!.id,
        ],
      );

      await ensureBrokerPerformance(c, brokerageId);
      await ensureBrokerBalance(c, brokerageId);
      await c.query(
        `update broker_performance set
           leads_offered = 4, leads_accepted = 2, placements_closed = 1,
           close_rate = 0.5, median_response_seconds = 90, leakage_rate = 0.05
         where org_id = $1`,
        [brokerageId],
      );

      return {
        orgId: brokerageId,
        brokerToken: brokerSession[0]!.id,
        landlordToken: llSession[0]!.id,
      };
    });

    brokerToken = seeded.brokerToken;
    landlordToken = seeded.landlordToken;
    orgId = seeded.orgId;
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db?.stop();
  });

  it('I-0 broker_payouts_enabled defaults false and hides payouts', async () => {
    const overview = await request(port, 'GET', '/v1/broker/overview', { token: brokerToken });
    expect(overview.status).toBe(200);
    expect(overview.body.broker_payouts_enabled).toBe(false);
    expect((overview.body.payouts as { available: boolean; reason: string }).available).toBe(false);
    expect((overview.body.payouts as { reason: string }).reason).toBe('broker_payouts_disabled');

    await withBypass(db.pool, async (c) => {
      await c.query(`update org set broker_payouts_enabled = true where id = $1`, [orgId]);
    });
    // still no connect → not available
    const after = await request(port, 'GET', '/v1/broker/overview', { token: brokerToken });
    expect(after.body.broker_payouts_enabled).toBe(true);
    expect((after.body.payouts as { reason: string }).reason).toMatch(/connect_/);
  });

  it('I-1 performance dashboard returns real metrics', async () => {
    const res = await request(port, 'GET', '/v1/broker/performance?window_days=90', {
      token: brokerToken,
    });
    expect(res.status).toBe(200);
    expect(res.body.leads_offered).toBe(4);
    expect(res.body.placements_closed).toBe(1);
    expect(res.body.ev_per_lead).toBe(0.5 * 40000);

    const subs = await request(port, 'GET', '/v1/broker/submarkets?window_days=90', {
      token: brokerToken,
    });
    expect(subs.status).toBe(200);
    expect(Array.isArray(subs.body.submarkets)).toBe(true);
  });

  it('I-2 leads paginate at 25/page', async () => {
    const res = await request(port, 'GET', '/v1/broker/leads?page=1', { token: brokerToken });
    expect(res.status).toBe(200);
    expect(res.body.page_size).toBe(25);
    expect(res.body.page).toBe(1);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('I-3 Connect onboarding allowed while payouts disabled; landlord can use Connect', async () => {
    setStripeConnectAdapter(connect);
    await withBypass(db.pool, async (c) => {
      await c.query(`update org set broker_payouts_enabled = false where id = $1`, [orgId]);
    });

    const created = await request(port, 'POST', '/v1/stripe/connect/account', {
      token: brokerToken,
      body: {},
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending');
    expect(created.body.broker_payouts_enabled).toBe(false);
    expect(created.body.account_id).toBeTruthy();

    const link = await request(port, 'POST', '/v1/stripe/connect/onboarding-link', {
      token: brokerToken,
      body: {},
    });
    expect(link.status).toBe(200);
    expect(String(link.body.url)).toContain('memory://stripe-connect/onboard');

    connect.completeOnboarding(String(created.body.account_id));
    const refreshed = await request(port, 'GET', '/v1/stripe/connect/account', {
      token: brokerToken,
    });
    expect(refreshed.body.status).toBe('active');

    const ll = await request(port, 'POST', '/v1/stripe/connect/onboarding-link', {
      token: landlordToken,
      body: {},
    });
    expect(ll.status).toBe(200);
    expect(ll.body.account_id).toBeTruthy();
  });
});
