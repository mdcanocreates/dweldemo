import type { Listing } from '../api';

/**
 * Client-side guard for obviously fictional seed inventory while Aurora
 * still lacks `listing.is_demo` (migration 0077). Does not delete records.
 * Prefer server-side `is_demo` once that migration is applied.
 */
const FICTIONAL_RE =
  /\b(fake|mock|imaginary|phantom|demo|sample|placeholder|test listing)\b/i;

export function looksFictionalListing(listing: Listing): boolean {
  const haystack = [
    listing.address?.line1,
    listing.address?.line2,
    listing.address?.raw_input,
    listing.address?.city,
    listing.description,
  ]
    .filter(Boolean)
    .join(' ');
  return FICTIONAL_RE.test(haystack);
}

export function publishablePublicListings(listings: Listing[]): Listing[] {
  return listings.filter((listing) => !looksFictionalListing(listing));
}
