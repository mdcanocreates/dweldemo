/**
 * Small helpers for marketplace UI preservation rules.
 * Keeps ListingsPage / savings / empty-state decisions testable without remounting React.
 */

export type InventoryTab = 'rentals' | 'directory';

export function shouldShowRentalFilters(input: {
  inventoryTab: InventoryTab;
  catalogErrored: boolean;
}): boolean {
  return !input.catalogErrored && input.inventoryTab === 'rentals';
}

export function shouldShowDirectoryFilters(input: {
  inventoryTab: InventoryTab;
  catalogErrored: boolean;
}): boolean {
  return !input.catalogErrored && input.inventoryTab === 'directory';
}

/** Savings chrome appears only after at least one save and until dismissed. */
export function shouldShowSavingsPanel(input: {
  enabled: boolean;
  savedCount: number;
  dismissed: boolean;
}): boolean {
  return input.enabled && input.savedCount > 0 && !input.dismissed;
}

export type EmptyRentalsMode = 'results' | 'waitlist' | 'no_match';

export function emptyRentalsMode(input: {
  rentalsEmpty: boolean;
  filtersActive: boolean;
}): EmptyRentalsMode {
  if (!input.rentalsEmpty) return 'results';
  return input.filtersActive ? 'no_match' : 'waitlist';
}

export function filtersActive(input: {
  queryApplied: string;
  beds: string;
  baths: string;
  propertyType: string;
  maxRent: string;
}): boolean {
  return Boolean(
    input.queryApplied.trim() ||
      input.beds ||
      input.baths ||
      input.propertyType ||
      input.maxRent,
  );
}
