/**
 * Prod-safe internal preview seed (upsert-only).
 *
 * Creates ONLY known Fake Oaks / Fake Horizon / preview-renter records needed for
 * DWEL_INTERNAL_PREVIEW. Never truncates, deletes, resets demo state, mutates
 * unrelated orgs/users, creates sessions, or calls Stripe/Certn/SES.
 *
 * Usage:
 *   npm run seed:preview-prod
 *   npm run seed:preview-prod -- --plan-only
 *
 * Uses DATABASE_URL / DB_* from env (same as migrate / API).
 */
import { createHash } from 'node:crypto';
import pg from 'pg';

import { resolveDatabaseUrl } from '../db/database-url.js';
import { loadRdsSslConfig } from '../db/rds-ssl.js';
import type { DbClient } from '../db/pool.js';
import { platformEmailHmac } from '../modules/auth/passwordless.js';
import { getKmsProvider } from '../infra/crypto/kms.js';
import { initializeAwsRuntime, shouldUseAwsInfra } from '../infra/runtime.js';
import {
  createPartyWithIdentity,
  grantRole,
} from '../modules/identity/index.js';
import {
  PREVIEW_BROKER_ORG_ID,
  PREVIEW_LANDLORD_ORG_ID,
  PREVIEW_RENTER_EMAIL,
} from '../http/preview-context.js';

const { Client } = pg;

/** pg.Client satisfies the query surface used by identity helpers at runtime. */
function asDb(client: pg.Client): DbClient {
  return client as unknown as DbClient;
}

const HP_ORG = {
  id: PREVIEW_LANDLORD_ORG_ID,
  legalName: 'Fake Oaks Properties LLC',
  displayName: 'Fake Oaks Properties',
  kind: 'landlord' as const,
};

const BROKER_ORG = {
  id: PREVIEW_BROKER_ORG_ID,
  legalName: 'Fake Horizon Realty LLC',
  displayName: 'Fake Horizon Realty',
  kind: 'brokerage' as const,
};

type ListingKey = string;

type ListingDef = {
  key: ListingKey;
  addressId: string;
  propertyId: string;
  unitId: string;
  listingId: string;
  city: string;
  state: 'TX';
  postal: string;
  line1: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  rentCents: number;
  depositCents: number;
  propertyType: string;
  petsAllowed: boolean;
  amenities: string[];
  media: string[];
};

