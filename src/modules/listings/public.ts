import type { DbClient } from '../../db/pool.js';
import { getObjectStore } from '../../infra/object-store/index.js';
import { emitDomainEvent } from '../audit/index.js';
import {
  serializeListingForApi,
  type ListingApiShape,
  type SourceDisplayRule,
} from '../ingestion/index.js';
import { AppError } from '../shared/errors.js';
import { publishableMapLocation } from './map-location.js';

type ListingRow = {
  id: string;
  org_id: string;
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
  is_demo: boolean;
  inventory_kind: 'partner' | 'external' | 'demo';
  application_fee_cents: number | null;
  reusable_application_eligible: boolean;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  raw_input: string | null;
  latitude: number | null;
  longitude: number | null;
  geocode_precision: string | null;
  rule_name: string | null;
  rule_version: string | null;
  is_attribution_required: boolean | null;
  attribution_text: string | null;
  suppress_fields: string[] | null;
  show_exact_address: boolean | null;
  media_policy: string | null;
};

type ListingOfferRow = {
  listing_id: string;
  display_text: string;
  offer_type: string;
  qualifier_text: string | null;
  attribution_text: string | null;
  offer_status: string;
};

const LISTING_SELECT = `
  select
    l.id,
    l.org_id,
    l.rent_amount_cents,
    l.deposit_cents,
    l.available_on::text,
    l.lease_term_months,
    l.status,
    coalesce(l.is_demo, false) as is_demo,
    coalesce(l.inventory_kind, 'partner') as inventory_kind,
    l.application_fee_cents,
    coalesce(l.reusable_application_eligible, false) as reusable_application_eligible,
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
    ST_Y(a.geom::geometry) as latitude,
    ST_X(a.geom::geometry) as longitude,
    a.geocode_precision,
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

function publicCatalogWhere(): string {
  const includeDemo = process.env.DWEL_PUBLIC_INCLUDE_DEMO === 'true';
  return includeDemo
    ? `l.status = 'active'`
    : `l.status = 'active' and coalesce(l.is_demo, false) = false`;
}

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

function rowToApiShape(
  row: ListingRow,
  media: Array<{ url: string }>,
  offers: ListingOfferRow[],
): ListingApiShape {
  const verifiedOffers = offers
    .filter((offer) => offer.offer_status === 'verified')
    .map((offer) => ({
      display_text: offer.display_text,
      offer_type: offer.offer_type,
      qualifier_text:
        offer.qualifier_text ?? 'Offer advertised by property; terms apply.',
      attribution_text: offer.attribution_text,
    }));
  const cashbackOffer = verifiedOffers.find((offer) => offer.offer_type === 'cashback');
  const inventoryKind = row.inventory_kind === 'external' ? 'external' : row.inventory_kind === 'demo' ? 'demo' : 'partner';
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
    inventory_kind: inventoryKind,
    listing_channel: inventoryKind === 'external' ? 'Listed by external property' : 'Partner listing',
    application_fee_cents: row.application_fee_cents,
    reusable_application_eligible: row.reusable_application_eligible,
    // Dwel cashback only from a verified cashback offer. Never invent a percentage from rent.
    cashback_cents: null,
    cashback_interim_v1: false,
    has_verified_cashback_offer: Boolean(cashbackOffer),
    offers: verifiedOffers,
    media,
    address: {
      line1: row.line1,
      line2: row.line2,
      city: row.city,
      state: row.state,
      postal_code: row.postal_code,
      raw_input: row.raw_input,
    },
    map_location: publishableMapLocation(
      row.latitude == null ? null : Number(row.latitude),
      row.longitude == null ? null : Number(row.longitude),
      row.geocode_precision,
    ),
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

async function loadOffers(
  client: DbClient,
  listingIds: string[],
): Promise<Map<string, ListingOfferRow[]>> {
  const map = new Map<string, ListingOfferRow[]>();
  if (listingIds.length === 0) return map;
  const { rows } = await client.query<ListingOfferRow>(
    `select listing_id, display_text, offer_type, qualifier_text, attribution_text, offer_status
     from listing_offer
     where listing_id = any($1::uuid[])
       and offer_status = 'verified'
     order by created_at asc`,
    [listingIds],
  );
  for (const row of rows) {
    const list = map.get(row.listing_id) ?? [];
    list.push(row);
    map.set(row.listing_id, list);
  }
  return map;
}

async function serializeRows(
  client: DbClient,
  rows: ListingRow[],
): Promise<Record<string, unknown>[]> {
  const ids = rows.map((r) => r.id);
  const mediaMap = await loadMedia(client, ids);
  const offerMap = await loadOffers(client, ids);
  return rows.map((row) =>
    serializeListingForApi(
      rowToApiShape(row, mediaMap.get(row.id) ?? [], offerMap.get(row.id) ?? []),
      rowToDisplayRule(row),
    ),
  );
}

export const PUBLIC_LISTING_SORTS = ['newest', 'rent_asc', 'rent_desc', 'cashback'] as const;
export type PublicListingSort = (typeof PUBLIC_LISTING_SORTS)[number];

export type ListPublicListingsInput = {
  limit?: number;
  offset?: number;
  q?: string;
  minBeds?: number;
  minBaths?: number;
  propertyType?: string;
  sort?: PublicListingSort;
};

export type ListingPublishFacts = {
  rentAmountCents: number;
  line1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  bedrooms: number | null;
  propertyType: string | null;
  availableOn: string | null;
  orgStatus: string;
  claimStatus: string;
  hasAuthorizedLandlord: boolean;
  propertyAuthorityVerified: boolean;
};

/** Names the inventory fields that block a public publish. Does not change a row. */
export function listingPublishGaps(facts: ListingPublishFacts): string[] {
  const gaps: string[] = [];
  if (!Number.isInteger(facts.rentAmountCents) || facts.rentAmountCents <= 0) gaps.push('pricing');
  const state = facts.state?.trim().toUpperCase() ?? '';
  if (!facts.line1?.trim() || !facts.city?.trim() || state.length !== 2 || !facts.postalCode?.trim()) {
    gaps.push('location');
  }
  if (facts.bedrooms == null || !Number.isFinite(facts.bedrooms) || !facts.propertyType?.trim()) {
    gaps.push('property_details');
  }
  if (!facts.availableOn?.trim()) gaps.push('availability');
  if (facts.orgStatus !== 'active' || facts.claimStatus !== 'claimed') gaps.push('organization');
  if (!facts.propertyAuthorityVerified) gaps.push('property_authority');
  if (!facts.hasAuthorizedLandlord) gaps.push('authorization');
  return gaps;
}

export function parsePublicListingQuery(params: URLSearchParams): ListPublicListingsInput {
  const sortRaw = params.get('sort') ?? 'newest';
  if (!PUBLIC_LISTING_SORTS.includes(sortRaw as PublicListingSort)) {
    throw new AppError('invalid sort', 'validation_error', 400);
  }
  const propertyType = params.get('property_type')?.trim() ?? '';
  if (propertyType.length > 40) {
    throw new AppError('invalid property type', 'validation_error', 400);
  }
  const q = params.get('q')?.trim() ?? '';
  if (q.length > 120) {
    throw new AppError('invalid search', 'validation_error', 400);
  }
  const minBeds = optionalNumber(params.get('min_beds'));
  const minBaths = optionalNumber(params.get('min_baths'));
  if (minBeds == null && params.get('min_beds')) {
    throw new AppError('invalid bedrooms filter', 'validation_error', 400);
  }
  if (minBaths == null && params.get('min_baths')) {
    throw new AppError('invalid bathrooms filter', 'validation_error', 400);
  }
  return {
    limit: finiteNumber(params.get('limit'), 20),
    offset: finiteNumber(params.get('offset'), 0),
    q: q || undefined,
    minBeds,
    minBaths,
    propertyType: propertyType || undefined,
    sort: sortRaw as PublicListingSort,
  };
}

function finiteNumber(raw: string | null, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function optionalNumber(raw: string | null): number | undefined {
  if (raw == null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

/**
 * Public catalog is active inventory only.
 * Cashback sort follows rent because displayed cashback is a fixed fraction of rent.
 * This does not call the preference ranker.
 */
export async function listPublicListings(
  client: DbClient,
  input: ListPublicListingsInput = {},
): Promise<{ listings: Record<string, unknown>[]; total: number; limit: number; offset: number }> {
  const limit = clampInt(input.limit ?? 20, 1, 100);
  const offset = clampInt(input.offset ?? 0, 0, 100_000);
  const params: unknown[] = [];
  const where = [publicCatalogWhere()];

  if (input.q?.trim()) {
    params.push(`%${input.q.trim().replace(/[%_\\]/g, '\\$&')}%`);
    where.push(
      `(a.city ilike $${params.length} or a.state ilike $${params.length} or a.postal_code ilike $${params.length} or a.line1 ilike $${params.length} or coalesce(a.raw_input, '') ilike $${params.length})`,
    );
  }
  if (input.minBeds != null) {
    params.push(input.minBeds);
    where.push(`u.bedrooms >= $${params.length}`);
  }
  if (input.minBaths != null) {
    params.push(input.minBaths);
    where.push(`u.bathrooms >= $${params.length}`);
  }
  if (input.propertyType) {
    params.push(input.propertyType);
    where.push(`lower(p.property_type) = lower($${params.length})`);
  }

  const whereSql = where.join(' and ');
  const orderSql =
    input.sort === 'rent_asc'
      ? 'l.rent_amount_cents asc, l.created_at desc'
      : input.sort === 'rent_desc' || input.sort === 'cashback'
        ? 'l.rent_amount_cents desc, l.created_at desc'
        : 'l.published_at desc nulls last, l.created_at desc';

  const fromSql = `
    from listing l
    join unit u on u.id = l.unit_id
    join property p on p.id = u.property_id
    join address a on a.id = p.address_id
    where ${whereSql}`;

  const { rows: countRows } = await client.query<{ total: string }>(
    `select count(*)::text as total ${fromSql}`,
    params,
  );

  const pageParams = [...params, limit, offset];
  const { rows } = await client.query<ListingRow>(
    `${LISTING_SELECT}
     where ${whereSql}
     order by ${orderSql}
     limit $${params.length + 1} offset $${params.length + 2}`,
    pageParams,
  );

  return {
    listings: await serializeRows(client, rows),
    total: Number(countRows[0]?.total ?? 0),
    limit,
    offset,
  };
}

export async function getPublicListingById(
  client: DbClient,
  listingId: string,
): Promise<Record<string, unknown>> {
  const { rows } = await client.query<ListingRow>(
    `${LISTING_SELECT}
     where l.id = $1 and ${publicCatalogWhere()}`,
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
  postal_code: string | null;
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
    postal_code: string | null;
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
       a.line1, a.city, a.state, a.postal_code,
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
      postal_code: r.postal_code,
      applicant_count: Number(r.applicant_count),
      days_vacant: Number(r.days_vacant),
      photo_url: photoUrl,
    });
  }
  return out;
}

async function assertListingPublishable(
  client: DbClient,
  input: { listingId: string; orgId: string; actorPartyId?: string | null },
): Promise<void> {
  const { rows } = await client.query<{
    rent_amount_cents: number;
    line1: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    bedrooms: string | null;
    property_type: string | null;
    available_on: string | null;
    org_status: string;
    claim_status: string;
    has_authorized_landlord: boolean;
    has_assigned_broker: boolean;
    property_authority_verified: boolean;
  }>(
    `select l.rent_amount_cents,
            coalesce(nullif(btrim(a.line1), ''), a.raw_input) as line1,
            a.city, a.state, a.postal_code,
            u.bedrooms::text, p.property_type,
            l.available_on::text,
            o.status as org_status, o.claim_status,
            exists (
              select 1 from party_role pr
              where pr.org_id = l.org_id
                and pr.role = 'landlord'
                and pr.revoked_at is null
                and pr.status = 'active'
                and pr.party_id = $3::uuid
            ) as has_authorized_landlord,
            exists (
              select 1
              from property_broker_assignment pba
              join party_role pr on pr.org_id = pba.broker_org_id
              where pba.property_id = p.id
                and pba.provider_org_id = l.org_id
                and pba.status = 'active'
                and pba.revoked_at is null
                and pr.party_id = $3::uuid
                and pr.role = 'broker'
                and pr.revoked_at is null
                and pr.status = 'active'
            ) as has_assigned_broker,
            exists (
              select 1 from property_authority pa
              where pa.property_id = p.id
                and pa.org_id = l.org_id
                and pa.status = 'verified'
            ) as property_authority_verified
     from listing l
     join unit u on u.id = l.unit_id
     join property p on p.id = u.property_id
     join address a on a.id = p.address_id
     join org o on o.id = l.org_id
     where l.id = $1 and l.org_id = $2`,
    [input.listingId, input.orgId, input.actorPartyId ?? null],
  );
  const row = rows[0];
  if (!row) throw new AppError('listing not found', 'listing_not_found', 404);
  const bedrooms = row.bedrooms == null ? null : Number(row.bedrooms);
  const gaps = listingPublishGaps({
    rentAmountCents: row.rent_amount_cents,
    line1: row.line1,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    bedrooms: bedrooms != null && Number.isFinite(bedrooms) ? bedrooms : null,
    propertyType: row.property_type,
    availableOn: row.available_on,
    orgStatus: row.org_status,
    claimStatus: row.claim_status,
    hasAuthorizedLandlord: row.has_authorized_landlord || row.has_assigned_broker,
    propertyAuthorityVerified: row.property_authority_verified,
  });
  if (gaps.includes('authorization')) {
    throw new AppError(
      'only an authorized representative can publish the listing',
      'listing_not_authorized',
      403,
    );
  }
  if (gaps.length > 0) {
    throw new AppError(
      `listing is not publishable: ${gaps.join(', ')}`,
      'listing_not_publishable',
      409,
    );
  }
}

export async function setListingStatus(
  client: DbClient,
  input: {
    listingId: string;
    orgId: string;
    status: 'active' | 'paused' | 'draft' | 'rented';
    actorPartyId?: string | null;
  },
): Promise<{ id: string; status: string }> {
  const { rows } = await client.query<{ id: string; status: string }>(
    `select id, status from listing where id = $1 and org_id = $2 for update`,
    [input.listingId, input.orgId],
  );
  const current = rows[0];
  if (!current) throw new AppError('listing not found', 'listing_not_found', 404);
  if (current.status === input.status) {
    return { id: current.id, status: current.status };
  }
  if (input.status === 'active') {
    await assertListingPublishable(client, input);
  }
  const { rows: updated } = await client.query<{ id: string; status: string }>(
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
  const row = updated[0];
  if (!row) throw new AppError('listing not found', 'listing_not_found', 404);
  await emitDomainEvent(client, {
    aggregateType: 'listing',
    aggregateId: row.id,
    eventType: 'listing.status_changed',
    payload: { from: current.status, to: row.status },
    actorPartyId: input.actorPartyId ?? null,
    actorKind: input.actorPartyId ? 'user' : 'system',
  });
  return row;
}

export function isSafeListingMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    return parsed.hostname.length > 0;
  } catch {
    return false;
  }
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
    if (!isSafeListingMediaUrl(trimmed)) continue;
    await client.query(
      `insert into listing_media (listing_id, org_id, position, url)
       values ($1, $2, $3, $4)`,
      [input.listingId, input.orgId, position++, trimmed],
    );
  }
}
