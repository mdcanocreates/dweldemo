import { describe, expect, it } from 'vitest';
import { applySearchFilters } from './apply-search-filters';
import { LISTING_FIXTURES } from './listing-fixtures';
import { resolveLocationInput } from './search-state';
import type { SearchState } from './search-state';

function state(partial: SearchState): SearchState {
  return partial;
}

describe('applySearchFilters', () => {
  it('Test 1: Austin, TX excludes other cities', () => {
    const { listings } = applySearchFilters(
      LISTING_FIXTURES,
      state({ location: resolveLocationInput('Austin, TX') }),
    );
    expect(listings.length).toBeGreaterThan(0);
    expect(listings.every((l) => l.city === 'Austin' && l.state === 'TX')).toBe(true);
    expect(listings.some((l) => l.city === 'Houston')).toBe(false);
    expect(listings.some((l) => l.city === 'Orlando')).toBe(false);
    expect(listings.some((l) => l.city === 'San Francisco')).toBe(false);
  });

  it('Test 2: Florida returns only FL listings', () => {
    const { listings } = applySearchFilters(
      LISTING_FIXTURES,
      state({ location: resolveLocationInput('Florida') }),
    );
    expect(listings.length).toBeGreaterThan(0);
    expect(listings.every((l) => l.state === 'FL')).toBe(true);
    expect(listings.some((l) => l.state === 'TX')).toBe(false);
    expect(listings.some((l) => l.state === 'CA')).toBe(false);
  });

  it('Test 3: Austin + Baths 3+ returns only baths >= 3 (or empty)', () => {
    const { listings } = applySearchFilters(
      LISTING_FIXTURES,
      state({
        location: resolveLocationInput('Austin, TX'),
        baths: ['3+'],
      }),
    );
    expect(listings.every((l) => l.city === 'Austin')).toBe(true);
    expect(listings.every((l) => l.baths >= 3)).toBe(true);
    // Demo inventory currently has no Austin 3+ baths — empty is correct
    expect(listings.length).toBe(0);
  });

  it('Test 3b: Austin + Baths 3+ never fills with unrelated homes', () => {
    const { listings } = applySearchFilters(
      LISTING_FIXTURES,
      state({
        location: resolveLocationInput('Austin, TX'),
        baths: ['3+'],
      }),
    );
    expect(listings.some((l) => l.city !== 'Austin')).toBe(false);
    expect(listings.length).toBe(0);
  });

  it('Test 4: Austin + Pet friendly', () => {
    const { listings } = applySearchFilters(
      LISTING_FIXTURES,
      state({
        location: resolveLocationInput('Austin, TX'),
        petFriendly: true,
      }),
    );
    expect(listings.length).toBeGreaterThan(0);
    expect(listings.every((l) => l.city === 'Austin' && l.pet_friendly)).toBe(true);
  });

  it('Test 5: Austin + Parking', () => {
    const { listings } = applySearchFilters(
      LISTING_FIXTURES,
      state({
        location: resolveLocationInput('Austin, TX'),
        parking: true,
      }),
    );
    expect(listings.length).toBeGreaterThan(0);
    expect(listings.every((l) => l.city === 'Austin' && l.parking)).toBe(true);
  });

  it('Test 6: Austin + Move-in incentive', () => {
    const { listings } = applySearchFilters(
      LISTING_FIXTURES,
      state({
        location: resolveLocationInput('Austin, TX'),
        incentiveAvailable: true,
      }),
    );
    expect(listings.length).toBeGreaterThan(0);
    expect(listings.every((l) => l.city === 'Austin' && l.concession_available)).toBe(true);
  });

  it('Test 7: Austin + maxRent=1900', () => {
    const { listings } = applySearchFilters(
      LISTING_FIXTURES,
      state({
        location: resolveLocationInput('Austin, TX'),
        maxRent: 1900,
      }),
    );
    expect(listings.length).toBeGreaterThan(0);
    expect(listings.every((l) => l.city === 'Austin' && l.rent_cents / 100 <= 1900)).toBe(true);
  });

  it('Test 8: combined intersection (not union)', () => {
    const { listings } = applySearchFilters(
      LISTING_FIXTURES,
      state({
        location: resolveLocationInput('Austin, TX'),
        beds: ['2'],
        baths: ['2'],
        petFriendly: true,
        parking: true,
        maxRent: 2500,
      }),
    );
    for (const l of listings) {
      expect(l.city).toBe('Austin');
      expect(l.beds).toBe(2);
      expect(l.baths).toBeGreaterThanOrEqual(2);
      expect(l.pet_friendly).toBe(true);
      expect(l.parking).toBe(true);
      expect(l.rent_cents / 100).toBeLessThanOrEqual(2500);
    }
  });

  it('Test 9: no match → empty, never full inventory', () => {
    const { listings } = applySearchFilters(
      LISTING_FIXTURES,
      state({
        location: resolveLocationInput('Austin, TX'),
        beds: ['2'],
        baths: ['3+'],
        maxRent: 100,
      }),
    );
    expect(listings.length).toBe(0);
    expect(listings.length).not.toBe(LISTING_FIXTURES.length);
  });

  it('city search does not match on state alone', () => {
    const { listings } = applySearchFilters(
      LISTING_FIXTURES,
      state({
        location: {
          label: 'Austin, TX',
          type: 'city',
          city: 'Austin',
          state: 'TX',
        },
      }),
    );
    expect(listings.every((l) => l.city === 'Austin')).toBe(true);
  });
});
