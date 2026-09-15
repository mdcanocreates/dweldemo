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
    return `${a.line1}, ${a.city}, ${a.state}${a.postal_code ? ` ${a.postal_code}` : ''}`;
  }
  if (a.city && a.state) return `${a.city}, ${a.state}`;
  return a.raw_input || 'Address on request';
}

export function titleCaseType(type: string | null | undefined): string | null {
  if (!type) return null;
  return type.replace(/_/g, ' ');
}
