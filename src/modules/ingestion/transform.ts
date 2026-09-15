import { createHash } from 'node:crypto';
import type { CanonicalListingFields } from './types.js';

export type TransformResult =
  | { ok: true; fields: CanonicalListingFields }
  | { ok: false; reason: string };

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function valueHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Apply mapping_profile field_map. Currency-scale heuristic:
 * values that look like dollars (< 10000 without being already large cents)
 * are converted to cents. Median-shift gate catches systematic mis-scale.
 */
export function transformRecord(
  payload: Record<string, unknown>,
  fieldMap: Record<string, string>,
  opts?: {
    forceCentsScale?: 'auto' | 'cents' | 'dollars';
    valueMaps?: Record<string, unknown>;
  },
): TransformResult {
  const scale =
    opts?.forceCentsScale ??
    (opts?.valueMaps?.rent_scale as 'auto' | 'cents' | 'dollars' | undefined) ??
    'auto';

  const get = (canonical: string): unknown => {
    const src = fieldMap[canonical];
    if (!src) return payload[canonical];
    // Support dotted paths lightly
    if (src.includes('.')) {
      const parts = src.split('.');
      let cur: unknown = payload;
      for (const p of parts) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[p];
      }
      return cur;
    }
    return payload[src] ?? payload[canonical];
  };

  const externalId = String(get('external_id') ?? payload.external_id ?? payload.id ?? '').trim();
  const addressRaw = String(get('address') ?? get('address_raw') ?? '').trim();
  const rentRaw = get('rent_amount_cents') ?? get('rent') ?? get('ListPrice');
  let rentAmountCents: number | null = null;

  if (typeof rentRaw === 'number') {
    rentAmountCents = scaleRent(rentRaw, scale);
  } else if (typeof rentRaw === 'string' && rentRaw.trim()) {
    const n = Number(rentRaw.replace(/[$,]/g, ''));
    if (!Number.isFinite(n)) {
      return { ok: false, reason: 'invalid_rent' };
    }
    rentAmountCents = scaleRent(n, scale);
  }

  if (!externalId) return { ok: false, reason: 'missing_external_id' };
  if (!addressRaw) return { ok: false, reason: 'missing_address' };
  if (rentAmountCents == null) return { ok: false, reason: 'missing_rent' };

  const unitCountRaw = get('unit_count');
  const unitCount =
    typeof unitCountRaw === 'number'
      ? unitCountRaw
      : unitCountRaw != null
        ? Number(unitCountRaw)
        : null;

  const statusRaw = get('source_status_raw') ?? get('StandardStatus') ?? get('status');
  const mappedStatus = mapStatus(statusRaw);

  const mediaRaw = get('media_urls') ?? get('photos') ?? get('Media');
  let mediaUrls: string[] | undefined;
  if (Array.isArray(mediaRaw)) {
    mediaUrls = mediaRaw.map(String);
  } else if (typeof mediaRaw === 'string' && mediaRaw) {
    mediaUrls = [mediaRaw];
  }

  return {
    ok: true,
    fields: {
      externalId,
      addressRaw,
      rentAmountCents,
      depositCents: get('deposit_cents') != null ? Number(get('deposit_cents')) : null,
      bedrooms: get('bedrooms') != null ? Number(get('bedrooms')) : null,
      bathrooms: get('bathrooms') != null ? Number(get('bathrooms')) : null,
      sqft: get('sqft') != null ? Number(get('sqft')) : null,
      availableOn: get('available_on') != null ? String(get('available_on')) : null,
      leaseTermMonths: get('lease_term_months') != null ? Number(get('lease_term_months')) : null,
      description: get('description') != null ? String(get('description')) : null,
      mappedStatus,
      sourceStatusRaw: statusRaw != null ? String(statusRaw) : null,
      isDpvConfirmed: get('is_dpv_confirmed') === false ? false : true,
      unitCount: Number.isFinite(unitCount) ? unitCount : null,
      mediaUrls,
    },
  };
}

function scaleRent(n: number, scale: 'auto' | 'cents' | 'dollars'): number {
  if (scale === 'cents') return Math.round(n);
  if (scale === 'dollars') return Math.round(n * 100);
  // auto: < 10000 treated as dollars (covers typical rents); larger as cents
  return n < 10000 ? Math.round(n * 100) : Math.round(n);
}

function mapStatus(raw: unknown): 'active' | 'pending' | 'delisted' | 'rented' {
  const s = String(raw ?? 'active').toLowerCase();
  if (['closed', 'sold', 'rented', 'leased', 'off_market'].includes(s)) return 'rented';
  if (['withdrawn', 'expired', 'canceled', 'cancelled', 'deleted', 'delisted', 'inactive'].includes(s)) {
    return 'delisted';
  }
  if (['pending', 'under_contract', 'coming_soon'].includes(s)) return 'pending';
  return 'active';
}

export const DEFAULT_FIELD_MAP: Record<string, string> = {
  external_id: 'external_id',
  address: 'address',
  rent_amount_cents: 'rent_amount_cents',
  deposit_cents: 'deposit_cents',
  bedrooms: 'bedrooms',
  bathrooms: 'bathrooms',
  sqft: 'sqft',
  available_on: 'available_on',
  lease_term_months: 'lease_term_months',
  description: 'description',
  unit_count: 'unit_count',
  is_dpv_confirmed: 'is_dpv_confirmed',
  source_status_raw: 'StandardStatus',
  media_urls: 'media_urls',
};
