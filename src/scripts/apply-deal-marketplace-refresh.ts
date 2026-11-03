/**
 * Apply a prebuilt deal marketplace refresh payload (JSON array).
 *
 *   REFRESH_JSON_PATH=./tmp-ops/deal-marketplace-refresh.json npx tsx src/scripts/apply-deal-marketplace-refresh.ts
 *   REFRESH_JSON_URL=https://... npx tsx src/scripts/apply-deal-marketplace-refresh.ts
 */
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { resolveDatabaseUrl } from '../db/database-url.js';
import { loadRdsSslConfig } from '../db/rds-ssl.js';

const { Client } = pg;

type PayloadRow = {
  external_id: string;
  normalized_hash: string;
  display_name: string;
  line1: string;
  city: string;
  state: string;
  property_type: string;
  bed_min: number | null;
  bath_min: number | null;
  sqft: number | null;
  rent_min_cents: number | null;
  rent_max_cents: number | null;
  description: string;
  offer: {
    display_text: string;
    offer_type: string;
    qualifier_text: string;
    source_reference: string | null;
  } | null;
};

function resolveSsl(): pg.ClientConfig['ssl'] | undefined {
  const caPath = process.env.RDS_CA_BUNDLE_PATH ?? '/certs/rds-global-bundle.pem';
  try {
    return loadRdsSslConfig(caPath);
  } catch {
    return undefined;
  }
}

async function loadPayload(): Promise<PayloadRow[]> {
  const url = process.env.REFRESH_JSON_URL?.trim();
  if (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch refresh payload: ${res.status}`);
    return (await res.json()) as PayloadRow[];
  }
  const filePath = process.env.REFRESH_JSON_PATH?.trim();
  if (!filePath) throw new Error('REFRESH_JSON_PATH or REFRESH_JSON_URL is required');
  return JSON.parse(await readFile(filePath, 'utf8')) as PayloadRow[];
}

async function main(): Promise<void> {
  const rows = await loadPayload();
  const summary = {
    attempted: rows.length,
    matched: 0,
    updated: 0,
    missing: 0,
    withRent: 0,
    specialsWritten: 0,
  };

  const client = new Client({
    connectionString: resolveDatabaseUrl(),
    ssl: resolveSsl(),
  });
  await client.connect();
  try {
    await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
    for (const row of rows) {
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
        [row.normalized_hash, row.display_name, row.line1, row.city, row.state],
      );
      const listing = found.rows[0];
      if (!listing) {
        summary.missing += 1;
        continue;
      }
      summary.matched += 1;
      if (row.rent_min_cents != null) summary.withRent += 1;

      await client.query('begin');
      try {
        await client.query(
          `update property
           set display_name = $2, property_type = $3
           where id = (select property_id from unit where id = $1)`,
          [listing.unit_id, row.display_name, row.property_type],
        );
        await client.query(
          `update unit
           set bedrooms = coalesce($2, bedrooms),
               bathrooms = coalesce($3, bathrooms),
               sqft = coalesce($4, sqft)
           where id = $1`,
          [listing.unit_id, row.bed_min, row.bath_min, row.sqft],
        );
        await client.query(
          `update listing
           set rent_amount_cents = coalesce($2, nullif(rent_amount_cents, 0)),
               rent_max_cents = $3,
               public_description = $4,
               last_confirmed_at = now(),
               reusable_application_eligible = false
           where id = $1`,
          [listing.id, row.rent_min_cents, row.rent_max_cents, row.description],
        );
        await client.query(
          `delete from listing_offer
           where listing_id = $1
             and offer_type in ('weeks_free','months_free','dollar_credit','fee_waiver','other')`,
          [listing.id],
        );
        if (row.offer) {
          await client.query(
            `insert into listing_offer (
               listing_id, org_id, display_text, offer_type, qualifier_text,
               source_reference, attribution_text, validated_at, offer_status
             ) values ($1,$2,$3,$4,$5,$6,$7,now(),'verified')`,
            [
              listing.id,
              listing.org_id,
              row.offer.display_text,
              row.offer.offer_type,
              row.offer.qualifier_text,
              row.offer.source_reference,
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
