import type { Listing } from '../types';

/** Raw public listing payload from GET /v1/listings (API shape). */
export type ApiListingRaw = {
  id?: string;
  rent_amount_cents?: number;
  rent_cents?: number;
  deposit_cents?: number | null;
  cashback_cents?: number | null;
  incentive_cents?: number | null;
  renter_cashback_cents?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  beds?: number;
  baths?: number;
  sqft?: number | null;
  property_type?: string | null;
  available_on?: string | null;
  lease_term_months?: number | null;
  description?: string | null;
  status?: string;
  address?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
  } | null;
  city?: string;
  state?: string;
  postal_code?: string;
  property_name?: string;
  media?: Array<{ url?: string } | string> | null;
  photos?: string[];
  concession_available?: boolean;
  concession_description?: string | null;
  pet_friendly?: boolean;
  parking?: boolean;
};

/** Prefer real API cashback fields; return null when absent / non-positive. */
export function resolveCashbackCents(raw: {
  cashback_cents?: number | null;
  incentive_cents?: number | null;
  renter_cashback_cents?: number | null;
}): number | null {
  for (const key of ['cashback_cents', 'renter_cashback_cents', 'incentive_cents'] as const) {
    const v = raw[key];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
  }
  return null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isListingUuid(id: string): boolean {
  return UUID_RE.test(id);
}

/**
 * Normalize API listing rows into the frontend Listing contract.
 * Prefer this over discarding API rows that use rent_amount_cents / nested address.
 */
export function mapApiListing(raw: ApiListingRaw): Listing | null {
  if (!raw?.id || typeof raw.id !== 'string') return null;
  const city = raw.city ?? raw.address?.city ?? null;
  const state = raw.state ?? raw.address?.state ?? null;
  const rent =
    typeof raw.rent_cents === 'number'
      ? raw.rent_cents
      : typeof raw.rent_amount_cents === 'number'
        ? raw.rent_amount_cents
        : null;
  if (!city || rent == null) return null;

  const photos =
    raw.photos?.length
      ? raw.photos
      : (raw.media ?? [])
          .map((m) => (typeof m === 'string' ? m : m?.url))
          .filter((u): u is string => Boolean(u));

  const statusRaw = (raw.status ?? 'active').toUpperCase();
  const status =
    statusRaw === 'ACTIVE' || statusRaw === 'LIVE'
      ? ('LIVE' as const)
      : statusRaw === 'PAUSED'
        ? ('PAUSED' as const)
        : statusRaw === 'DRAFT'
          ? ('DRAFT' as const)
          : ('active' as const);

  const cashback = resolveCashbackCents(raw);
  const deposit =
    typeof raw.deposit_cents === 'number' && Number.isFinite(raw.deposit_cents) && raw.deposit_cents >= 0
      ? Math.round(raw.deposit_cents)
      : null;

  return {
    id: raw.id,
    property_name:
      raw.property_name ||
      raw.address?.line1 ||
      `${city} home`,
    address_line: raw.address?.line1 ?? '',
    city,
    state: state ?? '',
    postal_code: raw.postal_code ?? raw.address?.postal_code ?? '',
    rent_cents: rent,
    deposit_cents: deposit,
    cashback_cents: cashback,
    beds: Number(raw.beds ?? raw.bedrooms ?? 0),
    baths: Number(raw.baths ?? raw.bathrooms ?? 1),
    sqft: raw.sqft ?? null,
    lease_months: raw.lease_term_months ?? null,
    available_on: raw.available_on ?? null,
    photos,
    concession_available: Boolean(raw.concession_available),
    concession_description: raw.concession_description ?? null,
    specials_count: 0,
    pet_friendly: Boolean(raw.pet_friendly),
    parking: Boolean(raw.parking),
    description: raw.description ?? undefined,
    status,
    property_type:
      raw.property_type === 'house' ||
      raw.property_type === 'townhome' ||
      raw.property_type === 'condo' ||
      raw.property_type === 'apartment'
        ? raw.property_type
        : 'apartment',
  };
}

export function incomeBandToAnnualCents(band: string): number {
  const map: Record<string, number> = {
    under_2k: 20_000_00,
    '2k_3k': 30_000_00,
    '3k_4k': 42_000_00,
    '4k_5k': 54_000_00,
    '5k_7_5k': 75_000_00,
    '7_5k_10k': 105_000_00,
    '10k_plus': 150_000_00,
  };
  return map[band] ?? 48_000_00;
}
