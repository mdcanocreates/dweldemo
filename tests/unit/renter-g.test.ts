import { describe, expect, it } from 'vitest';
import { applyScreeningFee, type ScreeningFeeConfig } from '../../src/modules/renter/screening-fee.js';
import { normalizePhoneE164 } from '../../src/modules/renter/profile.js';

const config: ScreeningFeeConfig = {
  default_cents: 2900,
  state_overrides: {
    NY: { max_cents: 2000, note: 'RPL §238-a cap' },
  },
};

describe('screening fee by state', () => {
  it('uses default for non-override states', () => {
    expect(applyScreeningFee(config, 'OH').amount_cents).toBe(2900);
    expect(applyScreeningFee(config, 'OH').capped).toBe(false);
  });

  it('caps NY at max_cents', () => {
    const fee = applyScreeningFee(config, 'ny');
    expect(fee.amount_cents).toBe(2000);
    expect(fee.capped).toBe(true);
    expect(fee.note).toContain('238-a');
  });
});

describe('phone E.164', () => {
  it('normalizes US numbers', () => {
    expect(normalizePhoneE164('6145551212')).toBe('+16145551212');
    expect(normalizePhoneE164('+16145551212')).toBe('+16145551212');
  });
});
