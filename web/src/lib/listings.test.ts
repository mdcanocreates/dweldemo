import { describe, expect, it } from 'vitest';
import { filterListings, bedsFromLabels } from './listings';
import { LISTING_FIXTURES } from './listing-fixtures';
import type { Listing } from '../types';
import {
  buildSearchUrl,
  parseSearchState,
  resolveLocationInput,
  searchStateToParams,
} from './search-state';

describe('filterListings fair housing', () => {
  it('filters only on permitted fields', () => {
    const { listings, reasonsById } = filterListings(LISTING_FIXTURES, {
      location: 'Austin',
      beds: [1],
      price_max: 200_000,
    });
    expect(listings.every((l: Listing) => l.city === 'Austin')).toBe(true);
    expect(listings.every((l: Listing) => l.beds === 1)).toBe(true);
    expect(listings.every((l: Listing) => l.rent_cents <= 200_000)).toBe(true);
    for (const id of Object.keys(reasonsById)) {
      for (const reason of reasonsById[id]) {
        expect([
          'beds',
          'city',
          'state',
          'rent',
          'available_after',
          'pet_friendly',
          'parking',
        ]).toContain(reason.field);
      }
    }
  });

  it('filters by state without forcing a city', () => {
    const { listings } = filterListings(
      LISTING_FIXTURES,
      searchStateToParams({
        location: resolveLocationInput('Florida'),
      }),
    );
    expect(listings.length).toBeGreaterThan(0);
    expect(listings.every((l) => l.state === 'FL')).toBe(true);
    expect(new Set(listings.map((l) => l.city)).size).toBeGreaterThan(1);
  });

  it('filters by county', () => {
    const { listings } = filterListings(
      LISTING_FIXTURES,
      searchStateToParams({
        location: resolveLocationInput('Palm Beach County, FL'),
      }),
    );
    expect(listings.length).toBeGreaterThan(0);
    expect(listings.every((l) => l.county === 'Palm Beach County')).toBe(true);
  });

  it('does not expose income as a filter key', () => {
    const keys = Object.keys({
      location: 'x',
      beds: [1],
      price_min: 0,
      price_max: 1,
      available_after: '2026-01-01',
      pet_friendly: true,
      parking: true,
    });
    expect(keys).not.toContain('income');
    expect(keys).not.toContain('credit');
  });

  it('maps bed labels', () => {
    expect(bedsFromLabels(['Studio', '2 Beds'])).toEqual([0, 2]);
  });
});

describe('search state URL round-trip', () => {
  it('preserves Austin city search', () => {
    const state = parseSearchState(
      'location=Austin%2C%20TX&locationType=city&state=TX&city=Austin',
    );
    expect(state.location?.label).toBe('Austin, TX');
    expect(state.location?.type).toBe('city');
    expect(buildSearchUrl(state)).toContain('location=Austin');
    expect(buildSearchUrl(state)).toContain('/search?');
  });

  it('resolves free-text Florida to state', () => {
    const loc = resolveLocationInput('Florida');
    expect(loc?.type).toBe('state');
    expect(loc?.state).toBe('FL');
  });

  it('parses beds and maxRent without leaving /search', () => {
    const state = parseSearchState('location=Austin%2C%20TX&beds=2&maxRent=2400');
    expect(state.beds).toEqual(['2']);
    expect(state.maxRent).toBe(2400);
    expect(buildSearchUrl(state).startsWith('/search')).toBe(true);
  });
});
