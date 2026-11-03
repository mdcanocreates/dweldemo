/**
 * Slice A visual and footer checks. Disposable Postgres. No production host.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { createApiRouter } from '../../src/http/router.js';
import { seedScrapingPolicy } from '../helpers/phase5.js';
import { createAppPool, startTestDb, withBypass, type TestDb } from '../helpers/db.js';
import type { DbPool } from '../../src/db/pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../../web');
const shotRoot = path.resolve(here, '../../../../docs/dwel/next-phase-ui');

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

describe('next-phase slice A browser checks', () => {
  let db: TestDb;
  let appPool: DbPool;
  let server: http.Server;
  let vite: ChildProcess;
  let browser: Browser;
  const vitePort = 5400 + Math.floor(Math.random() * 800);
  const origin = `http://127.0.0.1:${vitePort}`;

  beforeAll(async () => {
    process.env.APP_ENV = 'development';
    process.env.NODE_ENV = 'test';
    await mkdir(shotRoot, { recursive: true });
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);
    await withBypass(db.pool, async (client) => {
      await seedScrapingPolicy(client, { allowGenericAutomation: true, unauthenticatedBurstLimit: 200 });
      const org = await client.query<{ id: string }>(
        `insert into org (kind, legal_name, display_name, status, claim_status)
         values ('landlord', 'Slice A Homes', 'Slice A', 'active', 'claimed') returning id`,
      );
      const address = await client.query<{ id: string }>(
        `insert into address (
           raw_input, line1, city, state, postal_code, normalized_hash,
           normalizer_vendor, normalizer_version
         ) values ('410 Catalog Lane', '410 Catalog Lane', 'Austin', 'TX', '78701', $1, 'test', '1')
         returning id`,
        [`slice-a-${randomUUID()}`],
      );
      const property = await client.query<{ id: string }>(
        `insert into property (address_id, property_type) values ($1, 'residential') returning id`,
        [address.rows[0]!.id],
      );
      const unit = await client.query<{ id: string }>(
        `insert into unit (property_id, unit_label_normalized, bedrooms) values ($1, '1', 2) returning id`,
        [property.rows[0]!.id],
      );
      await client.query(
        `insert into listing (
           org_id, unit_id, origin, rent_amount_cents, status, available_on, published_at
         ) values ($1, $2, 'manual', 180000, 'active', '2026-12-01', now())`,
        [org.rows[0]!.id, unit.rows[0]!.id],
      );
    });
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

  it('captures list/map screenshots and keeps footer legal routes reachable', async () => {
    const page = await browser.newPage();
    const viewports = [
      { name: '1440', width: 1440, height: 900 },
      { name: '1024', width: 1024, height: 768 },
      { name: '390', width: 390, height: 844 },
    ] as const;

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${origin}/#/listings`);
      await page.getByText('410 Catalog Lane').first().waitFor({ state: 'visible', timeout: 15_000 });
      await page.screenshot({
        path: path.join(shotRoot, `${viewport.name}-list.png`),
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Map', exact: true }).click();
      await page.getByTestId('listings-map-workspace').waitFor({ state: 'visible' });
      const fits = await page.evaluate(
        'document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1',
      );
      expect(fits).toBe(true);
      await page.screenshot({
        path: path.join(shotRoot, `${viewport.name}-map.png`),
        fullPage: true,
      });
      await page.getByRole('button', { name: 'List', exact: true }).click();
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/#/listings`);
    await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shotRoot, 'footer-listings.png') });
    await page.getByRole('contentinfo').getByRole('link', { name: 'Terms', exact: true }).click();
    await page.getByText('DRAFT — Pending Legal Review by RBIT Counsel').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(shotRoot, 'terms-draft.png'), fullPage: true });
  }, 180_000);
});
