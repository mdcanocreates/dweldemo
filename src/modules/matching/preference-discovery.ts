/**
 * Property discovery for a renter's explicit preferences.
 * This is not applicant scoring. It does not read income, screening, badge
 * state, or protected characteristics. The existing listing_renter_match and
 * rules_based_v1 scores stay in place for their current callers.
 */

export type DiscoveryPreferences = {
  maxRentCents?: number;
  minBeds?: number;
  desiredAmenityIds?: readonly string[];
  chosenRegionIds?: readonly string[];
};

export type DiscoveryListing = {
  id: string;
  available: boolean;
  rentCents: number;
  beds: number;
  amenityIds: readonly string[];
  regionId: string;
};

export type DiscoveryMatch = {
  listingId: string;
  score: number;
  reasons: string[];
};

export function rankEligibleListings(
  preferences: DiscoveryPreferences,
  listings: readonly DiscoveryListing[],
): DiscoveryMatch[] {
  const requiredAmenities = preferences.desiredAmenityIds ?? [];
  const regions = preferences.chosenRegionIds ?? [];
  const eligible = listings.filter((listing) => {
    if (!listing.available) return false;
    if (
      preferences.maxRentCents != null &&
      listing.rentCents > preferences.maxRentCents
    ) {
      return false;
    }
    if (preferences.minBeds != null && listing.beds < preferences.minBeds) return false;
    if (regions.length > 0 && !regions.includes(listing.regionId)) return false;
    return true;
  });

  return eligible
    .map((listing) => {
      const matched = requiredAmenities.filter((amenity) =>
        listing.amenityIds.includes(amenity),
      );
      const reasons = [
        preferences.maxRentCents != null ? 'Within your budget' : null,
        preferences.minBeds != null ? `Meets your ${preferences.minBeds}-bedroom minimum` : null,
        regions.length > 0 ? 'In a region you selected' : null,
        ...matched.map((amenity) => `Has requested amenity: ${amenity}`),
        'Meets your selected search criteria',
      ].filter((reason): reason is string => Boolean(reason));
      return { listingId: listing.id, score: matched.length, reasons };
    })
    .sort((a, b) => b.score - a.score || a.listingId.localeCompare(b.listingId));
}
