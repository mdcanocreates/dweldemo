/**
 * Incognito-style check: /apply is fillable with no session (L-1 auth ordering).
 */
import { chromium } from 'playwright';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

const BASE = process.env.DWEL_BASE_URL ?? 'https://d1j0s2h5mond9a.cloudfront.net';
const OUT = join(process.cwd(), 'evidence', 'part-phase6');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await page.route('**/v1/auth/me', async (route) => {
  await route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'auth_required' }),
  });
});
await page.route('**/v1/listings/**', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      listing: {
        id: '00000000-0000-4000-8000-000000000099',
        rent_amount_cents: 200000,
        deposit_cents: null,
        bedrooms: 2,
        bathrooms: 1,
        sqft: null,
        available_on: null,
        lease_term_months: null,
        description: null,
        address: { line1: '1 Test', city: 'Columbus', state: 'OH', postal_code: '43215', line2: null, raw_input: null },
      },
    }),
  });
});

const listingId = '00000000-0000-4000-8000-000000000099';
await page.goto(`${BASE}/#/apply/${listingId}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const title = await page.locator('h1').first().textContent();
const street = page.locator('#line1');
await street.fill('123 Anonymous Ave');
const gated = await page.locator('text=Sign in').count();
const privateLink = await page.locator('text=Private link').count();
await page.screenshot({ path: join(OUT, 'l1-anonymous-apply-fillable.png'), fullPage: true });
console.log(JSON.stringify({ title, streetFilled: true, signInLinksInFormArea: gated, privateLinkPanels: privateLink }));
await browser.close();
