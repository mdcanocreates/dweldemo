import { describe, expect, it } from 'vitest';
import {
  cohortFromSequence,
  cohortLabel,
  formatCents,
  isLaunchState,
  rsLookup,
} from './money';

describe('money helpers', () => {
  it('formats integer cents', () => {
    expect(formatCents(210_000)).toBe('$2,100');
    expect(formatCents(2999)).toBe('$29.99');
  });

  it('maps rent cents to RS tiers', () => {
    expect(rsLookup(100_000)).toBe('RS-1');
    expect(rsLookup(2_000_000)).toBe('RS-10');
    expect(rsLookup(5_000_000)).toBe('RS-12');
    expect(rsLookup(50_000)).toBe('RS-1'); // below $800 floor
  });

  it('assigns cohorts from sequence', () => {
    expect(cohortFromSequence(1)).toBe('COHORT_1');
    expect(cohortFromSequence(50)).toBe('COHORT_1');
    expect(cohortFromSequence(51)).toBe('COHORT_2');
    expect(cohortFromSequence(251)).toBe('COHORT_3');
    expect(cohortLabel('COHORT_1')).toBe('Founding');
  });

  it('limits launch states', () => {
    expect(isLaunchState('TX')).toBe(true);
    expect(isLaunchState('ny')).toBe(false);
  });
});
