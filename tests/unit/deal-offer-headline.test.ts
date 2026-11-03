import { describe, expect, it } from 'vitest';
import { buildPropertyOffer, offerHeadline } from '../../src/modules/external-listings/offer-headline.js';

describe('deal offer headline + pipeline shape', () => {
  it('extracts weeks-free headlines from source special_text', () => {
    expect(
      offerHeadline(
        'Call now for up to 10 weeks free* *Restrictions may apply. Min lease term applies.',
        ['weeks_free'],
      ),
    ).toBe('Up to 10 weeks free');
    expect(offerHeadline('1 Month Free 2 Month Free 2 Months Free 8 weeks free', ['weeks_free'])).toBe(
      '8 weeks free',
    );
  });

  it('preserves full conditions as qualifier for API/detail', () => {
    const special =
      'Enjoy up to 12 WEEKS FREE! Plus, an additional $1,000 incentive. Restrictions apply.';
    const offer = buildPropertyOffer({
      specialText: special,
      specialTags: ['weeks_free'],
      sourceUrl: 'https://www.rent.com/apartment/example-lc1',
    });
    expect(offer).toEqual({
      displayText: 'Up to 12 weeks free',
      offerType: 'weeks_free',
      qualifierText: special,
      sourceReference: 'https://www.rent.com/apartment/example-lc1',
    });
  });

  it('does not invent an offer when special_text is absent', () => {
    expect(buildPropertyOffer({ specialText: null, specialTags: ['weeks_free'] })).toBeNull();
    expect(offerHeadline('')).toBeNull();
  });
});
