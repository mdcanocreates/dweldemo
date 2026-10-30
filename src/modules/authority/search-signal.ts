export type ProgramSearchContext = {
  bedroomPreference?: number;
  grossRentPreferenceCents?: number;
  desiredAreas?: string[];
  agencyPublishedInfo?: {
    referenceVersion: string;
    referenceDate: string;
    publishedReferenceCents?: number;
  };
};

export type SearchListing = {
  id: string;
  available: boolean;
  bedrooms: number;
  advertisedGrossRentCents?: number;
  areaId: string;
};

export type PreliminarySignal = {
  label: 'unavailable' | 'preference_mismatch' | 'needs_review' | 'outside_preference' | 'promising_to_explore';
  reason: string;
};

/** Preference hint only. Assistance status is not an input and cannot hide a listing. */
export function preliminarySignal(
  listing: SearchListing,
  ctx: ProgramSearchContext,
): PreliminarySignal {
  if (!listing.available) return { label: 'unavailable', reason: 'Listing not currently available' };
  if (ctx.bedroomPreference !== undefined && listing.bedrooms < ctx.bedroomPreference) {
    return { label: 'preference_mismatch', reason: 'Below requested bedroom count' };
  }
  if (listing.advertisedGrossRentCents === undefined) {
    return { label: 'needs_review', reason: 'Gross rent information incomplete' };
  }
  if (
    ctx.grossRentPreferenceCents !== undefined &&
    listing.advertisedGrossRentCents > ctx.grossRentPreferenceCents
  ) {
    return { label: 'outside_preference', reason: 'Above renter-selected search price' };
  }
  return {
    label: 'promising_to_explore',
    reason: 'Matches selected search preferences; agency review required',
  };
}

export function publicInventoryUnchanged<T extends { id: string }>(
  listings: readonly T[],
  signaled: readonly T[],
): boolean {
  return listings.length === signaled.length && listings.every((row, index) => row.id === signaled[index]?.id);
}
