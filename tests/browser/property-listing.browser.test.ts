/**
 * Browser coverage for public inventory, saved homes, and the provider queue.
 * Disposable Postgres. No production host.
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
import { seedScrapingPolicy } from '../helpers/phase5.js';
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
      if (res.ok || res.status === 404) return;
      last = String(res.status);
    } catch (err) {
      last = err instanceof Error ? err.message : 'error';
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`timed out waiting for ${url}: ${last}`);
}

describe('property listing browser journey', () => {
  let db: TestDb;
  let appPool: DbPool;
  let server: http.Server;
  let vite: ChildProcess;
  let browser: Browser;
  let listingId = '';
  let renterSession = '';
  let landlordSession = '';
  const vitePort = 5300 + Math.floor(Math.random() * 800);
  const origin = `http://127.0.0.1:${vitePort}`;

  beforeAll(async () => {
    process.env.APP_ENV = 'development';
    process.env.NODE_ENV = 'test';
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);
    const seeded = await withBypass(db.pool, async (client) => {
      await seedScrapingPolicy(client, { allowGenericAutomation: true, unauthenticatedBurstLimit: 200 });
      const org = await client.query<{ id: string }>(
        `insert into org (kind, legal_name, display_name, status, claim_status)
         values ('landlord', 'Catalog Homes', 'Catalog', 'active', 'claimed') returning id`,
      );
      const landlord = await client.query<{ id: string }>(
        `insert into party (kind) values ('person') returning id`,
      );
      await client.query(
        `insert into party_role (party_id, org_id, role, status) values ($1, $2, 'landlord', 'active')`,
        [landlord.rows[0]!.id, org.rows[0]!.id],
      );
      const renter = await client.query<{ id: string }>(
        `insert into party (kind) values ('person') returning id`,
      );
      const profile = await client.query<{ id: string }>(
        `insert into renter_profile (party_id, given_name, family_name) values ($1, 'Ada', 'Lane') returning id`,
        [renter.rows[0]!.id],
      );
      async function home(line1: string, beds: number, status: string) {
        const address = await client.query<{ id: string }>(
          `insert into address (
             raw_input, line1, city, state, postal_code, normalized_hash,
             normalizer_vendor, normalizer_version
           ) values ($1, $1, 'Austin', 'TX', '78701', $2, 'test', '1') returning id`,
          [line1, `browser-listing-${randomUUID()}`],
        );
        const property = await client.query<{ id: string }>(
          `insert into property (address_id, property_type) values ($1, 'residential') returning id`,
          [address.rows[0]!.id],
        );
        const unit = await client.query<{ id: string }>(
          `insert into unit (property_id, unit_label_normalized, bedrooms) values ($1, '1', $2) returning id`,
          [property.rows[0]!.id, beds],
        );
        const listing = await client.query<{ id: string }>(
          `insert into listing (
             org_id, unit_id, origin, rent_amount_cents, status, available_on, published_at
           ) values ($1, $2, 'manual', 180000, $3, '2026-12-01', now()) returning id`,
          [org.rows[0]!.id, unit.rows[0]!.id, status],
        );
        return { listingId: listing.rows[0]!.id, unitId: unit.rows[0]!.id };
      }
      const active = await home('410 Catalog Lane', 2, 'active');
      await home('900 Draft Road', 2, 'draft');
      await client.query(
        `insert into listing_media (listing_id, org_id, position, url)
         values ($1, $2, 0, 'https://cdn.example/catalog-1.jpg'),
                ($1, $2, 1, 'https://cdn.example/catalog-2.jpg')`,
        [active.listingId, org.rows[0]!.id],
      );
      await client.query(
        `insert into application (
           party_id, renter_profile_id, listing_id, unit_id, org_id, entry_point, status, record_kind, intake_snapshot
         ) values
           ($1, $2, $3, $4, $5, 'renter_initiated', 'awaiting_landlord_interest', 'interest', '{"contact":{"given_name":"Ada"}}'::jsonb),
           ($1, $2, $3, $4, $5, 'renter_initiated', 'submitted', 'formal', '{"contact":{"given_name":"Ada"},"intake":{"employer_name":"Current Co"},"listing":{"line1":"410 Catalog Lane"}}'::jsonb)`,
        [renter.rows[0]!.id, profile.rows[0]!.id, active.listingId, active.unitId, org.rows[0]!.id],
      );
      const renterSessionRow = await client.query<{ id: string }>(
        `insert into session (party_id, expires_at) values ($1, now() + interval '1 day') returning id`,
        [renter.rows[0]!.id],
      );
      const landlordSessionRow = await client.query<{ id: string }>(
        `insert into session (party_id, expires_at) values ($1, now() + interval '1 day') returning id`,
        [landlord.rows[0]!.id],
      );
      return {
        listingId: active.listingId,
        renterSession: renterSessionRow.rows[0]!.id,
        landlordSession: landlordSessionRow.rows[0]!.id,
      };
    });
    listingId = seeded.listingId;
    renterSession = seeded.renterSession;
    landlordSession = seeded.landlordSession;
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

  async function see(page: Page, text: string | RegExp): Promise<void> {
    const locator = typeof text === 'string' ? page.getByText(text) : page.getByText(text);
    await locator.first().waitFor({ state: 'visible', timeout: 15_000 });
  }

  it('browses published inventory, saves it, and shows provider records separately', async () => {
    const guest = await browser.newContext();
    const page = await guest.newPage();
    await page.goto(`${origin}/#/listings`);
    await see(page, '410 Catalog Lane');
    await see(page, 'See how much you could save');
    expect(await page.getByTestId('listings-list-workspace').count()).toBe(1);
    expect(await page.getByText('900 Draft Road').count()).toBe(0);
    await page.getByRole('contentinfo').getByRole('link', { name: 'Terms', exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: /410 Catalog Lane/ }).click();
    await page.locator('.landing-card.is-selected').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByTestId('listings-map-workspace').waitFor({ state: 'visible' });
    await see(page, 'The map is turned off until a map style is configured.');
    await see(page, 'Locations are approximate');
    const desktopFits = await page.evaluate(
      'document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1',
    );
    expect(desktopFits).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await see(page, 'Locations are approximate');
    const mobileFits = await page.evaluate(
      'document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1',
    );
    expect(mobileFits).toBe(true);
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await see(page, '410 Catalog Lane');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('#beds').selectOption('3');
    await see(page, 'No homes match your search');
    await page.goto(`${origin}/#/listings/${listingId}`);
    await see(page, '410 Catalog Lane');
    await page.getByRole('button', { name: 'Photo 2' }).click();
    await guest.close();

    const renter = await browser.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${renterSession}` },
    });
    const renterPage = await renter.newPage();
    await renterPage.goto(`${origin}/#/listings/${listingId}`);
    await renterPage.getByRole('button', { name: 'Save this home' }).click();
    await see(renterPage, 'Saved to your account.');
    await renterPage.goto(`${origin}/#/saved`);
    await see(renterPage, '410 Catalog Lane');
    await withBypass(db.pool, (client) =>
      client.query(`update listing set status = 'paused' where id = $1`, [listingId]),
    );
    await renterPage.reload();
    await see(renterPage, 'No longer available');
    await renterPage.goto(`${origin}/#/listings`);
    expect(await renterPage.getByText('410 Catalog Lane').count()).toBe(0);
    await renter.close();

    const landlord = await browser.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${landlordSession}` },
    });
    const portal = await landlord.newPage();
    await portal.goto(`${origin}/#/landlord/listings/${listingId}/applicants`);
    await see(portal, 'Rental application');
    await see(portal, 'Interest');
    await portal.getByRole('button', { name: 'View submitted record' }).first().click();
    await see(portal, /Current Co|Ada/);
    await landlord.close();
  }, 120_000);
});
