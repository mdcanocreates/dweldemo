import { describe, expect, it } from 'vitest';
import { listingPublishGaps, parsePublicListingQuery, isSafeListingMediaUrl } from '../../src/modules/listings/public.js';
import { frozenListingFromSnapshot, presentListingCard } from '../../src/modules/renter/listing-history.js';

describe('public listing query', () => {
  it('rejects an unknown sort and keeps the default order name', () => {
    expect(parsePublicListingQuery(new URLSearchParams('limit=5&offset=10')).sort).toBe('newest');
    expect(() => parsePublicListingQuery(new URLSearchParams('sort=score'))).toThrow(/invalid sort/);
  });

  it('accepts only https media urls without credentials', () => {
    expect(isSafeListingMediaUrl('https://cdn.example/a.jpg')).toBe(true);
    expect(isSafeListingMediaUrl('http://cdn.example/a.jpg')).toBe(false);
    expect(isSafeListingMediaUrl('https://user:pass@cdn.example/a.jpg')).toBe(false);
    expect(isSafeListingMediaUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('listing publish gaps', () => {
  const ready = {
    rentAmountCents: 150000,
    line1: '10 Main St',
    city: 'Austin',
    state: 'TX',
    postalCode: '78701',
    bedrooms: 2,
    propertyType: 'residential',
    availableOn: '2026-11-01',
    orgStatus: 'active',
    claimStatus: 'claimed',
    hasAuthorizedLandlord: true,
    propertyAuthorityVerified: true,
  };

  it('accepts a complete authorized listing', () => {
    expect(listingPublishGaps(ready)).toEqual([]);
  });

  it('names each missing inventory fact', () => {
    expect(
      listingPublishGaps({
        ...ready,
        rentAmountCents: 0,
        city: null,
        bedrooms: null,
        availableOn: null,
        claimStatus: 'pending',
        hasAuthorizedLandlord: false,
        propertyAuthorityVerified: false,
      }),
    ).toEqual([
      'pricing',
      'location',
      'property_details',
      'availability',
      'organization',
      'property_authority',
      'authorization',
    ]);
  });
});

describe('historical listing card', () => {
  it('keeps the submitted address when the live row changes and keeps the live status', () => {
    const snapshot = {
      listing: { line1: '10 Old St', city: 'Austin', state: 'TX', postal_code: '78701', rent_amount_cents: 100000 },
    };
    const shown = presentListingCard(
      {
        line1: '99 New St',
        city: 'Dallas',
        state: 'TX',
        postal_code: '75201',
        property_type: 'residential',
        rent_amount_cents: 200000,
        status: 'paused',
        thumbnail_url: null,
      },
      snapshot,
    );
    expect(shown.line1).toBe('10 Old St');
    expect(shown.rent_amount_cents).toBe(100000);
    expect(shown.status).toBe('paused');
    expect(frozenListingFromSnapshot(null)).toBeNull();
  });
});
