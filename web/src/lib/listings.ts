import type { Listing, ListingSearchParams, MatchReason, PrequalProfile } from '../types';
import { LISTING_FIXTURES } from './listing-fixtures';
import { loadPrequal } from './user-flow-store';
import { applySearchFilters } from './apply-search-filters';
import { paramsToSearchState } from './search-state';

const BED_LABEL_TO_NUM: Record<string, number> = {
  Studio: 0,
  '1 Bed': 1,
  '2 Beds': 2,
  '3+ Beds': 3,
  studio: 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4+': 3,
};

export function bedsFromLabels(labels: string[]): number[] {
  return labels.map((l) => BED_LABEL_TO_NUM[l]).filter((n) => n !== undefined);
}

export function bedLabel(beds: number): string {
  if (beds <= 0) return 'Studio';
  if (beds >= 3) return '3+ Beds';
  return `${beds} Bed${beds === 1 ? '' : 's'}`;
}

/**
 * Filter listings via canonical SearchState pipeline.
 * Never returns the raw collection as a "fallback" when filters match nothing.
 */
export function filterListings(
  listings: Listing[],
  params: ListingSearchParams,
): { listings: Listing[]; reasonsById: Record<string, MatchReason[]> } {
  const state = paramsToSearchState(params);
  const result = applySearchFilters(listings, state);
  return { listings: result.listings, reasonsById: result.reasonsById };
}

export function prefsToSearchParams(prefs: PrequalProfile): ListingSearchParams {
  return {
    location: prefs.current_city,
    beds: bedsFromLabels(prefs.bedrooms),
    price_min: prefs.budget_min_cents,
    price_max: prefs.budget_max_cents,
    available_after: prefs.target_move_in_date || undefined,
    pet_friendly: prefs.has_pets || undefined,
  };
}

export function loadOnboardingPrefs(): PrequalProfile | null {
  return loadPrequal();
}

export function getAllListings(): Listing[] {
  return LISTING_FIXTURES;
}

export function getListingById(id: string): Listing | undefined {
  return LISTING_FIXTURES.find((l) => l.id === id);
}