const LISTINGS: ListingDef[] = [
  {
    key: 'austin',
    addressId: 'a1000000-0000-4000-8000-000000000101',
    propertyId: 'a1000000-0000-4000-8000-000000000111',
    unitId: 'a1000000-0000-4000-8000-000000000121',
    listingId: 'a1000000-0000-4000-8000-000000000131',
    city: 'Austin',
    state: 'TX',
    postal: '78701',
    line1: '1200 Fake Cedar Ln',
    bedrooms: 2,
    bathrooms: 2,
    sqft: 980,
    rentCents: 215000,
    depositCents: 215000,
    propertyType: 'apartment',
    petsAllowed: true,
    amenities: ['parking', 'laundry'],
    media: [
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80',
      'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80',
      'https://images.unsplash.com/photo-1560448204-e02f11c3be14?w=1200&q=80',
    ],
  },
  {
    key: 'houston',
    addressId: 'a1000000-0000-4000-8000-000000000102',
    propertyId: 'a1000000-0000-4000-8000-000000000112',
    unitId: 'a1000000-0000-4000-8000-000000000122',
    listingId: 'a1000000-0000-4000-8000-000000000132',
    city: 'Houston',
    state: 'TX',
    postal: '77002',
    line1: '800 Mock Bayou St',
    bedrooms: 1,
    bathrooms: 1,
    sqft: 720,
    rentCents: 165000,
    depositCents: 165000,
    propertyType: 'apartment',
    petsAllowed: false,
    amenities: ['gym'],
    media: [
      'https://images.unsplash.com/photo-1536376072261-38c75010e6c9?w=1200&q=80',
      'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1200&q=80',
      'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=1200&q=80',
    ],
  },
  {
    key: 'dallas',
    addressId: 'a1000000-0000-4000-8000-000000000103',
    propertyId: 'a1000000-0000-4000-8000-000000000113',
    unitId: 'a1000000-0000-4000-8000-000000000123',
    listingId: 'a1000000-0000-4000-8000-000000000133',
    city: 'Dallas',
    state: 'TX',
    postal: '75201',
    line1: '450 Phantom Prairie Ave',
    bedrooms: 3,
    bathrooms: 2.5,
    sqft: 1400,
    rentCents: 275000,
    depositCents: 275000,
    propertyType: 'townhome',
    petsAllowed: true,
    amenities: ['parking', 'yard'],
    media: [
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200&q=80',
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1200&q=80',
      'https://images.unsplash.com/photo-1460317442991-0ec209397118?w=1200&q=80',
    ],
  },
  {
    key: 'drury',
    addressId: 'a1000000-0000-4000-8000-000000000104',
    propertyId: 'a1000000-0000-4000-8000-000000000114',
    unitId: 'a1000000-0000-4000-8000-000000000144',
    listingId: 'a1000000-0000-4000-8000-000000000161',
    city: 'Austin',
    state: 'TX',
    postal: '78704',
    line1: '123 Drury Lane',
    bedrooms: 2,
    bathrooms: 1,
    sqft: 850,
    rentCents: 189000,
    depositCents: 189000,
    propertyType: 'house',
    petsAllowed: true,
    amenities: ['yard', 'parking'],
    media: [
      'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=80',
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=80',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80',
    ],
  },
  {
    key: 'fakedrive',
    addressId: 'a1000000-0000-4000-8000-000000000105',
    propertyId: 'a1000000-0000-4000-8000-000000000115',
    unitId: 'a1000000-0000-4000-8000-000000000145',
    listingId: 'a1000000-0000-4000-8000-000000000162',
    city: 'Houston',
    state: 'TX',
    postal: '77019',
    line1: '123 Fake Drive',
    bedrooms: 3,
    bathrooms: 2,
    sqft: 1250,
    rentCents: 229000,
    depositCents: 229000,
    propertyType: 'house',
    petsAllowed: true,
    amenities: ['parking', 'laundry'],
    media: [
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1200&q=80',
      'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=1200&q=80',
      'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=1200&q=80',
    ],
  },
  {
    key: 'pretend',
    addressId: 'a1000000-0000-4000-8000-000000000106',
    propertyId: 'a1000000-0000-4000-8000-000000000116',
    unitId: 'a1000000-0000-4000-8000-000000000146',
    listingId: 'a1000000-0000-4000-8000-000000000163',
    city: 'Dallas',
    state: 'TX',
    postal: '75204',
    line1: '77 Pretend Parkway',
    bedrooms: 1,
    bathrooms: 1,
    sqft: 640,
    rentCents: 145000,
    depositCents: 145000,
    propertyType: 'apartment',
    petsAllowed: false,
    amenities: ['gym', 'laundry'],
    media: [
      'https://images.unsplash.com/photo-1600585154526-990dced4db0d?w=1200&q=80',
      'https://images.unsplash.com/photo-1600573472592-401b489a3cdc?w=1200&q=80',
      'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=1200&q=80',
    ],
  },
  {
    key: 'makebelieve',
    addressId: 'a1000000-0000-4000-8000-000000000107',
    propertyId: 'a1000000-0000-4000-8000-000000000117',
    unitId: 'a1000000-0000-4000-8000-000000000147',
    listingId: 'a1000000-0000-4000-8000-000000000164',
    city: 'San Antonio',
    state: 'TX',
    postal: '78205',
    line1: '42 Make-Believe Blvd',
    bedrooms: 2,
    bathrooms: 2,
    sqft: 1050,
    rentCents: 175000,
    depositCents: 175000,
    propertyType: 'apartment',
    petsAllowed: true,
    amenities: ['parking', 'pool'],
    media: [
      'https://images.unsplash.com/photo-1494526585095-c41746248156?w=1200&q=80',
      'https://images.unsplash.com/photo-1502005097973-6a7082348e28?w=1200&q=80',
      'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=1200&q=80',
    ],
  },
  {
    key: 'imaginary',
    addressId: 'a1000000-0000-4000-8000-000000000108',
    propertyId: 'a1000000-0000-4000-8000-000000000118',
    unitId: 'a1000000-0000-4000-8000-000000000148',
    listingId: 'a1000000-0000-4000-8000-000000000165',
    city: 'Fort Worth',
    state: 'TX',
    postal: '76102',
    line1: '9 Imaginary Way',
    bedrooms: 4,
    bathrooms: 3,
    sqft: 2100,
    rentCents: 310000,
    depositCents: 310000,
    propertyType: 'house',
    petsAllowed: true,
    amenities: ['yard', 'garage', 'parking'],
    media: [
      'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=1200&q=80',
      'https://images.unsplash.com/photo-1560185127-6ed189bf02f4?w=1200&q=80',
      'https://images.unsplash.com/photo-1560448204-603b3fc33ddc?w=1200&q=80',
    ],
  },
  {
    key: 'storybook',
    addressId: 'a1000000-0000-4000-8000-000000000109',
    propertyId: 'a1000000-0000-4000-8000-000000000119',
    unitId: 'a1000000-0000-4000-8000-000000000149',
    listingId: 'a1000000-0000-4000-8000-000000000166',
    city: 'Austin',
    state: 'TX',
    postal: '78745',
    line1: '555 Storybook Street',
    bedrooms: 3,
    bathrooms: 2,
    sqft: 1320,
    rentCents: 245000,
    depositCents: 245000,
    propertyType: 'townhome',
    petsAllowed: true,
    amenities: ['parking', 'laundry'],
    media: [
      'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=1200&q=80',
      'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&q=80',
      'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200&q=80',
    ],
  },
  {
    key: 'mirage',
    addressId: 'a1000000-0000-4000-8000-00000000010a',
    propertyId: 'a1000000-0000-4000-8000-00000000011a',
    unitId: 'a1000000-0000-4000-8000-00000000014a',
    listingId: 'a1000000-0000-4000-8000-000000000167',
    city: 'Plano',
    state: 'TX',
    postal: '75024',
    line1: '18 Mirage Meadow Ln',
    bedrooms: 2,
    bathrooms: 2,
    sqft: 1100,
    rentCents: 205000,
    depositCents: 205000,
    propertyType: 'apartment',
    petsAllowed: false,
    amenities: ['gym', 'pool', 'parking'],
    media: [
      'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=1200&q=80',
      'https://images.unsplash.com/photo-1598928506311-c55ded91a20c?w=1200&q=80',
      'https://images.unsplash.com/photo-1556912173-46c336c7fd55?w=1200&q=80',
    ],
  },
  {
    key: 'illusion',
    addressId: 'a1000000-0000-4000-8000-00000000010b',
    propertyId: 'a1000000-0000-4000-8000-00000000011b',
    unitId: 'a1000000-0000-4000-8000-00000000014b',
    listingId: 'a1000000-0000-4000-8000-000000000168',
    city: 'Round Rock',
    state: 'TX',
    postal: '78664',
    line1: '301 Illusion Ave',
    bedrooms: 1,
    bathrooms: 1,
    sqft: 580,
    rentCents: 135000,
    depositCents: 135000,
    propertyType: 'apartment',
    petsAllowed: true,
    amenities: ['laundry'],
    media: [
      'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80',
      'https://images.unsplash.com/photo-1630699144867-37acec97df5a?w=1200&q=80',
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80',
    ],
  },
  {
    key: 'fable',
    addressId: 'a1000000-0000-4000-8000-00000000010c',
    propertyId: 'a1000000-0000-4000-8000-00000000011c',
    unitId: 'a1000000-0000-4000-8000-00000000014c',
    listingId: 'a1000000-0000-4000-8000-000000000169',
    city: 'Austin',
    state: 'TX',
    postal: '78702',
    line1: '88 Fable Court',
    bedrooms: 2,
    bathrooms: 1.5,
    sqft: 920,
    rentCents: 199000,
    depositCents: 199000,
    propertyType: 'townhome',
    petsAllowed: true,
    amenities: ['parking', 'yard'],
    media: [
      'https://images.unsplash.com/photo-1449844908441-8829872d2607?w=1200&q=80',
      'https://images.unsplash.com/photo-1600047509358-9dc75507daeb?w=1200&q=80',
      'https://images.unsplash.com/photo-1600585154084-4e5fe7c39198?w=1200&q=80',
    ],
  },
];

