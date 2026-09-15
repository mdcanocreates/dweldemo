/**
 * DEV-only bootstrap for Phase 1 public API config + one sample listing.
 *
 * - Does NOT invent legal disclosure copy — only a non-legal sandbox version id.
 * - Disclosure remains fail-closed if this seed is absent.
 * - Idempotent: safe to re-run.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { resolveDatabaseUrl } from './database-url.js';
import { loadRdsSslConfig } from './rds-ssl.js';

const { Client } = pg;

const SEED_PARTY_ID = '00000000-0000-4000-8000-000000000048';
const SEED_ORG_ID = '00000000-0000-4000-8000-000000000049';
const SEED_LISTING_ID = '00000000-0000-4000-8000-00000000004a';
const SEED_ADDRESS_ID = '00000000-0000-4000-8000-00000000004b';
const SEED_PROPERTY_ID = '00000000-0000-4000-8000-00000000004c';
const SEED_UNIT_ID = '00000000-0000-4000-8000-00000000004d';

function resolveSsl(): pg.ClientConfig['ssl'] | undefined {
  const caPath = process.env.RDS_CA_BUNDLE_PATH ?? '/certs/rds-global-bundle.pem';
  try {
    return loadRdsSslConfig(caPath);
  } catch {
    return undefined;
  }
}

async function upsertApprovedConfig(
  client: pg.Client,
  input: {
    namespace: string;
    version: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `insert into config_version (
       id, namespace, version, payload, effective_from,
       proposed_by_party_id, approved_by_party_id, approved_at
     ) values ($1,$2,$3,$4::jsonb, '2020-01-01T00:00:00Z'::timestamptz, $5, $5, now())
     on conflict (namespace, version) do update
       set payload = excluded.payload,
           effective_from = excluded.effective_from,
           approved_by_party_id = excluded.approved_by_party_id,
           approved_at = excluded.approved_at`,
    [
      randomUUID(),
      input.namespace,
      input.version,
      JSON.stringify(input.payload),
      SEED_PARTY_ID,
    ],
  );
}

export async function seedDevPhase1(connectionString: string): Promise<{
  configs: string[];
  listingId: string;
}> {
  const client = new Client({ connectionString, ssl: resolveSsl() });
  await client.connect();
  try {
    await client.query('begin');

    await client.query(
      `insert into party (id, kind) values ($1, 'organization') on conflict (id) do nothing`,
      [SEED_PARTY_ID],
    );

    // Non-legal sandbox disclosure version id — not FCRA/legal copy.
    await upsertApprovedConfig(client, {
      namespace: 'screening_disclosure',
      version: 'dev-sandbox-v1',
      payload: {
        disclosure_version: 'dev-sandbox-nonlegal-v1',
        note: 'DEV sandbox placeholder — replace with counsel-approved disclosure before any legal use',
      },
    });

    await upsertApprovedConfig(client, {
      namespace: 'application_access',
      version: 'dev-sandbox-v1',
      payload: {
        token_ttl_ms: 7 * 24 * 60 * 60 * 1000,
      },
    });

    await upsertApprovedConfig(client, {
      namespace: 'scraping_policy',
      version: 'dev-sandbox-v1',
      payload: {
        allow_indexed_crawlers: true,
        allow_generic_automation: false,
        unauthenticated_burst_limit: 60,
        unauthenticated_window_ms: 60_000,
      },
    });

    // Minimal active listing for DEV E2E (idempotent fixed UUIDs).
    await client.query(
      `insert into org (id, kind, legal_name, display_name, created_at)
       values ($1, 'landlord', 'DEV Sandbox Landlord', 'DEV Sandbox LL', now())
       on conflict (id) do nothing`,
      [SEED_ORG_ID],
    );

    await client.query(
      `insert into address (
         id, raw_input, line1, city, state, postal_code, normalized_hash,
         normalizer_vendor, normalizer_version
       ) values (
         $1, '100 Dev Sandbox Ave', '100 Dev Sandbox Ave', 'Columbus', 'OH', '43215',
         'dev-sandbox-address-v1', 'dev_seed', '1'
       ) on conflict (id) do nothing`,
      [SEED_ADDRESS_ID],
    );

    await client.query(
      `insert into property (id, address_id, property_type)
       values ($1, $2, 'multifamily')
       on conflict (id) do nothing`,
      [SEED_PROPERTY_ID, SEED_ADDRESS_ID],
    );

    await client.query(
      `insert into unit (id, property_id, unit_label_raw, unit_label_normalized, bedrooms, bathrooms, sqft)
       values ($1, $2, '1A', '1a', 2, 1, 900)
       on conflict (id) do nothing`,
      [SEED_UNIT_ID, SEED_PROPERTY_ID],
    );

    await client.query(
      `insert into listing (
         id, org_id, unit_id, origin, rent_amount_cents, deposit_cents,
         status, published_at, last_confirmed_at
       ) values (
         $1, $2, $3, 'manual', 180000, 180000,
         'active', now(), now()
       ) on conflict (id) do update
         set status = 'active',
             published_at = coalesce(listing.published_at, now()),
             last_confirmed_at = now()`,
      [SEED_LISTING_ID, SEED_ORG_ID, SEED_UNIT_ID],
    );

    await client.query('commit');
    return {
      configs: ['screening_disclosure', 'application_access', 'scraping_policy'],
      listingId: SEED_LISTING_ID,
    };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const result = await seedDevPhase1(resolveDatabaseUrl());
  console.log(JSON.stringify({ seeded: result }, null, 2));
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
