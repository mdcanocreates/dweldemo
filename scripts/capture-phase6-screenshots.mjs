/**
 * Capture Part M-1 nav screenshots + QF-1 broker shell via Playwright.
 * Mocks /v1/auth/me so each role state is isolated and reproducible.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.DWEL_BASE_URL ?? 'https://d1j0s2h5mond9a.cloudfront.net';
const OUT = join(process.cwd(), 'evidence', 'phase6');

const fixtures = {
  anon: null,
  renter: {
    party_id: '00000000-0000-4000-8000-000000000001',
    session_id: 'sess-renter',
    roles: [{ role: 'renter', org_id: null }],
    landlord_org_id: null,
    broker_org_id: null,
  },
  landlord: {
    party_id: '00000000-0000-4000-8000-000000000002',
    session_id: 'sess-landlord',
    roles: [{ role: 'landlord', org_id: '00000000-0000-4000-8000-0000000000aa' }],
    landlord_org_id: '00000000-0000-4000-8000-0000000000aa',
    broker_org_id: null,
  },
  broker: {
    party_id: '00000000-0000-4000-8000-000000000003',
    session_id: 'sess-broker',
    roles: [{ role: 'broker_admin', org_id: '00000000-0000-4000-8000-0000000000bb' }],
    landlord_org_id: null,
    broker_org_id: '00000000-0000-4000-8000-0000000000bb',
  },
};

async function shot(name, me, path = '/#/') {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route('**/v1/auth/me', async (route) => {
    if (!me) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'auth_required' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(me),
    });
  });
  // Avoid unrelated API noise
  await page.route('**/v1/broker/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        broker_org_id: me?.broker_org_id,
        balance_cents: 0,
        broker_payouts_enabled: false,
        funding: { available: false, reason: 'bor_required' },
        lead_purchase: { available: false, reason: 'bor_required' },
        payouts: { available: false, reason: 'broker_payouts_disabled' },
        connect: { status: 'not_started', account_id: null },
      }),
    });
  });
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const nav = page.locator('header.topnav');
  await nav.screenshot({ path: join(OUT, name) });
  await browser.close();
}

mkdirSync(OUT, { recursive: true });

await shot('m1-nav-anonymous.png', fixtures.anon, '/#/');
await shot('m1-nav-renter.png', fixtures.renter, '/#/listings');
await shot('m1-nav-landlord.png', fixtures.landlord, '/#/');
await shot('m1-nav-broker.png', fixtures.broker, '/#/');

// QF-1 broker portal dark shell
{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.route('**/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixtures.broker),
    });
  });
  await page.route('**/v1/broker/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        broker_org_id: fixtures.broker.broker_org_id,
        balance_cents: 12500,
        broker_payouts_enabled: false,
        funding: { available: false, reason: 'bor_required' },
        lead_purchase: { available: false, reason: 'bor_required' },
        payouts: { available: false, reason: 'broker_payouts_disabled' },
        connect: { status: 'not_started', account_id: null },
      }),
    });
  });
  await page.goto(`${BASE}/#/broker`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(OUT, 'qf1-broker-shell.png'), fullPage: true });
  await browser.close();
}

// M-2 marketing banner
{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('**/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'auth_required' }),
    });
  });
  await page.goto(`${BASE}/#/landlords`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'm2-landlords-banner.png') });
  await page.goto(`${BASE}/#/brokers`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'm2-brokers-banner.png') });
  await browser.close();
}

// M-4 branded loading — local HTML of the CSS class
{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  await page.setContent(`<!doctype html><html><head>
    <link rel="stylesheet" href="${BASE}/assets/index-B2QE5kkF.css" />
    <style>
      body{margin:0;font-family:system-ui;background:#f0f7f4}
      .branded-loading{text-align:center;padding:4rem 1rem;max-width:28rem;margin:0 auto}
      .branded-loading-orb{width:3.5rem;height:3.5rem;margin:0 auto 1.25rem;border-radius:50%;
        background:radial-gradient(circle at 30% 30%,hsl(158 94% 64%),hsl(177 42% 48%));
        animation:hop-pulse 1.1s ease-in-out infinite}
      @keyframes hop-pulse{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-.55rem) scale(1.05)}}
      .section-eyebrow{font-size:10px;letter-spacing:.18em;text-transform:uppercase}
    </style></head><body>
    <div class="branded-loading"><div class="branded-loading-orb"></div>
    <p class="section-eyebrow">dwel.20</p><h1>Hopping to the next home</h1>
    <p>Saving your application…</p></div></body></html>`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'm4-branded-loading.png') });
  await browser.close();
}

console.log('wrote screenshots to', OUT);
