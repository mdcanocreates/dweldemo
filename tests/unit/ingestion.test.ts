import { describe, expect, it } from 'vitest';
import { transformRecord, payloadHash } from '../../src/modules/ingestion/transform.js';
import { evaluateQualityGates } from '../../src/modules/ingestion/quality.js';

const emptyCounts = {
  fetched: 0,
  new: 0,
  changed: 0,
  unchanged: 0,
  rejected: 0,
  ambiguous: 0,
  resolved: 0,
  unresolvable: 0,
  absent: 0,
};

describe('ingestion unit', () => {
  it('transformRecord maps dollars→cents and rejects missing fields', () => {
    const ok = transformRecord(
      { id: 'ext-1', address: '100 Main St', rent: 1800 },
      { external_id: 'id', address: 'address', rent_amount_cents: 'rent' },
      { forceCentsScale: 'auto' },
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.fields.rentAmountCents).toBe(180000);
      expect(ok.fields.externalId).toBe('ext-1');
    }

    const missing = transformRecord({ address: 'x' }, {}, { forceCentsScale: 'cents' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe('missing_external_id');
  });

  it('transformRecord cents scale does not multiply', () => {
    const ok = transformRecord(
      { id: 'e2', address: '1 A St', ListPrice: 180000 },
      { external_id: 'id', address: 'address', rent_amount_cents: 'ListPrice' },
      { forceCentsScale: 'cents' },
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.fields.rentAmountCents).toBe(180000);
  });

  it('payloadHash is stable', () => {
    expect(payloadHash({ a: 1 })).toBe(payloadHash({ a: 1 }));
  });

  it('evaluateQualityGates quarantines high rejection rate', () => {
    const bad = evaluateQualityGates({
      counts: { ...emptyCounts, fetched: 10, rejected: 8, resolved: 2 },
      rentsCents: [100000],
    });
    expect(bad.quarantine).toBe(true);

    const good = evaluateQualityGates({
      counts: {
        ...emptyCounts,
        fetched: 10,
        new: 5,
        changed: 3,
        unchanged: 2,
        resolved: 10,
      },
      rentsCents: [180000, 190000, 185000],
      priorMedianRentCents: 180000,
    });
    expect(good.quarantine).toBe(false);
  });

  it('median rent shift quarantine (currency scale suspect)', () => {
    const q = evaluateQualityGates({
      counts: { ...emptyCounts, fetched: 5, new: 5, resolved: 5 },
      rentsCents: [1800, 1900, 1850],
      priorMedianRentCents: 185000,
    });
    expect(q.quarantine).toBe(true);
    if (q.quarantine) expect(q.reason).toMatch(/median_rent_shift/);
  });
});
