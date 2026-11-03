/**
 * Feature-preservation journeys for the renter marketplace.
 * Disposable Postgres. Does not hit production.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
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
    env: {
      ...process.env,
      VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
      VITE_DWEL_MAP_ENABLED: 'true',
    },
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

describe('marketplace regression preservation', () => {
  let db: TestDb;
  let appPool: DbPool;
  let server: http.Server;
  let vite: ChildProcess;
  let browser: Browser;
  let listingId = '';
  let directoryId = '';
  const vitePort = 5500 + Math.floor(Math.random() * 800);
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
         values ('landlord', 'Regression Homes', 'Regression', 'active', 'claimed') returning id`,
      );
      async function home(line1: string, beds: number, kind: 'partner' | 'directory', rent: number) {
        const address = await client.query<{ id: string }>(
          `insert into address (
             raw_input, line1, city, state, postal_code, normalized_hash,
             normalizer_vendor, normalizer_version, geom
           ) values (
             $1, $1, 'Austin', 'TX', '78701', $2, 'test', '1',
             ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326)::geography
           )
           returning id`,
          [line1, `regression-${randomUUID()}`],
        );
        const property = await client.query<{ id: string }>(
          `insert into property (address_id, property_type, display_name)
           values ($1, 'multifamily', $2) returning id`,
          [address.rows[0]!.id, line1],
        );
        const unit = await client.query<{ id: string }>(
          `insert into unit (property_id, unit_label_normalized, bedrooms, bathrooms)
           values ($1, '1', $2, 1) returning id`,
          [property.rows[0]!.id, beds],
        );
        const listing = await client.query<{ id: string }>(
          `insert into listing (
             org_id, unit_id, origin, rent_amount_cents, status, available_on, published_at, inventory_kind
           ) values ($1, $2, 'manual', $3, 'active', '2026-12-01', now(), $4) returning id`,
          [org.rows[0]!.id, unit.rows[0]!.id, rent, kind],
        );
        return listing.rows[0]!.id;
      }
      const rental = await home('500 Regression Lane', 2, 'partner', 180000);
      const directory = await home('HUD Directory Court', 1, 'directory', 0);
      return { rental, directory };
    });
    listingId = seeded.rental;
    directoryId = seeded.directory;
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

  it('preserves filters, hearts, savings, saved page, list/map, and directory separation', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${origin}/#/listings`);
    await see(page, '500 Regression Lane');

    // Filters remain available with inventory present.
    await page.getByTestId('rental-filter-bar').waitFor({ state: 'visible' });
    expect(await page.locator('#price').count()).toBe(1);
    expect(await page.locator('#beds').count()).toBe(1);
    expect(await page.locator('#baths').count()).toBe(1);
    expect(await page.locator('#ptype').count()).toBe(1);
    expect(await page.locator('#sort').count()).toBe(1);

    // Savings toast hidden before any heart.
    expect(await page.getByTestId('save-feedback-toast').count()).toBe(0);
    expect(await page.getByTestId('application-savings').count()).toBe(0);

    // Heart save drives compact toast + nav count.
    await page.getByRole('button', { name: 'Save this home' }).first().click();
    await page.getByTestId('save-feedback-toast').waitFor({ state: 'visible' });
    await see(page, /home saved|homes saved/i);
    expect(await page.locator('.dwel-nav-count').innerText()).toMatch(/1/);

    // Dismiss frees toolbar space.
    await page.getByRole('button', { name: 'Dismiss' }).click();
    expect(await page.getByTestId('save-feedback-toast').count()).toBe(0);

    // List / Map switch with shared selection.
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByTestId('listings-map-workspace').waitFor({ state: 'visible' });
    await page.locator('.dwel-map-panel__canvas').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await page.getByTestId('listings-list-workspace').waitFor({ state: 'visible' });

    // Filter no-match copy (not waitlist) when beds exceed inventory.
    await page.locator('#beds').selectOption('3');
    await page.getByTestId('listings-no-match').waitFor({ state: 'visible' });
    await see(page, 'No homes match your search');
    // Filters still present after zero rental results.
    await page.getByTestId('rental-filter-bar').waitFor({ state: 'visible' });
    await page.locator('#beds').selectOption('');

    // Directory tab uses compact directory presentation + limited filters.
    await page.getByRole('tab', { name: /Housing directory/ }).click();
    await see(page, 'HUD Directory Court');
    await page.getByTestId('directory-filter-bar').waitFor({ state: 'visible' });
    expect(await page.getByTestId(`card-listing-${directoryId}`).getAttribute('data-inventory-kind')).toBe(
      'directory',
    );

    // Saved page uses shared cards, not a bare unordered list.
    await page.goto(`${origin}/#/saved`);
    await page.getByTestId('saved-homes-grid').waitFor({ state: 'visible' });
    await see(page, '500 Regression Lane');
    await page.getByRole('link', { name: /View home/ }).first().click();
    await see(page, '500 Regression Lane');

    // Landing + FAQ remain reachable.
    await page.goto(`${origin}/#/`);
    await see(page, /Dwel|Find/i);
    await page.goto(`${origin}/#/faqs`);
    await see(page, /FAQ|Frequently|question/i);

    // Provider navigation still reachable.
    await page.goto(`${origin}/#/landlords`);
    await see(page, /landlord|provider|partner|broker/i);

    // Unsave from detail restores heart state.
    await page.goto(`${origin}/#/listings/${listingId}`);
    await page.getByRole('button', { name: 'Remove from saved', exact: true }).click();
    await see(page, 'Removed from saved homes');

    await context.close();
  }, 180_000);
});
