import type { Listing, ListingStatus } from '../types';
import { LISTING_FIXTURES } from './listing-fixtures';
import { rsLookup } from './money';

const KEY = 'dwel.landlord.listings.v1';

export type LandlordListing = Listing & {
  landlord_owned: true;
  rs_tier: string;
};

function seed(): LandlordListing[] {
  return LISTING_FIXTURES.slice(0, 2).map((l) => ({
    ...l,
    id: `own_${l.id}`,
    landlord_owned: true as const,
    status: 'DRAFT' as ListingStatus,
    rs_tier: rsLookup(l.rent_cents),
  }));
}

export function loadLandlordListings(): LandlordListing[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as LandlordListing[];
  } catch {
    /* ignore */
  }
  const seeded = seed();
  saveLandlordListings(seeded);
  return seeded;
}

export function saveLandlordListings(listings: LandlordListing[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(listings));
  } catch {
    /* ignore */
  }
}

export function createLandlordListing(
  input: Omit<LandlordListing, 'id' | 'landlord_owned' | 'rs_tier' | 'status' | 'photos'> & {
    photos?: string[];
  },
): LandlordListing {
  const listing: LandlordListing = {
    ...input,
    id: `lst_${Date.now()}`,
    photos: input.photos ?? [],
    status: 'DRAFT',
    landlord_owned: true,
    rs_tier: rsLookup(input.rent_cents),
  };
  const all = loadLandlordListings();
  all.unshift(listing);
  saveLandlordListings(all);
  return listing;
}

export function updateLandlordListing(
  id: string,
  patch: Partial<LandlordListing>,
): LandlordListing | null {
  const all = loadLandlordListings();
  const idx = all.findIndex((l) => l.id === id);
  if (idx < 0) return null;
  const next = {
    ...all[idx],
    ...patch,
    rs_tier: rsLookup(patch.rent_cents ?? all[idx].rent_cents),
  };
  all[idx] = next;
  saveLandlordListings(all);
  return next;
}
