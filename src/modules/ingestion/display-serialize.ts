/**
 * §6A.2 / D-11 — Display-rule enforcement layer.
 * Rule CONTENT per partner is gated (D-11); only TEST_ONLY seeds in tests.
 * Serializers must call this — never scatter suppression in views.
 */

export type SourceDisplayRule = {
  id?: string;
  name: string;
  version: string;
  isAttributionRequired: boolean;
  attributionText: string | null;
  suppressFields: string[];
  showExactAddress: boolean;
  mediaPolicy: 'host' | 'hotlink' | 'none';
  maxCacheAgeSeconds: number | null;
  purgeOnDelistHours: number | null;
};

export type ListingApiShape = {
  id: string;
  rent_amount_cents: number;
  deposit_cents?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  available_on?: string | null;
  lease_term_months?: number | null;
  description?: string | null;
  address?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    raw_input?: string | null;
  } | null;
  attribution?: string | null;
  media?: Array<{ url: string }> | null;
  [key: string]: unknown;
};

export function serializeListingForApi(
  listing: ListingApiShape,
  rule: SourceDisplayRule | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...listing };

  if (!rule) {
    return out;
  }

  for (const field of rule.suppressFields) {
    delete out[field];
    if (out.address && typeof out.address === 'object') {
      delete (out.address as Record<string, unknown>)[field];
    }
  }

  if (!rule.showExactAddress && out.address && typeof out.address === 'object') {
    const addr = { ...(out.address as Record<string, unknown>) };
    delete addr.line1;
    delete addr.line2;
    delete addr.raw_input;
    delete addr.postal_code;
    // Keep coarse locality only.
    out.address = {
      city: addr.city ?? null,
      state: addr.state ?? null,
    };
    out.exact_address_suppressed = true;
  }

  if (rule.isAttributionRequired) {
    out.attribution = rule.attributionText;
  }

  if (rule.mediaPolicy === 'none') {
    delete out.media;
  }

  return out;
}

/** Assert helper for tests — returns leaked field names. */
export function findDisplayLeaks(
  serialized: Record<string, unknown>,
  rule: SourceDisplayRule,
): string[] {
  const leaks: string[] = [];
  for (const f of rule.suppressFields) {
    if (f in serialized) leaks.push(f);
    const addr = serialized.address as Record<string, unknown> | undefined;
    if (addr && f in addr) leaks.push(`address.${f}`);
  }
  if (!rule.showExactAddress) {
    const addr = serialized.address as Record<string, unknown> | undefined;
    if (addr?.line1 || addr?.line2 || addr?.raw_input || addr?.postal_code) {
      leaks.push('exact_address');
    }
  }
  return leaks;
}
