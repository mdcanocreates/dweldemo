/**
 * Refresh published external deal listings with source rent, unit facts,
 * property-advertised specials, and renter-safe descriptions.
 *
 * Photos remain pending_rights_review — this script does not publish media.
 *
 *   PACKAGE_ROOT=./tmp-listing-packages npx tsx src/scripts/refresh-deal-marketplace.ts
 *   DRY_RUN=1 PACKAGE_ROOT=... npx tsx src/scripts/refresh-deal-marketplace.ts
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { resolveDatabaseUrl } from '../db/database-url.js';
import { loadRdsSslConfig } from '../db/rds-ssl.js';
import { buildPropertyOffer } from '../modules/external-listings/offer-headline.js';

const { Client } = pg;

type DealRow = {
  external_id?: string;
  source_url?: string | null;
  property_name?: string;
  property_type?: string;
  property_website?: string | null;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    full?: string;
  };
  lat?: number;
  lng?: number;
  bed_min?: number | null;
  bath_min?: number | null;
  beds_text?: string | null;
  baths_text?: string | null;
  sqft_text?: string | null;
  rent_min?: number | null;
  rent_max?: number | null;
  special_text?: string | null;
  special_tags?: string[];
  amenities?: string[] | null;
  units_available_text?: string | null;
};

function hashKey(parts: string[]): string {
  return createHash('sha256').update(parts.join('|').toLowerCase()).digest('hex').slice(0, 40);
}

function normalizeType(raw: string | null | undefined): string {
  const value = String(raw ?? 'multifamily').toLowerCase();
  if (value.includes('single')) return 'single_family';
  if (value.includes('condo')) return 'condo';
  if (value.includes('town')) return 'townhome';
  return 'multifamily';
}

function dollarsToCents(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  if (n <= 0) return null;
  return Math.round(n * 100);
}

function parseSqft(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = String(text).replace(/,/g, '').match(/(\d{2,5})/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function marketplaceDescription(row: DealRow): string {
  const name = row.property_name?.trim() || 'This community';
  const bits: string[] = [];
  const beds = row.beds_text?.trim();
  const baths = row.baths_text?.trim();
  const sqft = row.sqft_text?.trim();
  const units = row.units_available_text?.trim();
  const layout = [beds, baths, sqft].filter(Boolean).join(' · ');
  if (layout) bits.push(`${name} offers ${layout}.`);
  else bits.push(`${name} is available to browse on Dwel.`);
  if (units) bits.push(units.endsWith('.') ? units : `${units}.`);
  const amenities = Array.isArray(row.amenities)
    ? row.amenities.map((a) => String(a).trim()).filter(Boolean).slice(0, 8)
    : [];
  if (amenities.length) bits.push(`Amenities include ${amenities.join(', ')}.`);
  const site = row.property_website?.trim();
  if (site && !/rent\.com/i.test(site)) {
    bits.push(`Learn more on the property website.`);
  }
  bits.push('Move-in specials are advertised by the property; restrictions may apply.');
  return bits.join(' ');
}

function resolveSsl(): pg.ClientConfig['ssl'] | undefined {
  const caPath = process.env.RDS_CA_BUNDLE_PATH ?? '/certs/rds-global-bundle.pem';
  try {
    return loadRdsSslConfig(caPath);
  } catch {
    return undefined;
  }
}

async function loadAuthoritativeDeals(packageRoot: string): Promise<DealRow[]> {
  const files = [
    path.join(packageRoot, 'Dwel_Deal_Listings_510', 'dwel_deal_listings.json'),
    path.join(packageRoot, 'Dwel_Listings_With_Emails_643', 'dwel_deals_with_email.json'),
  ];
  const map = new Map<string, DealRow>();
  for (const file of files) {
    const rows = JSON.parse(await readFile(file, 'utf8')) as DealRow[];
    if (!Array.isArray(rows)) throw new Error(`${file} is not an array`);
    for (const row of rows) {
      const id = row.external_id?.trim();
      if (!id) continue;
      const prev = map.get(id);
      if (!prev) {
        map.set(id, row);
        continue;
      }
      const score = (r: DealRow) =>
        (r.rent_min != null ? 2 : 0) +
        (r.special_text ? 2 : 0) +
        (Array.isArray(r.amenities) ? 1 : 0);
      if (score(row) >= score(prev)) map.set(id, { ...prev, ...row });
    }
  }
  return [...map.values()];
}

async function main(): Promise<void> {
  const packageRoot = process.env.PACKAGE_ROOT?.trim();
  if (!packageRoot) throw new Error('PACKAGE_ROOT is required');
  const dryRun = process.env.DRY_RUN === '1';
  const limit = Number(process.env.REFRESH_LIMIT ?? '0') || 0;

  const deals = await loadAuthoritativeDeals(packageRoot);
  const eligible = deals.filter(
    (row) =>
      row.external_id &&
      row.property_name?.trim() &&
      row.address?.street &&
      row.address.city &&
      row.address.state,
  );
  const toRefresh = limit > 0 ? eligible.slice(0, limit) : eligible;

  const summary = {
    sourceRecords: deals.length,
    attempted: toRefresh.length,
    matched: 0,
    updated: 0,
    missingListing: 0,
    withRent: 0,
    withoutRent: 0,
    specialsWritten: 0,
    photosStillBlocked: toRefresh.reduce(
      (n, row) => n + (Array.isArray((row as { photos?: unknown[] }).photos) ? (row as { photos: unknown[] }).photos.length : 0),
      0,
    ),
    dryRun,
  };

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          ...summary,
          sample: toRefresh.slice(0, 3).map((r) => ({
            id: r.external_id,
            rent_min: r.rent_min,
            rent_max: r.rent_max,
            special: buildPropertyOffer({
              specialText: r.special_text,
              specialTags: r.special_tags,
              sourceUrl: r.source_url,
            })?.displayText,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const client = new Client({
    connectionString: resolveDatabaseUrl(),
    ssl: resolveSsl(),
  });
  await client.connect();
  try {
    await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);

    for (const row of toRefresh) {
      const externalId = row.external_id!;
      const line1 = row.address!.street!.trim();
      const city = row.address!.city!.trim();
      const state = row.address!.state!.trim().slice(0, 2).toUpperCase();
      const postal = String(row.address!.zip ?? '').trim();
      const displayName = row.property_name!.trim();
      const normalizedHash = hashKey(['deal-profile', externalId, line1, city, state, postal]);
      const rentMin = dollarsToCents(row.rent_min);
      const rentMaxRaw = dollarsToCents(row.rent_max);
      const rentMax =
        rentMin != null && rentMaxRaw != null && rentMaxRaw > rentMin ? rentMaxRaw : null;
      const beds = row.bed_min != null && Number.isFinite(Number(row.bed_min)) ? Number(row.bed_min) : null;
      const baths =
        row.bath_min != null && Number.isFinite(Number(row.bath_min)) ? Number(row.bath_min) : null;
      const sqft = parseSqft(row.sqft_text);
      const propertyType = normalizeType(row.property_type);
      const description = marketplaceDescription(row);
      const offer = buildPropertyOffer({
        specialText: row.special_text,
        specialTags: row.special_tags,
        sourceUrl: row.source_url,
      });

      const found = await client.query<{ id: string; org_id: string; unit_id: string }>(
        `select l.id, l.org_id, l.unit_id
         from listing l
         join unit u on u.id = l.unit_id
         join property p on p.id = u.property_id
         join address a on a.id = p.address_id
         where coalesce(l.inventory_kind, 'partner') = 'external'
           and (
             a.normalized_hash = $1
             or (p.display_name = $2 and a.line1 = $3 and a.city = $4 and a.state = $5)
           )
         limit 1`,
        [normalizedHash, displayName, line1, city, state],
      );
      const listing = found.rows[0];
      if (!listing) {
        summary.missingListing += 1;
        continue;
      }
      summary.matched += 1;
      if (rentMin != null) summary.withRent += 1;
      else summary.withoutRent += 1;

      await client.query('begin');
      try {
        await client.query(
          `update property
           set display_name = $2, property_type = $3
           where id = (select property_id from unit where id = $1)`,
          [listing.unit_id, displayName, propertyType],
        );
        await client.query(
          `update unit
           set bedrooms = coalesce($2, bedrooms),
               bathrooms = coalesce($3, bathrooms),
               sqft = coalesce($4, sqft)
           where id = $1`,
          [listing.unit_id, beds, baths, sqft],
        );
        await client.query(
          `update listing
           set rent_amount_cents = coalesce($2, nullif(rent_amount_cents, 0)),
               rent_max_cents = $3,
               public_description = $4,
               last_confirmed_at = now(),
               reusable_application_eligible = false
           where id = $1`,
          [listing.id, rentMin, rentMax, description],
        );

        // Replace prior property-advertised specials for this listing (not Dwel cashback).
        await client.query(
          `delete from listing_offer
           where listing_id = $1
             and offer_type in ('weeks_free','months_free','dollar_credit','fee_waiver','other')`,
          [listing.id],
        );
        if (offer) {
          await client.query(
            `insert into listing_offer (
               listing_id, org_id, display_text, offer_type, qualifier_text,
               source_reference, attribution_text, validated_at, offer_status
             ) values (
               $1, $2, $3, $4, $5,
               $6, $7, now(), 'verified'
             )`,
            [
              listing.id,
              listing.org_id,
              offer.displayText,
              offer.offerType,
              offer.qualifierText,
              offer.sourceReference,
              'Offer advertised by property; terms apply.',
            ],
          );
          summary.specialsWritten += 1;
        }

        await client.query('commit');
        summary.updated += 1;
      } catch (err) {
        await client.query('rollback');
        throw err;
      }
    }
  } finally {
    await client.end();
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
