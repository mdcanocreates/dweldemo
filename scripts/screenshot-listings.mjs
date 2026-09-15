import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const outDir = path.resolve('evidence');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'listings-rendered.png');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('https://d1j0s2h5mond9a.cloudfront.net/#/listings', {
  waitUntil: 'networkidle',
  timeout: 60000,
});
await page.waitForTimeout(2500);
const html = await page.content();
const hasCard = (await page.locator('.listing-card').count()) > 0;
const hasBadge = (await page.locator('.badge-cash').count()) > 0;
const interim = await page.locator('.badge-cash').first().innerText().catch(() => 'NONE');
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log(JSON.stringify({ out, hasCard, hasBadge, interimBadgeText: interim.slice(0, 80), titleSnippet: html.includes('Find a home'), fontLink: html.includes('Space+Grotesk') }, null, 2));