const PREVIEW_APPS = [
  {
    id: 'a1000000-0000-4000-8000-000000000201',
    listingId: 'a1000000-0000-4000-8000-000000000131',
    status: 'awaiting_landlord_interest',
  },
  {
    id: 'a1000000-0000-4000-8000-000000000202',
    listingId: 'a1000000-0000-4000-8000-000000000132',
    status: 'awaiting_consent',
  },
  {
    id: 'a1000000-0000-4000-8000-000000000203',
    listingId: 'a1000000-0000-4000-8000-000000000133',
    status: 'screening_complete',
  },
] as const;

type PlanRow = {
  table: string;
  id: string | null;
  action: 'insert_if_missing' | 'grant_if_missing' | 'set_if_null_or_same' | 'skip_existing';
  exists: boolean;
  detail?: string;
};

function addressHash(line1: string, city: string, state: string, postal: string): string {
  return createHash('sha256')
    .update(`seed-preview-prod|${line1}|${city}|${state}|${postal}`.toUpperCase())
    .digest('hex');
}

function redactDbUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '[unparseable DATABASE_URL]';
  }
}

async function ensureAwsKmsIfNeeded(): Promise<void> {
  if (process.env.USE_LOCAL_INFRA === 'true') return;
  if (!shouldUseAwsInfra(process.env.NODE_ENV)) return;
  const kmsKeyId = process.env.KMS_KEY_ID;
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-2';
  const bucket = process.env.S3_BUCKET ?? process.env.OBJECT_STORE_BUCKET ?? 'unused-local';
  if (kmsKeyId) {
    await initializeAwsRuntime({
      awsRegion: region,
      kmsKeyId,
      s3Bucket: bucket,
    });
  }
}

