import { describe, expect, it } from 'vitest';
import { mapApiListing, resolveCashbackCents } from './map-listing';

describe('resolveCashbackCents', () => {
  it('prefers cashback_cents', () => {
    expect(
      resolveCashbackCents({
        cashback_cents: 56_000,
        incentive_cents: 10_000,
        renter_cashback_cents: 20_000,
      }),
    ).toBe(56_000);
  });

  it('falls back to renter_cashback_cents then incentive_cents', () => {
    expect(resolveCashbackCents({ renter_cashback_cents: 43_000 })).toBe(43_000);
    expect(resolveCashbackCents({ incentive_cents: 12_000 })).toBe(12_000);
  });

  it('hides missing or non-positive amounts', () => {
    expect(resolveCashbackCents({})).toBeNull();
    expect(resolveCashbackCents({ cashback_cents: 0 })).toBeNull();
    expect(resolveCashbackCents({ cashback_cents: -1 })).toBeNull();
  });
});

describe('mapApiListing cashback', () => {
  it('maps cashback_cents and deposit_cents from API', () => {
    const listing = mapApiListing({
      id: 'a1000000-0000-4000-8000-000000000001',
      rent_amount_cents: 260_000,
      deposit_cents: 130_000,
      cashback_cents: 56_000,
      city: 'Austin',
      state: 'TX',
      address: { line1: '123 Drury Lane', city: 'Austin', state: 'TX' },
    });
    expect(listing?.cashback_cents).toBe(56_000);
    expect(listing?.deposit_cents).toBe(130_000);
  });

  it('omits cashback when API field absent', () => {
    const listing = mapApiListing({
      id: 'a1000000-0000-4000-8000-000000000002',
      rent_amount_cents: 200_000,
      city: 'Austin',
      state: 'TX',
    });
    expect(listing?.cashback_cents).toBeNull();
  });
});
