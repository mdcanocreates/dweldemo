/**
 * Browser journey for provider intake, property authority, broker assignment, and public catalog.
 * Disposable Postgres. No production host.
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
const suffix = randomUUID().slice(0, 8);
const providerEmail = `provider-${suffix}@example.com`;
const brokerEmail = `broker-${suffix}@example.com`;
const adminEmail = `admin-${suffix}@example.com`;
const address = `${700 + Math.floor(Math.random() * 200)} Authority Lane`;
const shownAddress = address.toUpperCase().replace(/\bLANE\b/, 'LN');

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

function apiRequest(
  port: number,
  method: string,
  pathName: string,
  sessionId: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = { Authorization: `Bearer ${sessionId}` };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    const req = http.request({ hostname: '127.0.0.1', port, method, path: pathName, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode ?? 0,
          body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function signIn(page: Page, origin: string, email: string, nextPath: string): Promise<string> {
  const session = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no session for ${email}`)), 20_000);
    const onResponse = (res: { url: () => string; status: () => number; json: () => Promise<{ session_id?: string }> }) => {
      if (!res.url().includes('/v1/auth/email-code/verify') || res.status() !== 200) return;
      void res.json().then((body) => {
        if (!body.session_id) return;
        clearTimeout(timer);
        page.off('response', onResponse);
        resolve(body.session_id);
      }).catch(() => undefined);
    };
    page.on('response', onResponse);
  });
  await page.goto(`${origin}/#${nextPath}`);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  return session;
}

describe('provider and broker browser journey', () => {
  let db: TestDb;
  let appPool: DbPool;
  let server: http.Server;
  let vite: ChildProcess;
  let browser: Browser;
  let apiPort = 0;
  const vitePort = 6400 + Math.floor(Math.random() * 800);
  const origin = `http://127.0.0.1:${vitePort}`;

  beforeAll(async () => {
    process.env.APP_ENV = 'development';
    process.env.NODE_ENV = 'test';
    process.env.AUTH_RETURN_REDEEM_TOKEN = '1';
    process.env.AUTH_EMAIL_ALLOWLIST = [providerEmail, brokerEmail, adminEmail].join(',');
    process.env.EMAIL_PROVIDER = 'stub';
    db = await startTestDb();
    appPool = createAppPool(db.connectionString);
    await withBypass(db.pool, (client) =>
      seedScrapingPolicy(client, { allowGenericAutomation: true, unauthenticatedBurstLimit: 200 }),
    );
    server = http.createServer(async (req, res) => {
      const handled = await createApiRouter({ pool: appPool })(req, res);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
      }
    });
    apiPort = await listen(server);
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

  it('reviews a provider, publishes only after property verification, and limits the broker', async () => {
    const providerContext = await browser.newContext();
    const providerPage = await providerContext.newPage();
    const providerSession = await signIn(providerPage, origin, providerEmail, '/sign-in?role=landlord&next=/partner/landlord');
    await providerContext.setExtraHTTPHeaders({ Authorization: `Bearer ${providerSession}` });
    await providerPage.getByRole('heading', { name: 'Home provider intake' }).waitFor();
    await providerPage.getByLabel('Full name').fill('Pat Provider');
    await providerPage.getByLabel('Email').fill(providerEmail);
    await providerPage.getByLabel('Phone').fill('+15125550100');
    await providerPage.getByLabel('Organization or company').fill('Pat Homes');
    await providerPage.getByLabel('Market').fill('Austin');
    await providerPage.getByLabel('Unit count or portfolio size').fill('4');
    await providerPage.getByLabel('Property types').fill('residential');
    await providerPage.getByRole('button', { name: 'Submit intake' }).click();
    await providerPage.getByText('The dashboard stays closed until it is approved.').waitFor();

    const brokerContext = await browser.newContext();
    const brokerPage = await brokerContext.newPage();
    const brokerSession = await signIn(brokerPage, origin, brokerEmail, '/sign-in?role=broker&next=/partner/broker');
    await brokerContext.setExtraHTTPHeaders({ Authorization: `Bearer ${brokerSession}` });
    await brokerPage.getByRole('heading', { name: 'Broker intake' }).waitFor();
    await brokerPage.getByLabel('Full name').fill('Bea Broker');
    await brokerPage.getByLabel('Email').fill(brokerEmail);
    await brokerPage.getByLabel('Phone').fill('+15125550101');
    await brokerPage.getByLabel('Brokerage').fill('Bea Brokerage');
    await brokerPage.getByLabel('Markets served').fill('Austin');
    await brokerPage.getByLabel('Team size or production context').fill('2');
    await brokerPage.getByRole('button', { name: 'Submit intake' }).click();
    await brokerPage.getByText('The dashboard stays closed until it is approved.').waitFor();

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const adminSession = await signIn(adminPage, origin, adminEmail, '/sign-in?next=/admin/partner-intakes');
    await adminPage.getByText('Admin access required').waitFor();
    const adminMe = await apiRequest(apiPort, 'GET', '/v1/auth/me', adminSession);
    expect(adminMe.status).toBe(200);
    await withBypass(db.pool, (client) =>
      client.query(
        `insert into party_role (party_id, role, status) values ($1, 'rbit_admin', 'active')`,
        [String(adminMe.body.party_id)],
      ),
    );
    await adminContext.setExtraHTTPHeaders({ Authorization: `Bearer ${adminSession}` });
    await adminPage.reload();
    await adminPage.getByRole('heading', { name: 'Partner intakes' }).waitFor();
    const providerRow = adminPage.getByRole('row').filter({ hasText: 'Pat Provider' });
    await providerRow.getByLabel('Reviewer note').fill('Confirm the four homes are yours to rent.');
    await providerRow.getByRole('button', { name: 'Request information' }).click();
    await providerRow.getByText('under_review').waitFor();

    await providerPage.reload();
    await providerPage.getByTestId('reviewer-note').waitFor();
    expect(await providerPage.getByTestId('reviewer-note').textContent()).toContain('four homes');
    await providerPage.getByLabel('Response').fill('Yes. I control those four homes.');
    await providerPage.getByRole('button', { name: 'Send response' }).click();
    await providerPage.getByTestId('provider-response').waitFor();

    await adminPage.reload();
    await adminPage.getByRole('row').filter({ hasText: 'Pat Provider' }).getByRole('button', { name: 'Approve' }).click();
    await adminPage.getByRole('row').filter({ hasText: 'Pat Provider' }).getByText('approved').waitFor();
    await adminPage.getByRole('row').filter({ hasText: 'Bea Broker' }).getByRole('button', { name: 'Approve' }).click();
    await adminPage.getByRole('row').filter({ hasText: 'Bea Broker' }).getByText('approved').waitFor();

    await providerPage.reload();
    await providerPage.getByRole('link', { name: 'Continue to dashboard' }).click();
    await providerPage.getByRole('heading', { name: 'Portfolio pulse' }).waitFor();
    await providerPage.goto(`${origin}/#/landlord/listings/new`);
    await providerPage.locator('#ll-address').fill(address);
    await providerPage.locator('#ll-city').fill('Austin');
    await providerPage.locator('#ll-state').fill('TX');
    await providerPage.locator('#ll-postal').fill('78701');
    await providerPage.locator('#ll-rent').fill('1800');
    await providerPage.locator('#ll-beds').fill('2');
    await providerPage.locator('#ll-baths').fill('1');
    await providerPage.locator('#ll-avail').fill('2026-12-01');
    await providerPage.getByRole('button', { name: 'Create listing' }).click();
    await providerPage.getByRole('heading', { name: 'My listings' }).waitFor();
    const card = providerPage.locator('.ll-card', { hasText: shownAddress });
    await card.getByRole('button', { name: 'Publish' }).click();
    await providerPage.getByText(/property_authority/).waitFor();

    await card.getByLabel('How you control this property').fill('I own this home and can offer it for rent.');
    await card.getByRole('button', { name: 'Submit property statement' }).click();
    await card.getByTestId('authority-status').waitFor();

    await adminPage.goto(`${origin}/#/admin/property-authorities`);
    const authorityRow = adminPage.getByRole('row').filter({ hasText: shownAddress });
    await authorityRow.getByRole('button', { name: 'Verify' }).click();
    await adminPage.getByText('No property statements are waiting.').waitFor();

    await providerPage.reload();
    const published = providerPage.locator('.ll-card', { hasText: shownAddress });
    await published.getByRole('button', { name: 'Publish' }).click();
    await published.getByRole('button', { name: 'Pause' }).waitFor();

    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    await guestPage.goto(`${origin}/#/listings`);
    await guestPage.getByText(shownAddress).waitFor();

    const brokerOrg = await withBypass(db.pool, async (client) => {
      const { rows } = await client.query<{ org_id: string; listing_id: string }>(
        `select pr.org_id, l.id as listing_id
         from partner_intake pi
         join party_role pr on pr.org_id = pi.org_id and pr.role = 'broker' and pr.revoked_at is null
         join listing l on l.status = 'active'
         join unit u on u.id = l.unit_id
         join property p on p.id = u.property_id
         join address a on a.id = p.address_id
         where pi.organization_name = 'Bea Brokerage'
           and (a.line1 = $1 or a.raw_input = $2)`,
        [shownAddress, address],
      );
      return rows[0];
    });
    expect(brokerOrg?.org_id).toBeTruthy();
    expect(providerSession).not.toBe('');
    const granted = await apiRequest(apiPort, 'POST', '/v1/landlord/broker-assignments', providerSession, {
      listing_id: brokerOrg!.listing_id,
      broker_org_id: brokerOrg!.org_id,
    });
    expect(granted.status).toBe(201);

    await brokerPage.goto(`${origin}/#/broker/listings`);
    await brokerPage.reload();
    await brokerPage.getByText(shownAddress).waitFor();

    const assignmentId = String((granted.body.assignment as { id: string }).id);
    const revoked = await apiRequest(
      apiPort,
      'POST',
      `/v1/landlord/broker-assignments/${assignmentId}/revoke`,
      providerSession,
    );
    expect(revoked.status).toBe(200);
    await brokerPage.reload();
    await brokerPage.getByText('No listings assigned yet').waitFor();

    await published.getByRole('button', { name: 'Pause' }).click();
    await published.getByRole('button', { name: 'Publish' }).waitFor();
    await guestPage.reload();
    await guestPage.getByTestId('listings-empty').waitFor();

    await guest.close();
    await adminContext.close();
    await brokerContext.close();
    await providerContext.close();
  }, 180_000);
});