async function findPartyIdByEmail(
  client: pg.Client,
  email: string,
): Promise<string | null> {
  const hmacHex = platformEmailHmac(email).toString('hex');
  const { rows } = await client.query<{ party_id: string }>(
    `select party_id from external_identity_ref
     where vendor = 'email' and vendor_subject_id = $1
     limit 1`,
    [hmacHex],
  );
  return rows[0]?.party_id ?? null;
}

async function existsId(
  client: pg.Client,
  table: string,
  id: string,
): Promise<boolean> {
  const { rows } = await client.query<{ ok: number }>(
    `select 1 as ok from ${table} where id = $1 limit 1`,
    [id],
  );
  return Boolean(rows[0]);
}

async function buildPlan(client: pg.Client): Promise<{
  plan: PlanRow[];
  renterPartyId: string | null;
}> {
  const plan: PlanRow[] = [];
  const renterPartyId = await findPartyIdByEmail(client, PREVIEW_RENTER_EMAIL);

  plan.push({
    table: 'party + external_identity_ref + party_identity',
    id: renterPartyId,
    action: renterPartyId ? 'skip_existing' : 'insert_if_missing',
    exists: Boolean(renterPartyId),
    detail: `email=${PREVIEW_RENTER_EMAIL} (preview_party_id)`,
  });

  if (renterPartyId) {
    const role = await client.query<{ id: string }>(
      `select id from party_role
       where party_id = $1 and role = 'renter' and revoked_at is null
         and org_id is null
       limit 1`,
      [renterPartyId],
    );
    plan.push({
      table: 'party_role',
      id: role.rows[0]?.id ?? null,
      action: role.rows[0] ? 'skip_existing' : 'grant_if_missing',
      exists: Boolean(role.rows[0]),
      detail: `renter role for ${PREVIEW_RENTER_EMAIL} (never revokes other roles)`,
    });

    const profile = await client.query<{ id: string }>(
      `select id from renter_profile where party_id = $1 limit 1`,
      [renterPartyId],
    );
    plan.push({
      table: 'renter_profile',
      id: profile.rows[0]?.id ?? null,
      action: profile.rows[0] ? 'skip_existing' : 'insert_if_missing',
      exists: Boolean(profile.rows[0]),
      detail: `party_id=${renterPartyId}`,
    });
  } else {
    plan.push({
      table: 'party_role',
      id: null,
      action: 'grant_if_missing',
      exists: false,
      detail: 'renter role after party create',
    });
    plan.push({
      table: 'renter_profile',
      id: null,
      action: 'insert_if_missing',
      exists: false,
      detail: 'after party create',
    });
  }

  for (const org of [HP_ORG, BROKER_ORG]) {
    const exists = await existsId(client, 'org', org.id);
    plan.push({
      table: 'org',
      id: org.id,
      action: exists ? 'skip_existing' : 'insert_if_missing',
      exists,
      detail: `${org.displayName} (${org.kind})`,
    });
  }

  const hp = await client.query<{ managed_by_broker_org_id: string | null }>(
    `select managed_by_broker_org_id from org where id = $1`,
    [HP_ORG.id],
  );
  const currentDelegation = hp.rows[0]?.managed_by_broker_org_id ?? null;
  const delegationOk = currentDelegation === BROKER_ORG.id;
  plan.push({
    table: 'org.managed_by_broker_org_id',
    id: HP_ORG.id,
    action: 'set_if_null_or_same',
    exists: delegationOk,
    detail: delegationOk
      ? `already → ${BROKER_ORG.id}`
      : currentDelegation
        ? `current=${currentDelegation} (will NOT overwrite foreign broker)`
        : `will set → ${BROKER_ORG.id} if null`,
  });

  const brokerProfile = await client.query<{ org_id: string }>(
    `select org_id from broker_profile where org_id = $1`,
    [BROKER_ORG.id],
  );
  plan.push({
    table: 'broker_profile',
    id: BROKER_ORG.id,
    action: brokerProfile.rows[0] ? 'skip_existing' : 'insert_if_missing',
    exists: Boolean(brokerProfile.rows[0]),
    detail: 'Fake Horizon license stub',
  });

  for (const listing of LISTINGS) {
    plan.push({
      table: 'address',
      id: listing.addressId,
      action: (await existsId(client, 'address', listing.addressId))
        ? 'skip_existing'
        : 'insert_if_missing',
      exists: await existsId(client, 'address', listing.addressId),
      detail: listing.line1,
    });
    plan.push({
      table: 'property',
      id: listing.propertyId,
      action: (await existsId(client, 'property', listing.propertyId))
        ? 'skip_existing'
        : 'insert_if_missing',
      exists: await existsId(client, 'property', listing.propertyId),
    });
    plan.push({
      table: 'unit',
      id: listing.unitId,
      action: (await existsId(client, 'unit', listing.unitId))
        ? 'skip_existing'
        : 'insert_if_missing',
      exists: await existsId(client, 'unit', listing.unitId),
    });
    const listingExists = await existsId(client, 'listing', listing.listingId);
    plan.push({
      table: 'listing',
      id: listing.listingId,
      action: listingExists ? 'skip_existing' : 'insert_if_missing',
      exists: listingExists,
      detail: `${listing.line1}, ${listing.city}`,
    });

    for (let i = 0; i < listing.media.length; i++) {
      const media = await client.query<{ id: string }>(
        `select id from listing_media
         where listing_id = $1 and position = $2
         limit 1`,
        [listing.listingId, i],
      );
      plan.push({
        table: 'listing_media',
        id: media.rows[0]?.id ?? null,
        action: media.rows[0] ? 'skip_existing' : 'insert_if_missing',
        exists: Boolean(media.rows[0]),
        detail: `listing=${listing.listingId} position=${i}`,
      });
    }
  }

  for (const app of PREVIEW_APPS) {
    const exists = await existsId(client, 'application', app.id);
    plan.push({
      table: 'application',
      id: app.id,
      action: exists ? 'skip_existing' : 'insert_if_missing',
      exists,
      detail: exists
        ? 'preserve existing status (no reset)'
        : `insert status=${app.status} listing=${app.listingId}`,
    });
  }

  return { plan, renterPartyId };
}

