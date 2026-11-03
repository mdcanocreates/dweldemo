import { describe, expect, it } from 'vitest';
import {
  emptyRentalsMode,
  filtersActive,
  shouldShowDirectoryFilters,
  shouldShowRentalFilters,
  shouldShowSavingsPanel,
} from '../../web/src/lib/marketplacePreservation.ts';
import { osmRasterStyle } from '../../web/src/lib/osmRasterStyle.ts';

describe('marketplace preservation rules', () => {
  it('keeps rental filters available even when the rental catalog is empty', () => {
    expect(shouldShowRentalFilters({ inventoryTab: 'rentals', catalogErrored: false })).toBe(true);
    expect(shouldShowRentalFilters({ inventoryTab: 'directory', catalogErrored: false })).toBe(false);
    expect(shouldShowRentalFilters({ inventoryTab: 'rentals', catalogErrored: true })).toBe(false);
  });

  it('keeps directory-relevant controls available on the directory tab', () => {
    expect(shouldShowDirectoryFilters({ inventoryTab: 'directory', catalogErrored: false })).toBe(true);
    expect(shouldShowDirectoryFilters({ inventoryTab: 'rentals', catalogErrored: false })).toBe(false);
  });

  it('hides the savings panel until a home is saved and after dismiss', () => {
    expect(shouldShowSavingsPanel({ enabled: true, savedCount: 0, dismissed: false })).toBe(false);
    expect(shouldShowSavingsPanel({ enabled: true, savedCount: 1, dismissed: false })).toBe(true);
    expect(shouldShowSavingsPanel({ enabled: true, savedCount: 1, dismissed: true })).toBe(false);
    expect(shouldShowSavingsPanel({ enabled: false, savedCount: 2, dismissed: false })).toBe(false);
  });

  it('distinguishes waitlist from filter no-match for empty rentals', () => {
    expect(emptyRentalsMode({ rentalsEmpty: false, filtersActive: false })).toBe('results');
    expect(emptyRentalsMode({ rentalsEmpty: true, filtersActive: false })).toBe('waitlist');
    expect(emptyRentalsMode({ rentalsEmpty: true, filtersActive: true })).toBe('no_match');
  });

  it('treats location and structured filters as active search state', () => {
    expect(
      filtersActive({ queryApplied: '', beds: '', baths: '', propertyType: '', maxRent: '' }),
    ).toBe(false);
    expect(
      filtersActive({ queryApplied: 'Austin', beds: '', baths: '', propertyType: '', maxRent: '' }),
    ).toBe(true);
    expect(
      filtersActive({ queryApplied: '', beds: '2', baths: '', propertyType: '', maxRent: '' }),
    ).toBe(true);
    expect(
      filtersActive({ queryApplied: '', beds: '', baths: '', propertyType: '', maxRent: '200000' }),
    ).toBe(true);
  });

  it('returns a stable OSM style object so MapLibre is not remounted each render', () => {
    expect(osmRasterStyle()).toBe(osmRasterStyle());
  });
});
