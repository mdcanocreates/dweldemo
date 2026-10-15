import { describe, expect, it } from 'vitest';
import { interimCashbackCents } from './cashback';

describe('interimCashbackCents', () => {
  it('is 20% of first-month rent in integer cents', () => {
    expect(interimCashbackCents(185_000)).toBe(37_000); // $370
    expect(interimCashbackCents(210_000)).toBe(42_000); // $420
    expect(interimCashbackCents(165_000)).toBe(33_000); // $330
    expect(interimCashbackCents(199_000)).toBe(39_800);
  });

  it('returns 0 for non-positive rent', () => {
    expect(interimCashbackCents(0)).toBe(0);
    expect(interimCashbackCents(-100)).toBe(0);
  });
});