async function applySeed(client: pg.Client): Promise<{
  renterPartyId: string;
  actions: string[];
}> {
  const actions: string[] = [];

  let renterPartyId = await findPartyIdByEmail(client, PREVIEW_RENTER_EMAIL);
  if (!renterPartyId) {
    const created = await createPartyWithIdentity(asDb(client), getKmsProvider(), {
      identity: {
        email: PREVIEW_RENTER_EMAIL,
        givenName: 'Fake',
        familyName: 'Renter',
      },
    });
    renterPartyId = created.partyId;
    const hmacHex = platformEmailHmac(PREVIEW_RENTER_EMAIL).toString('hex');
    await client.query(
      `insert into external_identity_ref (party_id, vendor, vendor_subject_id)
       values ($1, 'email', $2)
       on conflict (vendor, vendor_subject_id) do nothing`,
      [renterPartyId, hmacHex],
    );
    actions.push(`created party ${renterPartyId} for ${PREVIEW_RENTER_EMAIL}`);
  } else {
    actions.push(`renter party exists ${renterPartyId}`);
  }

  const existingRole = await client.query<{ id: string }>(
    `select id from party_role
     where party_id = $1 and role = 'renter' and revoked_at is null and org_id is null
     limit 1`,
    [renterPartyId],
  );
  if (!existingRole.rows[0]) {
    await grantRole(asDb(client), {
      partyId: renterPartyId,
      orgId: null,
      role: 'renter',
    });
    actions.push('granted renter role (additive only)');
  }

  for (const org of [HP_ORG, BROKER_ORG]) {
    const ins = await client.query(
      `insert into org (id, kind, legal_name, display_name, claim_status)
       values ($1, $2, $3, $4, 'claimed')
       on conflict (id) do nothing`,
      [org.id, org.kind, org.legalName, org.displayName],
    );
    if ((ins.rowCount ?? 0) > 0) {
      actions.push(`inserted org ${org.displayName} ${org.id}`);
    }
  }

  const del = await client.query(
    `update org
     set managed_by_broker_org_id = $2
     where id = $1
       and managed_by_broker_org_id is null`,
    [HP_ORG.id, BROKER_ORG.id],
  );
  if ((del.rowCount ?? 0) > 0) {
    actions.push(`set Fake Oaks managed_by → Fake Horizon`);
  } else {
    const cur = await client.query<{ managed_by_broker_org_id: string | null }>(
      `select managed_by_broker_org_id from org where id = $1`,
      [HP_ORG.id],
    );
    const v = cur.rows[0]?.managed_by_broker_org_id;
    if (v === BROKER_ORG.id) {
      actions.push('delegation already correct');
    } else if (v) {
      actions.push(
        `delegation unchanged (existing managed_by_broker_org_id=${v}; will not overwrite)`,
      );
    } else {
      actions.push('delegation skipped (org missing?)');
    }
  }

  const bp = await client.query(
    `insert into broker_profile (
       org_id, license_state, license_number, license_verified_at, license_expires_at,
       status, credit_tier, max_open_leads, is_auto_accept
     ) values ($1, 'TX', 'FAKE-BRK-0001', now(), '2099-12-31', 'active', 'new', 10, false)
     on conflict (org_id) do nothing`,
    [BROKER_ORG.id],
  );
  if ((bp.rowCount ?? 0) > 0) actions.push('inserted broker_profile for Fake Horizon');

  const profileIns = await client.query<{ id: string }>(
    `insert into renter_profile (
       party_id, given_name, family_name, email, phone_e164,
       annual_income_cents, move_in_urgency, bedrooms_min, rent_max_cents, preferred_state,
       has_pets, household_size
     ) values (
       $1, 'Fake', 'Renter', $2, '+15125550100',
       7200000, 'flexible', 1, 250000, 'TX',
       false, 1
     )
     on conflict (party_id) do nothing
     returning id`,
    [renterPartyId, PREVIEW_RENTER_EMAIL],
  );
  let renterProfileId = profileIns.rows[0]?.id;
  if (!renterProfileId) {
    const existing = await client.query<{ id: string }>(
      `select id from renter_profile where party_id = $1`,
      [renterPartyId],
    );
    renterProfileId = existing.rows[0]?.id;
  } else {
    actions.push(`inserted renter_profile ${renterProfileId}`);
  }
  if (!renterProfileId) {
    throw new Error('renter_profile missing after upsert');
  }

  for (const listing of LISTINGS) {
    const hash = addressHash(listing.line1, listing.city, listing.state, listing.postal);
    const raw = `${listing.line1}, ${listing.city}, ${listing.state} ${listing.postal}`;

    const addr = await client.query(
      `insert into address (
         id, raw_input, line1, city, state, postal_code, normalized_hash,
         normalizer_vendor, normalizer_version, is_dpv_confirmed, geocode_precision
       ) values ($1,$2,$3,$4,$5,$6,$7,'preview_prod_seed','1', true, 'rooftop')
       on conflict (id) do nothing`,
      [
        listing.addressId,
        raw,
        listing.line1,
        listing.city,
        listing.state,
        listing.postal,
        hash,
      ],
    );
    if ((addr.rowCount ?? 0) > 0) actions.push(`inserted address ${listing.line1}`);

    const prop = await client.query(
      `insert into property (id, address_id, property_type)
       values ($1, $2, $3)
       on conflict (id) do nothing`,
      [listing.propertyId, listing.addressId, listing.propertyType],
    );
    if ((prop.rowCount ?? 0) > 0) actions.push(`inserted property ${listing.propertyId}`);

    const unit = await client.query(
      `insert into unit (
         id, property_id, unit_label_raw, unit_label_normalized, bedrooms, bathrooms, sqft
       ) values ($1, $2, '1', '1', $3, $4, $5)
       on conflict (id) do nothing`,
      [
        listing.unitId,
        listing.propertyId,
        listing.bedrooms,
        listing.bathrooms,
        listing.sqft,
      ],
    );
    if ((unit.rowCount ?? 0) > 0) actions.push(`inserted unit ${listing.unitId}`);

    const list = await client.query(
      `insert into listing (
         id, org_id, unit_id, origin, rent_amount_cents, deposit_cents,
         status, published_at, last_confirmed_at, pets_allowed, amenities, available_on
       ) values (
         $1, $2, $3, 'manual', $4, $5,
         'active', now(), now(), $6, $7::text[], current_date
       )
       on conflict (id) do nothing`,
      [
        listing.listingId,
        HP_ORG.id,
        listing.unitId,
        listing.rentCents,
        listing.depositCents,
        listing.petsAllowed,
        listing.amenities,
      ],
    );
    if ((list.rowCount ?? 0) > 0) {
      actions.push(`inserted listing ${listing.listingId} (${listing.line1})`);
    }

    for (let i = 0; i < listing.media.length; i++) {
      const has = await client.query<{ id: string }>(
        `select id from listing_media
         where listing_id = $1 and position = $2
         limit 1`,
        [listing.listingId, i],
      );
      if (has.rows[0]) continue;
      await client.query(
        `insert into listing_media (listing_id, org_id, position, url, content_type)
         values ($1, $2, $3, $4, 'image/jpeg')`,
        [listing.listingId, HP_ORG.id, i, listing.media[i]],
      );
      actions.push(`inserted listing_media ${listing.listingId}#${i}`);
    }
  }

  for (const app of PREVIEW_APPS) {
    const ins = await client.query(
      `insert into application (
         id, party_id, renter_profile_id, listing_id, unit_id, org_id,
         entry_point, status, source_channel, is_demo
       )
       select $1, $2, $3, l.id, l.unit_id, l.org_id,
              'renter_initiated', $4, 'preview_prod_seed', true
       from listing l
       where l.id = $5
       on conflict (id) do nothing`,
      [app.id, renterPartyId, renterProfileId, app.status, app.listingId],
    );
    if ((ins.rowCount ?? 0) > 0) {
      actions.push(`inserted application ${app.id} status=${app.status}`);
    }
  }

  return { renterPartyId, actions };
}

