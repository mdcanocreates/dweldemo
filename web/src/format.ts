export function moneyFromCents(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(Number(cents))) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(cents) / 100);
}

export function moneyFromDollars(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

const SMALL = new Set(['of', 'and', 'the', 'a', 'an', 'to', 'for', 'in', 'on', 'at', 'by']);

/** Title-case a string; keeps short US state codes uppercase when standalone 2 letters. */
export function toTitleCase(raw: string | null | undefined): string {
  if (!raw) return '';
  const parts = raw.trim().split(/\s+/);
  return parts
    .map((word, i) => {
      if (/^\d+$/.test(word)) return word;
      const lower = word.toLowerCase();
      // Standalone 2-letter token near the end → likely a state code
      if (/^[a-z]{2}$/.test(lower) && i >= parts.length - 2) return lower.toUpperCase();
      if (i > 0 && SMALL.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

export function formatPersonName(
  given: string | null | undefined,
  family?: string | null | undefined,
): string {
  const parts = [given, family].filter(Boolean).map((p) => toTitleCase(String(p)));
  return parts.join(' ').trim() || 'Applicant';
}

export function formatBedsBaths(
  bedrooms: number | string | null,
  bathrooms: number | string | null,
): string {
  const beds = bedrooms == null || bedrooms === '' ? null : Number(bedrooms);
  const baths = bathrooms == null || bathrooms === '' ? null : Number(bathrooms);
  const parts: string[] = [];
  if (beds != null && !Number.isNaN(beds)) parts.push(`${beds} bed`);
  if (baths != null && !Number.isNaN(baths)) parts.push(`${baths} bath`);
  return parts.join(' · ') || 'Layout not listed';
}

export function formatAddress(listing: {
  address: {
    line1: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    raw_input: string | null;
  };
}): string {
  const a = listing.address;
  if (a.line1 && a.city && a.state) {
    const line = toTitleCase(a.line1);
    const city = toTitleCase(a.city);
    const state = a.state.length === 2 ? a.state.toUpperCase() : toTitleCase(a.state);
    return `${line}, ${city}, ${state}${a.postal_code ? ` ${a.postal_code}` : ''}`;
  }
  if (a.city && a.state) {
    const city = toTitleCase(a.city);
    const state = a.state.length === 2 ? a.state.toUpperCase() : toTitleCase(a.state);
    return `${city}, ${state}`;
  }
  return a.raw_input ? toTitleCase(a.raw_input) : 'Address on request';
}

export function titleCaseType(type: string | null | undefined): string | null {
  if (!type) return null;
  return toTitleCase(type.replace(/_/g, ' '));
}
