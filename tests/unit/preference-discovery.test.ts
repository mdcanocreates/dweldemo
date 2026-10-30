import { describe, expect, it } from 'vitest';
import { rankEligibleListings } from '../../src/modules/matching/preference-discovery.js';

const homes = [
  {
    id: 'b',
    available: true,
    rentCents: 180000,
    beds: 2,
    amenityIds: ['parking'],
    regionId: 'austin',
  },
  {
    id: 'a',
    available: true,
    rentCents: 220000,
    beds: 2,
    amenityIds: ['parking', 'laundry'],
    regionId: 'austin',
  },
  {
    id: 'c',
    available: false,
    rentCents: 100000,
    beds: 3,
    amenityIds: ['parking', 'laundry', 'yard'],
    regionId: 'austin',
  },
  {
    id: 'd',
    available: true,
    rentCents: 150000,
    beds: 1,
    amenityIds: ['parking', 'laundry'],
    regionId: 'austin',
  },
  {
    id: 'e',
    available: true,
    rentCents: 160000,
    beds: 2,
    amenityIds: ['parking'],
    regionId: 'dallas',
  },
];

describe('preference discovery', () => {
  it('keeps only homes that meet budget, bedrooms, region, and availability', () => {
    const ranked = rankEligibleListings(
      {
        maxRentCents: 190000,
        minBeds: 2,
        chosenRegionIds: ['austin'],
        desiredAmenityIds: ['parking', 'laundry'],
      },
      homes,
    );
    expect(ranked.map((row) => row.listingId)).toEqual(['b']);
    expect(ranked[0]?.reasons).toContain('Within your budget');
    expect(ranked[0]?.reasons).toContain('Meets your 2-bedroom minimum');
    expect(ranked[0]?.reasons).toContain('Has requested amenity: parking');
    expect(ranked[0]?.reasons).not.toContain('Has requested amenity: laundry');
  });

  it('orders equal eligibility by listing id and ignores screening-like fields', () => {
    const ranked = rankEligibleListings(
      { maxRentCents: 250000, minBeds: 2, desiredAmenityIds: ['parking'] },
      homes.filter((home) => home.available && home.beds >= 2 && home.regionId === 'austin'),
    );
    expect(ranked.map((row) => row.listingId)).toEqual(['a', 'b']);
    expect(ranked.every((row) => row.score === 1)).toBe(true);
  });
});