async function verify(client: pg.Client): Promise<{
  ok: boolean;
  checks: Record<string, unknown>;
}> {
  const renterPartyId = await findPartyIdByEmail(client, PREVIEW_RENTER_EMAIL);
  const oaks = await client.query<{
    id: string;
    display_name: string;
    managed_by_broker_org_id: string | null;
  }>(`select id, display_name, managed_by_broker_org_id from org where id = $1`, [
    HP_ORG.id,
  ]);
  const horizon = await client.query<{ id: string; display_name: string }>(
    `select id, display_name from org where id = $1`,
    [BROKER_ORG.id],
  );
  const listings = await client.query<{ id: string; status: string; line1: string }>(
    `select l.id, l.status, a.line1
     from listing l
     join unit u on u.id = l.unit_id
     join property p on p.id = u.property_id
     join address a on a.id = p.address_id
     where l.id = any($1::uuid[])
     order by l.id`,
    [LISTINGS.map((l) => l.listingId)],
  );
  const mediaCounts = await client.query<{ listing_id: string; n: string }>(
    `select listing_id, count(*)::text as n
     from listing_media
     where listing_id = any($1::uuid[])
     group by listing_id
     order by listing_id`,
    [LISTINGS.map((l) => l.listingId)],
  );
  const apps = await client.query<{ id: string; status: string; is_demo: boolean }>(
    `select id, status, is_demo from application
     where id = any($1::uuid[])
     order by id`,
    [PREVIEW_APPS.map((a) => a.id)],
  );

  const checks = {
    preview_party_id: renterPartyId,
    preview_renter_email: PREVIEW_RENTER_EMAIL,
    fake_oaks: oaks.rows[0] ?? null,
    fake_horizon: horizon.rows[0] ?? null,
    delegation:
      oaks.rows[0]?.managed_by_broker_org_id === BROKER_ORG.id
        ? { ok: true, managed_by_broker_org_id: BROKER_ORG.id }
        : {
            ok: false,
            managed_by_broker_org_id: oaks.rows[0]?.managed_by_broker_org_id ?? null,
          },
    listings: {
      expected: LISTINGS.length,
      found: listings.rows.length,
      active: listings.rows.filter((r) => r.status === 'active').length,
      rows: listings.rows,
    },
    listing_media: {
      expected_per_listing: 3,
      by_listing: mediaCounts.rows,
      all_have_media: LISTINGS.every((l) =>
        mediaCounts.rows.some((m) => m.listing_id === l.listingId && Number(m.n) >= 1),
      ),
    },
    preview_applications: {
      expected: PREVIEW_APPS.length,
      found: apps.rows.length,
      rows: apps.rows,
    },
  };

  const ok = Boolean(
    renterPartyId &&
      oaks.rows[0] &&
      horizon.rows[0] &&
      oaks.rows[0].managed_by_broker_org_id === BROKER_ORG.id &&
      listings.rows.length === LISTINGS.length &&
      listings.rows.every((r) => r.status === 'active') &&
      apps.rows.length === PREVIEW_APPS.length &&
      checks.listing_media.all_have_media,
  );

  return { ok, checks };
}

