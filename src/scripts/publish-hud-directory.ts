/**
 * Publish HUD open-data properties as inquiry-only directory inventory.
 *
 * Rights basis: HUD Multifamily Assisted open data
 * (hudgis-hud.opendata.arcgis.com). Publishes factual name/address/coordinates
 * with original Dwel presentation. No Rent.com photos/specials, no owner emails,
 * no confirmed-vacancy claim.
 *
 * Requires migrations 0077 + 0079.
 *   PACKAGE_ROOT=./tmp-listing-packages npx tsx src/scripts/publish-hud-directory.ts
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { resolveDatabaseUrl } from '../db/database-url.js';
import { loadRdsSslConfig } from '../db/rds-ssl.js';

const { Client } = pg;

type HudRow = {
  external_id?: string;
  source?: string;
  source_url?: string;
  property_name?: string;
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
  hud_program?: string | null;
  total_units?: number | null;
  assisted_units?: number | null;
};

function isHudOpenData(row: HudRow): boolean {
  const source = String(row.source ?? '');
  const url = String(row.source_url ?? '');
  return (
    /HUD Multifamily Assisted/i.test(source) ||
    /hudgis-hud\.opendata\.arcgis\.com/i.test(url)
  );
}

function hashKey(parts: string[]): string {
  return createHash('sha256').update(parts.join('|').toLowerCase()).digest('hex').slice(0, 40);
}

function neutralDescription(row: HudRow): string {
  const name = row.property_name?.trim() || 'This property';
  const program = row.hud_program?.trim();
  const assisted = row.assisted_units;
  const total = row.total_units;
  const bits = [
    `${name} appears in the HUD Multifamily Assisted Properties open dataset.`,
    program ? `Listed HUD program: ${program}.` : null,
    assisted != null && total != null
      ? `Dataset reports ${assisted} assisted unit(s) of ${total} total.`
      : null,
    'This is an inquiry-only directory entry. Availability, eligibility, and rent are not confirmed on Dwel.',
    'Contact the property manager directly to verify openings and requirements.',
    'Source: HUD Multifamily Assisted Properties open data.',
  ];
  return bits.filter(Boolean).join(' ');
}

function resolveSsl(): pg.ClientConfig['ssl'] | undefined {
  const caPath = process.env.RDS_CA_BUNDLE_PATH ?? '/certs/rds-global-bundle.pem';
  try {
    return loadRdsSslConfig(caPath);
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const packageRoot = process.env.PACKAGE_ROOT?.trim();
  if (!packageRoot) throw new Error('PACKAGE_ROOT is required');
  const limit = Number(process.env.PUBLISH_LIMIT ?? '0') || 0;
  const dryRun = process.env.DRY_RUN === '1';

  const file = path.join(packageRoot, 'Dwel_HUD_500_Listings', 'dwel_hud_listings.json');
  const rows = JSON.parse(await readFile(file, 'utf8')) as HudRow[];
  if (!Array.isArray(rows)) throw new Error('HUD listings file is not an array');

  const eligible = rows.filter((row) => {
    if (!isHudOpenData(row)) return false;
    if (!row.external_id || !row.property_name?.trim()) return false;
    if (!row.address?.street || !row.address.city || !row.address.state) return false;
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return false;
    return true;
  });
  const toPublish = limit > 0 ? eligible.slice(0, limit) : eligible;

  const summary = {
    sourceRows: rows.length,
    eligibleOpenData: eligible.length,
    attempted: toPublish.length,
    inserted: 0,
    skippedExisting: 0,
    dryRun,
  };

  if (dryRun) {
    console.log(
      JSON.stringify(
        { ...summary, sample: toPublish.slice(0, 3).map((r) => r.external_id) },
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

    const org = await client.query<{ id: string }>(
      `select id from org order by created_at asc nulls last limit 1`,
    );
    const orgId = org.rows[0]?.id;
    if (!orgId) throw new Error('no org found for directory publish');

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
      const displayName = row.property_name!.trim();
      const normalizedHash = hashKey(['hud-dir', externalId, line1, city, state, postal]);

      const existing = await client.query<{ id: string }>(
        `select l.id
         from listing l
         join unit u on u.id = l.unit_id
         join property p on p.id = u.property_id
         join address a on a.id = p.address_id
         where a.normalized_hash = $1
            or (p.display_name = $2 and a.line1 = $3 and a.city = $4 and a.state = $5)
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
             'hud_open_data_package','1', false,
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
           values ($1, 'multifamily', $2)
           on conflict (address_id) do update set display_name = excluded.display_name
           returning id`,
          [addressId, displayName],
        );
        const propertyId = prop.rows[0]!.id;

        const unit = await client.query<{ id: string }>(
          `insert into unit (
             property_id, unit_label_raw, unit_label_normalized, bedrooms, bathrooms
           ) values ($1, 'directory', 'directory', $2, null)
           on conflict (property_id, unit_label_normalized) do update
             set bedrooms = coalesce(excluded.bedrooms, unit.bedrooms)
           returning id`,
          [propertyId, beds],
        );
        const unitId = unit.rows[0]!.id;

        await client.query(
          `insert into listing (
             org_id, unit_id, origin,
             rent_amount_cents, status, published_at, last_confirmed_at,
             is_demo, inventory_kind, reusable_application_eligible,
             public_description
           ) values (
             $1, $2, 'ingested',
             0, 'active', now(), now(),
             false, 'directory', false,
             $3
           )`,
          [orgId, unitId, neutralDescription(row)],
        );

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
