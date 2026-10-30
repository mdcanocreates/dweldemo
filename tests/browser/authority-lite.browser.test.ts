/**
 * Browser coverage for the agency housing queue.
 * Uses a real session row and the local API. Production SSO is not exercised.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { totpCode } from '../../src/modules/authority/totp.js';
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
  let apiPort = 0;
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
    process.env.AUTHORITY_SCANNER_TOKEN = 'browser-scanner-token';
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
    const scannerHash = createHash('sha256').update('browser-scanner-token').digest('hex');
    await withBypass(db.pool, (client) =>
      client.query(`insert into authority_scanner_credential (id, token_hash) values (1, $1)`, [scannerHash]),
    );
    const router = createApiRouter({ pool: appPool });
    server = http.createServer(async (req, res) => {
      const handled = await router(req, res);
      if (!handled) {
        res.writeHead(404);
        res.end('{}');
      }
    });
    apiPort = await listen(server);
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

  it('completes tasks, a reschedule, a quarantined file, and a verification code', async () => {
    const context = await browser.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${sessionId}` },
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(`${origin}/#/authority/cases`);
    await page.getByRole('button', { name: 'New housing search' }).click();
    await page.getByLabel('Case reference').fill('E2E-CASE-002');
    await page.getByRole('button', { name: 'Save case' }).click();
    await page.getByRole('link', { name: 'E2E-CASE-002' }).click();
    await see(page, 'Housing case');
    await page.getByLabel('Task title').fill('Collect documents');
    await page.getByRole('button', { name: 'Save task' }).click();
    await see(page, 'Overdue');
    await page.getByRole('button', { name: 'Schedule visit' }).click();
    await see(page, 'Scheduled');
    await page.getByLabel('Reason for the new time').fill('Agency asked for a later visit');
    await page.getByRole('button', { name: 'Reschedule visit' }).click();
    await see(page, 'Rescheduled');

    const proof = Buffer.from('browser-proof');
    await page.getByLabel('Evidence file').setInputFiles({
      name: 'proof.pdf',
      mimeType: 'application/pdf',
      buffer: proof,
    });
    await see(page, 'Scanning');
    expect(await page.getByRole('button', { name: 'Preview' }).count()).toBe(0);

    const me = await fetch(`http://127.0.0.1:${apiPort}/v1/authority/me`, {
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    const agencyId = ((await me.json()) as { agencies: Array<{ agencyId: string }> }).agencies[0]!.agencyId;
    const listed = await fetch(`http://127.0.0.1:${apiPort}/v1/authority/agencies/${agencyId}/cases`, {
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    const caseId = ((await listed.json()) as { cases: Array<{ id: string; reference: string }> }).cases.find(
      (row) => row.reference === 'E2E-CASE-002',
    )!.id;
    const workspace = await fetch(
      `http://127.0.0.1:${apiPort}/v1/authority/agencies/${agencyId}/cases/${caseId}/workspace`,
      { headers: { Authorization: `Bearer ${sessionId}` } },
    );
    const documentId = ((await workspace.json()) as { documents: Array<{ id: string }> }).documents[0]!.id;
    const scanned = await fetch(`http://127.0.0.1:${apiPort}/v1/authority/internal/scans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-authority-scanner': 'browser-scanner-token' },
      body: JSON.stringify({
        documentId,
        sha256: createHash('sha256').update(proof).digest('hex'),
        verdict: 'clean',
        evidenceId: 'browser-scan',
      }),
    });
    expect(scanned.status).toBe(200);
    await page.reload();
    await see(page, 'Ready');
    await page.getByRole('button', { name: 'Preview' }).waitFor({ state: 'visible', timeout: 15_000 });

    await page.getByRole('button', { name: 'Record lease-up' }).click();
    await see(page, 'A fresh verification code is required for this action.');
    await page.getByRole('button', { name: 'Set up verification' }).click();
    const secret = (await page.getByText('Authenticator secret').locator('span').textContent()) ?? '';
    await page.getByLabel('Verification code').fill(totpCode(secret.trim()));
    await page.getByRole('button', { name: 'Confirm code' }).click();
    await see(page, 'Verification code accepted.');
    await page.getByRole('button', { name: 'Record lease-up' }).click();
    await see(page, 'Lease-up confirmed');
    await page.reload();
    await see(page, 'Lease-up confirmed');
    await context.close();
  });

  it.skip('owner invitation through agency single sign-on', () => {
    // BLOCKED: this build reuses Dwel session rows. No agency SSO or MFA provider is configured.
  });
});
