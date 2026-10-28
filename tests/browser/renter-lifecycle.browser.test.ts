/**
 * Browser coverage for the renter profile, application, and tracker.
 * Disposable Postgres and the non-superuser app role. No production host.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createApiRouter } from '../../src/http/router.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import type { DbPool } from '../../src/db/pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../../web');

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function startVite(port: number, apiPort: number): ChildProcess {
  return spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: webRoot,
    env: { ...process.env, VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
    shell: true,
    stdio: 'pipe',
  });
}

async function waitForHttp(url: string): Promise<void> {
  const deadline = Date.now() + 45_000;
  let last = 'not started';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
      last = String(res.status);
    } catch (err) {
      last = err instanceof Error ? err.message : 'connection failed';
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`timed out waiting for ${url}: ${last}`);
}

describe('renter lifecycle browser', () => {
  let db: TestDb;
  let appPool: DbPool;
  let server: http.Server;
  let vite: ChildProcess;
  let browser: Browser;
  let listingId = '';
  let sessionId = '';
  let returnSessionId = '';
  const email = `browser-${randomUUID().slice(0, 8)}@example.com`;
  const vitePort = 5200 + Math.floor(Math.random() * 800);
  const origin = `http://127.0.0.1:${vitePort}`;

  beforeAll(async () => {
    process.env.APP_ENV = 'development';
    process.env.NODE_ENV = 'test';
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);
    const seeded = await withBypass(db.pool, async (client) => {
      const org = await client.query<{ id: string }>(
        `insert into org (kind, legal_name, display_name, claim_status)
         values ('landlord','Browser Homes','Browser','claimed') returning id`,
      );
      const party = await client.query<{ id: string }>(
        `insert into party (kind) values ('person') returning id`,
      );
      const profile = await client.query<{ id: string }>(
        `insert into renter_profile (party_id) values ($1) returning id`,
        [party.rows[0]!.id],
      );
      async function home(line1: string, rent: number, status: string) {
        const address = await client.query<{ id: string }>(
          `insert into address (
             raw_input, line1, city, state, postal_code, normalized_hash,
             normalizer_vendor, normalizer_version
           ) values ($1,$1,'Austin','TX','78701',$2,'test','1') returning id`,
          [line1, `browser-${randomUUID()}`],
        );
        const property = await client.query<{ id: string }>(
          `insert into property (address_id, property_type) values ($1,'sfr') returning id`,
          [address.rows[0]!.id],
        );
        const unit = await client.query<{ id: string }>(
          `insert into unit (property_id, unit_label_normalized) values ($1,'1') returning id`,
          [property.rows[0]!.id],
        );
        const listing = await client.query<{ id: string }>(
          `insert into listing (org_id, unit_id, origin, rent_amount_cents, status)
           values ($1,$2,'manual',$3,$4) returning id`,
          [org.rows[0]!.id, unit.rows[0]!.id, rent, status],
        );
        return { listingId: listing.rows[0]!.id, unitId: unit.rows[0]!.id };
      }
      const active = await home('410 Renter Lane', 180000, 'active');
      const paused = await home('88 Archive Road', 140000, 'paused');
      await client.query(
        `insert into application (
           party_id, renter_profile_id, listing_id, unit_id, org_id, entry_point, status
         ) values ($1,$2,$3,$4,$5,'renter_initiated','draft')`,
        [party.rows[0]!.id, profile.rows[0]!.id, paused.listingId, paused.unitId, org.rows[0]!.id],
      );
      await client.query(
        `insert into config_version (
           id, namespace, version, payload, effective_from,
           proposed_by_party_id, approved_by_party_id, approved_at
         ) values (
           gen_random_uuid(), 'application_access', 'renter-browser',
           '{"token_ttl_ms":604800000}'::jsonb, now(), $1, $1, now()
         )`,
        [party.rows[0]!.id],
      );
      const first = await client.query<{ id: string }>(
        `insert into session (party_id, expires_at) values ($1, now() + interval '1 day') returning id`,
        [party.rows[0]!.id],
      );
      const second = await client.query<{ id: string }>(
        `insert into session (party_id, expires_at) values ($1, now() + interval '1 day') returning id`,
        [party.rows[0]!.id],
      );
      return {
        listingId: active.listingId,
        sessionId: first.rows[0]!.id,
        returnSessionId: second.rows[0]!.id,
      };
    });
    listingId = seeded.listingId;
    sessionId = seeded.sessionId;
    returnSessionId = seeded.returnSessionId;

    server = http.createServer(async (req, res) => {
      const handled = await createApiRouter({ pool: appPool })(req, res);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
      }
    });
    const apiPort = await listen(server);
    vite = startVite(vitePort, apiPort);
    await waitForHttp(`${origin}/`);
    browser = await chromium.launch();
  }, 240_000);

  afterAll(async () => {
    await browser?.close();
    if (vite?.pid) {
      spawn('taskkill', ['/F', '/T', '/PID', String(vite.pid)], { shell: true, stdio: 'ignore' });
    }
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await appPool?.end();
    await db?.stop();
  });

  async function openSession(id: string): Promise<BrowserContext> {
    return browser.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${id}` } });
  }

  async function see(page: Page, text: string | RegExp): Promise<void> {
    const locator = typeof text === 'string' ? page.getByText(text) : page.getByText(text);
    await locator.first().waitFor({ state: 'visible', timeout: 15_000 });
  }

  it('saves a profile, applies to one home, and tracks that home after another sign-in', async () => {
    const first = await openSession(sessionId);
    const page = await first.newPage();
    await page.goto(`${origin}/#/discover`);
    await see(page, 'No profile is saved on this account yet.');
    await page.getByLabel('First name').fill('Ada');
    await page.getByLabel('Last name').fill('Browser');
    await page.getByLabel('Phone').fill('+15125550100');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('When do you need to move?').selectOption('flexible');
    await page.getByLabel('Max monthly rent').fill('1800');
    await page.getByLabel('Minimum bedrooms').fill('2');
    await page.getByLabel('State').fill('TX');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await page.waitForURL(/\/listings/);
    await page.goto(`${origin}/#/discover`);
    await see(page, 'Saved to your account.');
    expect(await page.getByLabel('First name').inputValue()).toBe('Ada');
    await page.reload();
    expect(await page.getByLabel('First name').inputValue()).toBe('Ada');
    expect(await page.getByLabel('Last name').inputValue()).toBe('Browser');
    await first.close();

    const second = await openSession(returnSessionId);
    const returned = await second.newPage();
    await returned.goto(`${origin}/#/discover`);
    await expect.poll(async () => returned.getByLabel('First name').inputValue()).toBe('Ada');
    await expect.poll(async () => returned.getByLabel('Email').inputValue()).toBe(email);
    await returned.goto(`${origin}/#/apply/${listingId}`);
    await returned.getByLabel('Street address').fill('500 Current St');
    await returned.getByLabel('City').fill('Austin');
    await returned.getByLabel('State').fill('TX');
    await returned.getByLabel('Postal code').fill('78702');
    await returned.getByRole('textbox', { name: 'Employer', exact: true }).fill('Current Co');
    await returned.getByLabel('Job title').fill('Analyst');
    const submit = returned.getByRole('button', { name: 'Save and submit interest' });
    if ((await submit.count()) === 0) {
      const text = await returned.locator('body').innerText();
      throw new Error(text.slice(0, 1800));
    }
    await submit.click();
    await see(returned, 'Interest sent');
    await returned.goto(`${origin}/#/applications`);
    await see(returned, '410 Renter Lane');
    await see(returned, /review your interest in this home/i);
    await see(returned, '88 Archive Road');
    await see(returned, 'Started, not sent');
    await see(returned, /no longer available/i);
    await returned.getByRole('link', { name: 'View submitted details' }).first().click();
    await see(returned, 'Current Co');
    await see(returned, 'Ada Browser');
    await see(returned, 'Listing: Available');
    await returned.goto(`${origin}/#/discover`);
    await expect.poll(async () => returned.getByLabel('First name').inputValue()).toBe('Ada');
    await returned.getByLabel('First name').fill('Changed');
    await expect.poll(async () => returned.getByLabel('First name').inputValue()).toBe('Changed');
    await expect.poll(async () => returned.getByLabel('First name').inputValue()).toBe('Changed');
    await returned.getByRole('button', { name: 'Save profile' }).click();
    await returned.waitForURL(/listings/);
    await returned.goto(`${origin}/#/discover`);
    await expect.poll(async () => returned.getByLabel('First name').inputValue()).toBe('Changed');
    await returned.goto(`${origin}/#/applications`);
    await returned.getByRole('link', { name: 'View submitted details' }).first().click();
    await see(returned, 'Ada Browser');
    await second.close();
  });
});