async function main(): Promise<void> {
  const planOnly = process.argv.includes('--plan-only');
  const connectionString = resolveDatabaseUrl();

  console.log(
    JSON.stringify(
      {
        mode: planOnly ? 'plan-only' : 'plan-then-apply',
        safety: {
          deletes: false,
          truncates: false,
          resets: false,
          mutates_unrelated_orgs: false,
          mutates_real_user_roles_except_additive_renter: false,
          sessions: false,
          stripe_certn_ses: false,
        },
        database: redactDbUrl(connectionString),
        target_ids: {
          landlord_org: HP_ORG.id,
          broker_org: BROKER_ORG.id,
          renter_email: PREVIEW_RENTER_EMAIL,
          listing_ids: LISTINGS.map((l) => l.listingId),
          application_ids: PREVIEW_APPS.map((a) => a.id),
        },
      },
      null,
      2,
    ),
  );

  await ensureAwsKmsIfNeeded();

  const client = new Client({
    connectionString,
    ssl: loadRdsSslConfig() || undefined,
  });
  await client.connect();

  try {
    await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);

    const { plan } = await buildPlan(client);
    console.log('\n=== PRE-EXECUTION PLAN ===');
    console.log(JSON.stringify({ tables_touched: [...new Set(plan.map((p) => p.table))], plan }, null, 2));

    if (planOnly) {
      console.log('\nPlan-only: no writes performed.');
      return;
    }

    await client.query('begin');
    await client.query(`select set_config('rbit.bypass_rls', 'on', true)`);
    const applied = await applySeed(client);
    await client.query('commit');

    console.log('\n=== APPLY RESULT ===');
    console.log(JSON.stringify(applied, null, 2));

    const verification = await verify(client);
    console.log('\n=== VERIFICATION ===');
    console.log(JSON.stringify(verification, null, 2));

    if (!verification.ok) {
      process.exitCode = 1;
      console.error('\nVerification failed.');
    } else {
      console.log('\nPreview prod seed OK.');
    }
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
