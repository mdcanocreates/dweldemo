import type { DbClient } from '../../db/pool.js';
import { getObjectStore } from '../../infra/object-store/index.js';
import {
  serializeListingForApi,
  type ListingApiShape,
  type SourceDisplayRule,
} from '../ingestion/index.js';
import { AppError } from '../shared/errors.js';

type ListingRow = {
  id: string;
  rent_amount_cents: number;
  deposit_cents: number | null;
  available_on: string | null;
  lease_term_months: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  property_type: string | null;
  status: string;
  description: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  raw_input: string | null;
  rule_name: string | null;
  rule_version: string | null;
  is_attribution_required: boolean | null;
  attribution_text: string | null;
  suppress_fields: string[] | null;
  show_exact_address: boolean | null;
  media_policy: string | null;
};

const LISTING_SELECT = `
  select
    l.id,
    l.rent_amount_cents,
    l.deposit_cents,
    l.available_on::text,
    l.lease_term_months,
    l.status,
    u.bedrooms,
    u.bathrooms,
    u.sqft,
    p.property_type,
    sl.description,
    a.line1,
    a.line2,
    a.city,
    a.state,
    a.postal_code,
    a.raw_input,
    sdr.name as rule_name,
    sdr.version as rule_version,
    sdr.is_attribution_required,
    sdr.attribution_text,
    sdr.suppress_fields,
    sdr.show_exact_address,
    sdr.media_policy
  from listing l
  join unit u on u.id = l.unit_id
  join property p on p.id = u.property_id
  join address a on a.id = p.address_id
  left join source_listing sl on sl.id = l.primary_source_listing_id
  left join source s on s.id = sl.source_id
  left join source_display_rule sdr on sdr.id = s.display_rule_id
`;

function rowToDisplayRule(row: ListingRow): SourceDisplayRule | null {
  if (!row.rule_name || !row.rule_version) return null;
  return {
    name: row.rule_name,
    version: row.rule_version,
    isAttributionRequired: Boolean(row.is_attribution_required),
    attributionText: row.attribution_text,
    suppressFields: row.suppress_fields ?? [],
    showExactAddress: row.show_exact_address ?? true,
    mediaPolicy: (row.media_policy as SourceDisplayRule['mediaPolicy']) ?? 'host',
    maxCacheAgeSeconds: null,
    purgeOnDelistHours: null,
  };
}

function rowToApiShape(row: ListingRow, media: Array<{ url: string }>): ListingApiShape {
  // interim_v1: renter cashback display = 20% of first month rent (integer cents).
  // Not from rs_price_book / lease credit ledger — tagged interim until contractual offer rows exist.
  const cashbackCents = Math.round(row.rent_amount_cents * 0.2);
  return {
    id: row.id,
    rent_amount_cents: row.rent_amount_cents,
    deposit_cents: row.deposit_cents,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    sqft: row.sqft,
    property_type: row.property_type,
    available_on: row.available_on,
    lease_term_months: row.lease_term_months,
    description: row.description,
    cashback_cents: cashbackCents,
    cashback_interim_v1: true,
    media,
    address: {
      line1: row.line1,
      line2: row.line2,
      city: row.city,
      state: row.state,
      postal_code: row.postal_code,
      raw_input: row.raw_input,
    },
  };
}

async function loadMedia(
  client: DbClient,
  listingIds: string[],
): Promise<Map<string, Array<{ url: string }>>> {
  const map = new Map<string, Array<{ url: string }>>();
  if (listingIds.length === 0) return map;
  const { rows } = await client.query<{ listing_id: string; url: string | null }>(
    `select listing_id, url
     from listing_media
     where listing_id = any($1::uuid[])
       and url is not null
     order by position asc, created_at asc`,
    [listingIds],
  );
  for (const row of rows) {
    if (!row.url) continue;
    const list = map.get(row.listing_id) ?? [];
    list.push({ url: row.url });
    map.set(row.listing_id, list);
  }
  return map;
}

async function serializeRows(
  client: DbClient,
  rows: ListingRow[],
): Promise<Record<string, unknown>[]> {
  const mediaMap = await loadMedia(
    client,
    rows.map((r) => r.id),
  );
  return rows.map((row) =>
    serializeListingForApi(rowToApiShape(row, mediaMap.get(row.id) ?? []), rowToDisplayRule(row)),
  );
}

export type ListPublicListingsInput = {
  limit?: number;
  offset?: number;
};

export async function listPublicListings(
  client: DbClient,
  input: ListPublicListingsInput = {},
): Promise<{ listings: Record<string, unknown>[]; total: number }> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);

  const { rows: countRows } = await client.query<{ total: string }>(
    `select count(*)::text as total from listing where status = 'active'`,
  );

  const { rows } = await client.query<ListingRow>(
    `${LISTING_SELECT}
     where l.status = 'active'
     order by l.published_at desc nulls last, l.created_at desc
     limit $1 offset $2`,
    [limit, offset],
  );

  return {
    listings: await serializeRows(client, rows),
    total: Number(countRows[0]?.total ?? 0),
  };
}

