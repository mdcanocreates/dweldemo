import type { Listing } from '../api';

/**
 * Client-side guard for obviously fictional / sandbox inventory.
 * Avoid bare "demo" — HUD program codes like "811 PRA DEMO" are real directory records.
 */
const FICTIONAL_RE =
  /\b(fake|mock|imaginary|phantom|sample|placeholder|test listing|illusion|mirage|make-believe|makebelieve|pretend|fable|storybook|sandbox|phase\s*4\s*seed|phase4\s*seed|drury\s*ln|drury\s*lane|dev sandbox|fake oaks|fake horizon)\b/i;

export function looksFictionalListing(listing: Listing): boolean {
  const haystack = [
    listing.property_name,
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

export function isDirectoryListing(listing: Listing): boolean {
  return listing.inventory_kind === 'directory';
}

export function isRentalListing(listing: Listing): boolean {
  return !isDirectoryListing(listing) && !looksFictionalListing(listing);
}

export function publishablePublicListings(listings: Listing[]): Listing[] {
  return listings.filter((listing) => !looksFictionalListing(listing));
}

export function partitionPublicInventory(listings: Listing[]): {
  rentals: Listing[];
  directory: Listing[];
} {
  const publishable = publishablePublicListings(listings);
  return {
    rentals: publishable.filter((listing) => !isDirectoryListing(listing)),
    directory: publishable.filter((listing) => isDirectoryListing(listing)),
  };
}
