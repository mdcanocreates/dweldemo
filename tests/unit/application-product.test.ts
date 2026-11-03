import { describe, expect, it } from 'vitest';
import { calculateApplicationSavings } from '../../src/modules/renter/application-savings.js';

describe('renter $49 application product vs provider fee', () => {
  it('subtracts a single Dwel application fee from eligible homes only', () => {
    const estimate = calculateApplicationSavings(
      [
        { listingId: 'a', eligibleForReuse: true, applicationFeeCents: 5000 },
        { listingId: 'b', eligibleForReuse: true, applicationFeeCents: 5000 },
        { listingId: 'c', eligibleForReuse: false, applicationFeeCents: 9900 },
      ],
      4900,
    );
    expect(estimate).toEqual({
      eligibleHomes: 2,
      baselineFeesCents: 10000,
      dwelFeesCents: 4900,
      estimatedSavingsCents: 5100,
      completeEstimate: true,
    });
  });

  it('never treats provider listing fees as the renter product', () => {
    const estimate = calculateApplicationSavings(
      [{ listingId: 'a', eligibleForReuse: true, applicationFeeCents: 9900 }],
      4900,
    );
    expect(estimate?.dwelFeesCents).toBe(4900);
    expect(estimate?.estimatedSavingsCents).toBe(5000);
  });
});
