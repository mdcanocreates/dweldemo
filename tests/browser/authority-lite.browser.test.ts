/**
 * Browser coverage for the agency housing queue.
 * Uses a real session row and the local API. Production SSO is not exercised.
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

describe('authority lite browser', () => {
  let db: TestDb;
  let appPool: DbPool;
  let server: http.Server;
  let vite: ChildProcess;
  let browser: Browser;
  let sessionId = '';
  const vitePort = 5400 + Math.floor(Math.random() * 500);
  const origin = `http://127.0.0.1:${vitePort}`;
  const foreignAgencyId = randomUUID();

  beforeAll(async () => {
    process.env.APP_ENV = 'development';
    process.env.NODE_ENV = 'test';
    process.env.DWEL_AUTHORITY_LITE = '1';
    process.env.DWEL_AUTHORITY_SANDBOX = '1';
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);
    sessionId = await withBypass(db.pool, async (client) => {
      const party = await client.query<{ id: string }>(
        `insert into party (kind) values ('person') returning id`,
      );
      const agency = await client.query<{ id: string }>(
        `insert into authority_tenant (display_name, status) values ('Browser Agency', 'trial') returning id`,
      );
      await client.query(
        `insert into authority_membership (agency_id, staff_party_id, role, status)
         values ($1,$2,'agency_owner','active')`,
        [agency.rows[0]!.id, party.rows[0]!.id],
      );
      const session = await client.query<{ id: string }>(
        `insert into session (party_id, expires_at) values ($1, now() + interval '1 day') returning id`,
        [party.rows[0]!.id],
      );
      return session.rows[0]!.id;
    });
    const router = createApiRouter({ pool: appPool });
    server = http.createServer(async (req, res) => {
      const handled = await router(req, res);
      if (!handled) {
        res.writeHead(404);
        res.end('{}');
      }
    });
    const apiPort = await listen(server);
    vite = startVite(vitePort, apiPort);
    await waitForHttp(origin);
    browser = await chromium.launch({ headless: true });
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    vite?.kill();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await appPool?.end();
    await db?.stop();
  });

  async function see(page: Page, text: string): Promise<void> {
    await page.getByText(text).first().waitFor({ state: 'visible', timeout: 15_000 });
  }

  it('keeps a saved housing case after refresh and rejects another agency', async () => {
    const context = await browser.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${sessionId}` },
    });
    const page = await context.newPage();
    await page.goto(`${origin}/#/authority/cases`);
    await see(page, 'Agency housing searches');
    await page.getByRole('button', { name: 'New housing search' }).click();
    await page.getByLabel('Case reference').fill('E2E-CASE-001');
    await page.getByRole('button', { name: 'Save case' }).click();
    await see(page, 'E2E-CASE-001');
    await see(page, 'Not started');
    await page.reload();
    await see(page, 'E2E-CASE-001');

    await page.setViewportSize({ width: 390, height: 844 });
    await see(page, 'E2E-CASE-001');

    await page.goto(`${origin}/#/authority/agencies/${foreignAgencyId}/cases`);
    await page.getByRole('alert').waitFor({ state: 'visible', timeout: 15_000 });
    await expect.poll(async () => page.getByText('E2E-CASE-001').count()).toBe(0);
    await context.close();
  });

  it.skip('owner invitation through agency single sign-on', () => {
    // BLOCKED: this build reuses Dwel session rows. No agency SSO or MFA provider is configured.
  });
});
