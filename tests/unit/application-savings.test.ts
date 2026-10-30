import { describe, expect, it } from 'vitest';
import {
  calculateApplicationSavings,
  formatMoney,
} from '../../web/src/lib/applicationSavings.ts';
import { publicAreaLocation, publishableMapLocation } from '../../src/modules/listings/map-location.js';
import { prepareMapPins } from '../../web/src/lib/mapPins.ts';
import { mapStyleUrl, savingsEstimateEnabled } from '../../web/src/lib/listingFeatures.ts';

const home = (id: string, fee: number | null, eligible = true) => ({
  listingId: id,
  eligibleForReuse: eligible,
  applicationFeeCents: fee,
});

describe('application savings', () => {
  it('sums three eligible homes and subtracts one Dwel charge', () => {
    const estimate = calculateApplicationSavings(
      [home('a', 7500), home('b', 7500), home('c', 6000)],
      2900,
    );
    expect(estimate).toEqual({
      eligibleHomes: 3,
      baselineFeesCents: 21000,
      dwelFeesCents: 2900,
      estimatedSavingsCents: 18100,
      completeEstimate: true,
    });
    expect(formatMoney(18100)).toBe('$181');
  });

  it('counts one eligible home', () => {
    expect(calculateApplicationSavings([home('a', 4000)], 2900)?.eligibleHomes).toBe(1);
  });

  it('returns null when no home is eligible', () => {
    expect(calculateApplicationSavings([home('a', 4000, false)], 2900)).toBeNull();
    expect(calculateApplicationSavings([], 2900)).toBeNull();
  });

  it('returns null when a fee or the Dwel charge is missing or invalid', () => {
    expect(calculateApplicationSavings([home('a', null)], 2900)).toBeNull();
    expect(calculateApplicationSavings([home('a', 4000)], null)).toBeNull();
    expect(calculateApplicationSavings([home('a', -1)], 2900)).toBeNull();
    expect(calculateApplicationSavings([home('a', 4000)], -5)).toBeNull();
  });

  it('keeps one row when the same listing is repeated', () => {
    const estimate = calculateApplicationSavings([home('a', 5000), home('a', 9000)], 1000);
    expect(estimate?.eligibleHomes).toBe(1);
    expect(estimate?.baselineFeesCents).toBe(9000);
  });

  it('skips a property that does not accept reuse', () => {
    const estimate = calculateApplicationSavings(
      [home('a', 5000), home('b', 8000, false)],
      1000,
    );
    expect(estimate?.eligibleHomes).toBe(1);
    expect(estimate?.baselineFeesCents).toBe(5000);
  });

  it('floors savings at zero when the Dwel charge is larger', () => {
    expect(calculateApplicationSavings([home('a', 1000)], 2500)?.estimatedSavingsCents).toBe(0);
  });

  it('reports valid zero savings without treating cashback as a fee', () => {
    const estimate = calculateApplicationSavings([home('a', 2900)], 2900);
    expect(estimate?.estimatedSavingsCents).toBe(0);
    expect(estimate?.completeEstimate).toBe(true);
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(50)).toBe('$1');
  });
});

describe('public map location', () => {
  it('coarsens a verified point to an area and drops invalid or unverified points', () => {
    expect(publicAreaLocation(30.26715, -97.74312)).toEqual({
      latitude: 30.27,
      longitude: -97.74,
      precision: 'area',
    });
    expect(publishableMapLocation(30.26715, -97.74312, 'rooftop')).toEqual({
      latitude: 30.27,
      longitude: -97.74,
      precision: 'area',
    });
    expect(publicAreaLocation(null, null)).toBeNull();
    expect(publicAreaLocation(91, -97)).toBeNull();
    expect(publicAreaLocation(Number.NaN, 10)).toBeNull();
    expect(publishableMapLocation(30.26, -97.74, null)).toBeNull();
    expect(publishableMapLocation(30.26, -97.74, 'property')).toBeNull();
  });

  it('keeps the map off and does not invent a dollar estimate from the frontend flags', () => {
    expect(mapStyleUrl()).toBe('');
    expect(savingsEstimateEnabled()).toBe(false);
  });

  it('drops invalid coordinates, duplicate ids, and stacks one pin per area', () => {
    const pins = prepareMapPins([
      { id: 'a', latitude: 30.267, longitude: -97.743, priceLabel: '$1,800' },
      { id: 'a', latitude: 30.267, longitude: -97.743, priceLabel: '$1,900' },
      { id: 'b', latitude: 30.2674, longitude: -97.7434, priceLabel: '$2,000' },
      { id: '', latitude: 30.2, longitude: -97.7, priceLabel: '$1' },
      { id: 'c', latitude: 91, longitude: -97, priceLabel: '$1' },
      { id: 'd', latitude: 29.4241, longitude: -98.4936, priceLabel: '$1,200' },
    ]);
    expect(pins).toHaveLength(2);
    const austin = pins.find((pin) => pin.listingIds.includes('a'));
    expect(austin?.listingIds).toEqual(['a', 'b']);
    expect(austin?.label).toBe('2');
    expect(pins.find((pin) => pin.id === 'd')?.label).toBe('$1,200');
  });
});