export async function getPublicListingById(
  client: DbClient,
  listingId: string,
): Promise<Record<string, unknown>> {
  const { rows } = await client.query<ListingRow>(
    `${LISTING_SELECT}
     where l.id = $1 and l.status = 'active'`,
    [listingId],
  );
  const row = rows[0];
  if (!row) {
    throw new AppError('listing not found', 'listing_not_found', 404);
  }
  const [serialized] = await serializeRows(client, [row]);
  return serialized!;
}

export type LandlordListingRow = {
  id: string;
  status: string;
  rent_amount_cents: number;
  deposit_cents: number | null;
  pets_allowed: boolean | null;
  amenities: string[];
  available_on: string | null;
  published_at: Date | null;
  created_at: Date;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  property_type: string | null;
  line1: string | null;
  city: string | null;
  state: string | null;
  applicant_count: number;
  days_vacant: number;
  photo_url: string | null;
};

export async function listOrgListings(
  client: DbClient,
  orgId: string,
): Promise<LandlordListingRow[]> {
  const { rows } = await client.query<{
    id: string;
    status: string;
    rent_amount_cents: number;
    deposit_cents: number | null;
    pets_allowed: boolean | null;
    amenities: string[] | null;
    available_on: Date | null;
    published_at: Date | null;
    created_at: Date;
    bedrooms: number | null;
    bathrooms: number | null;
    sqft: number | null;
    property_type: string | null;
    line1: string | null;
    city: string | null;
    state: string | null;
    applicant_count: string;
    days_vacant: string;
    photo_storage_key: string | null;
    photo_url_raw: string | null;
  }>(
    `select
       l.id, l.status, l.rent_amount_cents, l.deposit_cents,
       l.pets_allowed, l.amenities, l.available_on,
       l.published_at, l.created_at,
       u.bedrooms, u.bathrooms, u.sqft, p.property_type,
       a.line1, a.city, a.state,
       (select count(*)::text from application ap where ap.listing_id = l.id) as applicant_count,
       greatest(0, floor(extract(epoch from (now() - coalesce(l.published_at, l.created_at))) / 86400))::text as days_vacant,
       (select m.storage_key from listing_media m where m.listing_id = l.id order by m.position asc limit 1) as photo_storage_key,
       (select m.url from listing_media m where m.listing_id = l.id order by m.position asc limit 1) as photo_url_raw
     from listing l
     join unit u on u.id = l.unit_id
     join property p on p.id = u.property_id
     join address a on a.id = p.address_id
     where l.org_id = $1
     order by l.created_at desc`,
    [orgId],
  );

  const store = getObjectStore();
  const out: LandlordListingRow[] = [];
  for (const r of rows) {
    let photoUrl = r.photo_url_raw;
    if (r.photo_storage_key) {
      try {
        const signed = await store.signGetUrl(r.photo_storage_key, { expiresInSeconds: 300 });
        photoUrl = signed.url;
      } catch {
        // keep raw url if signing fails (e.g. external https media)
      }
    }
    out.push({
      id: r.id,
      status: r.status,
      rent_amount_cents: r.rent_amount_cents,
      deposit_cents: r.deposit_cents,
      pets_allowed: r.pets_allowed,
      amenities: r.amenities ?? [],
      available_on: r.available_on ? r.available_on.toISOString().slice(0, 10) : null,
      published_at: r.published_at,
      created_at: r.created_at,
      bedrooms: r.bedrooms,
      bathrooms: r.bathrooms,
      sqft: r.sqft,
      property_type: r.property_type,
      line1: r.line1,
      city: r.city,
      state: r.state,
      applicant_count: Number(r.applicant_count),
      days_vacant: Number(r.days_vacant),
      photo_url: photoUrl,
    });
  }
  return out;
}

export async function setListingStatus(
  client: DbClient,
  input: {
    listingId: string;
    orgId: string;
    status: 'active' | 'paused' | 'draft' | 'rented';
  },
): Promise<{ id: string; status: string }> {
  const { rows } = await client.query<{ id: string; status: string }>(
    `update listing
     set status = $3,
         published_at = case
           when $3 = 'active' then coalesce(published_at, now())
           else published_at
         end,
         rented_at = case
           when $3 = 'rented' then coalesce(rented_at, now())
           else rented_at
         end
     where id = $1 and org_id = $2
     returning id, status`,
    [input.listingId, input.orgId, input.status],
  );
  if (!rows[0]) {
    throw new AppError('listing not found', 'listing_not_found', 404);
  }
  return rows[0];
}

export async function replaceListingMediaUrls(
  client: DbClient,
  input: { listingId: string; orgId: string; urls: string[] },
): Promise<void> {
  await client.query(`delete from listing_media where listing_id = $1 and org_id = $2`, [
    input.listingId,
    input.orgId,
  ]);
  let position = 0;
  for (const url of input.urls) {
    const trimmed = url.trim();
    if (!trimmed.startsWith('https://')) continue;
    await client.query(
      `insert into listing_media (listing_id, org_id, position, url)
       values ($1, $2, $3, $4)`,
      [input.listingId, input.orgId, position++, trimmed],
    );
  }
}
