import { describe, expect, it } from 'vitest';
import { formatListedRent, hasListedRent } from '../../web/src/format';

describe('formatListedRent', () => {
  it('never renders missing or zero rent as $0', () => {
    expect(formatListedRent(null)).toBe('Price not listed');
    expect(formatListedRent(undefined)).toBe('Price not listed');
    expect(formatListedRent(0)).toBe('Price not listed');
    expect(hasListedRent(0)).toBe(false);
  });

  it('formats floors and ranges from source rent_min/rent_max cents', () => {
    expect(formatListedRent(133300)).toBe('$1,333/mo');
    expect(formatListedRent(133300, 581500)).toBe('$1,333–$5,815/mo');
    expect(hasListedRent(133300)).toBe(true);
  });
});
