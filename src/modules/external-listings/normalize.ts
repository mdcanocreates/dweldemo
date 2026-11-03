import { createHash } from 'node:crypto';
import type {
  ListingKind,
  NormalizedPackageRecord,
  OfferType,
  PackageKind,
} from './types.js';

const CONTACT_KEYS = new Set([
  'owner_email',
  'additional_emails',
  'pm_contact_name',
  'pm_contact_title',
  'pm_contact_phone',
  'leasing_phone',
  'contact_email_level',
  'contact_email_source',
]);

const UNSAFE_PATTERNS = [
  /<\s*script\b/i,
  /javascript:/i,
  /onerror\s*=/i,
  /onload\s*=/i,
  /REPLIT_PROMPT/i,
  /inactivate all/i,
  /replace the public inventory/i,
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter((item): item is string => Boolean(item));
}

export function normalizeAddressKey(
  line1: string | null,
  city: string | null,
  state: string | null,
): string | null {
  const parts = [line1, city, state]
    .map((part) =>
      (part ?? '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' '),
    )
    .filter(Boolean);
  return parts.length >= 2 ? parts.join('|') : null;
}

export function checksumPayload(raw: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(raw)).digest('hex');
}

export function collectUnsafeHits(raw: Record<string, unknown>): string[] {
  const blob = JSON.stringify(raw);
  return UNSAFE_PATTERNS.filter((pattern) => pattern.test(blob)).map((pattern) => pattern.source);
}

export function parseOfferType(text: string | null, tags: string[]): OfferType {
  const hay = `${text ?? ''} ${tags.join(' ')}`.toLowerCase();
  if (/\b\d+\s*weeks?\s*free\b/.test(hay)) return 'weeks_free';
  if (/\b\d+\s*months?\s*free\b/.test(hay)) return 'months_free';
  if (/\$\s*\d+/.test(hay) && /(credit|off|move-?in)/.test(hay)) return 'dollar_credit';
  if (/fee\s*waiv/.test(hay)) return 'fee_waiver';
  return 'other';
}

function addressParts(raw: Record<string, unknown>): {
  line1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
} {
  const address = asRecord(raw.address);
  if (address) {
    return {
      line1: asString(address.line1) ?? asString(address.street) ?? asString(address.address1),
      city: asString(address.city),
      state: asString(address.state),
      postalCode: asString(address.postal_code) ?? asString(address.zip),
    };
  }
  const line = asString(raw.address);
  return {
    line1: line,
    city: asString(raw.city),
    state: asString(raw.state),
    postalCode: asString(raw.postal_code) ?? asString(raw.zip),
  };
}

function listingKindFor(packageKind: PackageKind, raw: Record<string, unknown>): ListingKind {
  if (packageKind.startsWith('hud') || asString(raw.listing_type) === 'hud_assisted') {
    return 'hud_assisted';
  }
  if (packageKind.startsWith('deal') || asString(raw.source)?.includes('rent')) {
    return 'market_deal';
  }
  return 'unknown';
}

function contactFrom(raw: Record<string, unknown>, packageKind: PackageKind) {
  const email = asString(raw.owner_email);
  const name = asString(raw.pm_contact_name);
  const title = asString(raw.pm_contact_title);
  const phone = asString(raw.pm_contact_phone) ?? asString(raw.leasing_phone);
  if (!email && !name && !phone) return null;
  const level = asString(raw.contact_email_level);
  return {
    relationshipKind:
      level === 'management_firm' || packageKind === 'hud_pm_emails_500'
        ? ('management_firm' as const)
        : email || name
          ? ('property' as const)
          : ('unknown' as const),
    name,
    title,
    email,
    phone,
    provenance:
      asString(raw.contact_email_source) ??
      asString(raw.import_batch) ??
      packageKind,
  };
}

export function normalizePackageRecord(
  packageKind: PackageKind,
  packageName: string,
  providerKey: string,
  raw: Record<string, unknown>,
): NormalizedPackageRecord | null {
  const externalId = asString(raw.external_id);
  if (!externalId) return null;
  const addr = addressParts(raw);
  const latitude = asNumber(raw.lat);
  const longitude = asNumber(raw.lng);
  const specialTags = asStringArray(raw.special_tags);
  const photos = asStringArray(raw.photos);
  if (asString(raw.cover_photo)) photos.push(asString(raw.cover_photo)!);

  return {
    packageKind,
    packageName,
    providerKey,
    externalId,
    listingKind: listingKindFor(packageKind, raw),
    propertyName: asString(raw.property_name) ?? asString(raw.title),
    line1: addr.line1,
    city: addr.city,
    state: addr.state,
    postalCode: addr.postalCode,
    addressKey: normalizeAddressKey(addr.line1, addr.city, addr.state),
    latitude,
    longitude,
    locationPrecision:
      latitude != null && longitude != null ? 'approximate' : 'unknown',
    sourceUrl: asString(raw.source_url) ?? asString(raw.forrent_url),
    sourceUpdatedAt: asString(raw.source_updated_at) ?? asString(raw.hud_record_updated),
    asOf: asString(raw.data_as_of) ?? asString(raw.source_updated_at),
    specialText: asString(raw.special_text),
    specialTags,
    projectedDwelIncentiveUsd: asNumber(raw.dwel_incentive_estimate_usd),
    projectedTotalMoveInSavingsUsd: asNumber(raw.total_move_in_savings_estimate_usd),
    photoUrls: [...new Set(photos)],
    contact: contactFrom(raw, packageKind),
    raw,
    payloadChecksum: checksumPayload(raw),
    rightsStatus: 'unverified',
    unsafeStringHits: collectUnsafeHits(raw),
  };
}

/** Public-safe shape: contacts and package projection math are stripped. */
export function toPublicSafeCandidate(record: NormalizedPackageRecord): Record<string, unknown> {
  return {
    external_id: record.externalId,
    provider_key: record.providerKey,
    listing_kind: record.listingKind,
    property_name: record.propertyName,
    address: {
      line1: record.line1,
      city: record.city,
      state: record.state,
      postal_code: record.postalCode,
    },
    map_location:
      record.latitude != null && record.longitude != null
        ? {
            latitude: Math.round(record.latitude * 100) / 100,
            longitude: Math.round(record.longitude * 100) / 100,
            precision: 'area',
          }
        : null,
    special_text: record.specialText,
    special_tags: record.specialTags,
    rights_status: record.rightsStatus,
    photos_omitted: true,
    contacts_omitted: true,
  };
}

export function assertNoPublicContactLeak(payload: Record<string, unknown>): string[] {
  const leaks: string[] = [];
  for (const key of CONTACT_KEYS) {
    if (key in payload) leaks.push(key);
  }
  const nested = JSON.stringify(payload);
  if (/@"/.test(nested) || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(nested)) {
    leaks.push('email_pattern');
  }
  return leaks;
}
