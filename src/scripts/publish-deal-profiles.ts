/**
 * Publish reconciled external deal properties as inquiry-only property profiles.
 *
 * - Uses the 588 distinct deal IDs from Deal_Listings_510 + deals_with_email.
 * - Publishes factual name/address/coordinates/property type only.
 * - Does NOT publish Rent.com photo URLs (pending_rights_review) or scraped specials as current.
 * - Does NOT leak owner_email.
 * - Does NOT mark vacancy or reusable Dwel application acceptance.
 *
 *   PACKAGE_ROOT=./tmp-listing-packages npx tsx src/scripts/publish-deal-profiles.ts
 *   DRY_RUN=1 PACKAGE_ROOT=... npx tsx src/scripts/publish-deal-profiles.ts
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { resolveDatabaseUrl } from '../db/database-url.js';
import { loadRdsSslConfig } from '../db/rds-ssl.js';

const { Client } = pg;

type DealRow = {
  external_id?: string;
  source?: string;
  source_url?: string;
  property_name?: string;
  property_type?: string;
  property_website?: string | null;
  leasing_phone?: string | null;
  owner_email?: string | null;
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
  photos?: unknown[];
  special_text?: string | null;
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

function profileDescription(row: DealRow): string {
  const name = row.property_name?.trim() || 'This community';
  return `${name} is listed on Dwel. Request information to connect with the leasing office. Move-in specials are advertised by the property; restrictions may apply.`;
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
      const prevPhotos = Array.isArray(prev.photos) ? prev.photos.length : 0;
      const nextPhotos = Array.isArray(row.photos) ? row.photos.length : 0;
      if (nextPhotos > prevPhotos) map.set(id, row);
    }
  }
  return [...map.values()];
}

async function main(): Promise<void> {
  const packageRoot = process.env.PACKAGE_ROOT?.trim();
  if (!packageRoot) throw new Error('PACKAGE_ROOT is required');
  const limit = Number(process.env.PUBLISH_LIMIT ?? '0') || 0;
  const dryRun = process.env.DRY_RUN === '1';

  const authoritative = await loadAuthoritativeDeals(packageRoot);
  const eligible = authoritative.filter((row) => {
    if (!row.external_id || !row.property_name?.trim()) return false;
    if (!row.address?.street || !row.address.city || !row.address.state) return false;
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return false;
    return true;
  });
  const toPublish = limit > 0 ? eligible.slice(0, limit) : eligible;

  const photoRefs = toPublish.reduce(
    (sum, row) => sum + (Array.isArray(row.photos) ? row.photos.length : 0),
    0,
  );

  const summary = {
    distinctDealIds: authoritative.length,
    eligibleProfiles: eligible.length,
    attempted: toPublish.length,
    inserted: 0,
    skippedExisting: 0,
    photoRefsSeen: photoRefs,
    photosPublished: 0,
    photosBlockedPendingRights: photoRefs,
    specialsSuppressed: toPublish.filter((r) => Boolean(r.special_text?.trim())).length,
    ownerEmailsSuppressed: toPublish.filter((r) => Boolean(r.owner_email?.trim())).length,
    dryRun,
    blockedReason:
      'Rent.com image URLs and scraped specials are not published until a display/rehost grant and freshness check are recorded.',
  };

  if (dryRun) {
    console.log(JSON.stringify({ ...summary, sample: toPublish.slice(0, 3).map((r) => r.external_id) }, null, 2));
    return;
  }

  const client = new Client({
    connectionString: resolveDatabaseUrl(),
    ssl: resolveSsl(),
  });
  await client.connect();
  try {
    await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);

    const org = await client.query<{ id: string }>(
      `select id from org order by created_at asc nulls last limit 1`,
    );
    const orgId = org.rows[0]?.id;
    if (!orgId) throw new Error('no org found for deal profile publish');

    for (const row of toPublish) {
      const externalId = row.external_id!;
      const line1 = row.address!.street!.trim();
      const city = row.address!.city!.trim();
      const state = row.address!.state!.trim().slice(0, 2).toUpperCase();
      const postal = String(row.address!.zip ?? '').trim();
      const raw = row.address!.full?.trim() || `${line1}, ${city}, ${state} ${postal}`.trim();
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      const beds = row.bed_min != null ? Number(row.bed_min) : null;
      const baths = row.bath_min != null ? Number(row.bath_min) : null;
      const displayName = row.property_name!.trim();
      const propertyType = normalizeType(row.property_type);
      const normalizedHash = hashKey(['deal-profile', externalId, line1, city, state, postal]);

      const existing = await client.query<{ id: string }>(
        `select l.id
         from listing l
         join unit u on u.id = l.unit_id
         join property p on p.id = u.property_id
         join address a on a.id = p.address_id
         where a.normalized_hash = $1
            or (p.display_name = $2 and a.line1 = $3 and a.city = $4 and a.state = $5 and coalesce(l.inventory_kind,'partner') = 'external')
         limit 1`,
        [normalizedHash, displayName, line1, city, state],
      );
      if (existing.rows[0]) {
        summary.skippedExisting += 1;
        continue;
      }

      await client.query('begin');
      try {
        const addr = await client.query<{ id: string }>(
          `insert into address (
             raw_input, line1, city, state, postal_code, normalized_hash,
             normalizer_vendor, normalizer_version, is_dpv_confirmed,
             geocode_precision, geom
           ) values (
             $1,$2,$3,$4,$5,$6,
             'deal_package_profile','1', false,
             'centroid',
             ST_SetSRID(ST_MakePoint($7::float8, $8::float8), 4326)::geography
           )
           on conflict (normalized_hash) do update set
             geom = excluded.geom,
             geocode_precision = excluded.geocode_precision,
             line1 = excluded.line1,
             city = excluded.city,
             state = excluded.state,
             postal_code = excluded.postal_code
           returning id`,
          [raw, line1, city, state, postal || null, normalizedHash, lng, lat],
        );
        const addressId = addr.rows[0]!.id;

        const prop = await client.query<{ id: string }>(
          `insert into property (address_id, property_type, display_name)
           values ($1, $2, $3)
           on conflict (address_id) do update set
             display_name = excluded.display_name,
             property_type = excluded.property_type
           returning id`,
          [addressId, propertyType, displayName],
        );
        const propertyId = prop.rows[0]!.id;

        const unit = await client.query<{ id: string }>(
          `insert into unit (
             property_id, unit_label_raw, unit_label_normalized, bedrooms, bathrooms
           ) values ($1, 'profile', 'profile', $2, $3)
           on conflict (property_id, unit_label_normalized) do update
             set bedrooms = coalesce(excluded.bedrooms, unit.bedrooms),
                 bathrooms = coalesce(excluded.bathrooms, unit.bathrooms)
           returning id`,
          [propertyId, beds, baths],
        );
        const unitId = unit.rows[0]!.id;

        const listing = await client.query<{ id: string }>(
          `insert into listing (
             org_id, unit_id, origin,
             rent_amount_cents, status, published_at, last_confirmed_at,
             is_demo, inventory_kind, reusable_application_eligible,
             public_description
           ) values (
             $1, $2, 'ingested',
             0, 'active', now(), now(),
             false, 'external', false,
             $3
           )
           returning id`,
          [orgId, unitId, profileDescription(row)],
        );
        const listingId = listing.rows[0]!.id;

        const photos = Array.isArray(row.photos) ? row.photos : [];
        for (const photo of photos) {
          const originUrl =
            typeof photo === 'string'
              ? photo
              : photo && typeof photo === 'object' && 'url' in photo
                ? String((photo as { url?: string }).url ?? '')
                : '';
          if (!originUrl) continue;
          let host: string | null = null;
          try {
            host = new URL(originUrl).host;
          } catch {
            host = null;
          }
          await client.query(
            `insert into listing_media_provenance (
               listing_id, origin_url, origin_host, permission_basis, permission_note, publishable
             ) values ($1,$2,$3,'pending_rights_review',$4,false)`,
            [
              listingId,
              originUrl,
              host,
              'Package image URL retained for rights review; not published to public media.',
            ],
          );
        }

        await client.query('commit');
        summary.inserted += 1;
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
