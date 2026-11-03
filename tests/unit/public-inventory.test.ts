import { describe, expect, it } from 'vitest';
import { looksFictionalListing, publishablePublicListings } from '../../web/src/lib/publicInventory';
import type { Listing } from '../../web/src/api';

function listing(partial: Partial<Listing> & { line1: string }): Listing {
  return {
    id: partial.id ?? '1',
    rent_amount_cents: 100000,
    deposit_cents: null,
    bedrooms: '1',
    bathrooms: '1',
    sqft: null,
    property_type: 'apartment',
    available_on: null,
    lease_term_months: null,
    description: partial.description ?? null,
    cashback_cents: null,
    media: [],
    address: {
      line1: partial.line1,
      line2: null,
      city: 'Austin',
      state: 'TX',
      postal_code: '78701',
      raw_input: partial.line1 + ', Austin, TX 78701',
    },
  } as Listing;
}

describe('publicInventory fiction filter', () => {
  it('hides Fake/Mock/Imaginary and storybook seed addresses', () => {
    expect(looksFictionalListing(listing({ line1: '1200 Fake Cedar Ln' }))).toBe(true);
    expect(looksFictionalListing(listing({ line1: '800 Mock Bayou St' }))).toBe(true);
    expect(looksFictionalListing(listing({ line1: '1 Imaginary Ave' }))).toBe(true);
    expect(looksFictionalListing(listing({ line1: '301 Illusion Ave' }))).toBe(true);
    expect(looksFictionalListing(listing({ line1: '42 Make-believe Blvd' }))).toBe(true);
    expect(looksFictionalListing(listing({ line1: '100 Dev Sandbox Ave' }))).toBe(true);
  });

  it('keeps ordinary addresses', () => {
    expect(looksFictionalListing(listing({ line1: '500 Congress Ave' }))).toBe(false);
  });

  it('filters publishable lists', () => {
    const out = publishablePublicListings([
      listing({ id: 'a', line1: '1200 Fake Cedar Ln' }),
      listing({ id: 'b', line1: '500 Congress Ave' }),
    ]);
    expect(out.map((row) => row.id)).toEqual(['b']);
  });
});
