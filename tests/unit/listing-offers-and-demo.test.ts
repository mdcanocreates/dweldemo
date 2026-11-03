import { describe, expect, it } from 'vitest';
import { parseOfferType } from '../../src/modules/external-listings/normalize.js';
import { calculateApplicationSavings } from '../../src/modules/renter/application-savings.js';

describe('verified offer labels', () => {
  it('keeps eight weeks free as weeks_free, not a cashback percent', () => {
    expect(parseOfferType('8 weeks free', ['8 weeks free'])).toBe('weeks_free');
    expect(parseOfferType('6 weeks free', [])).toBe('weeks_free');
    expect(parseOfferType('$500 move-in credit', [])).toBe('dollar_credit');
  });
});

describe('saved-home savings eligibility', () => {
  it('ignores saved homes that are not reusable-application eligible', () => {
    const estimate = calculateApplicationSavings(
      [
        { listingId: 'a', eligibleForReuse: true, applicationFeeCents: 5000 },
        { listingId: 'b', eligibleForReuse: false, applicationFeeCents: 5000 },
      ],
      2900,
    );
    expect(estimate?.eligibleHomes).toBe(1);
    expect(estimate?.estimatedSavingsCents).toBe(2100);
  });
});
