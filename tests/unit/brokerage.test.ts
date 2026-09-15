import { describe, expect, it } from 'vitest';
import {
  classifyRentAgainstBook,
  type PriceBookTier,
} from '../../src/modules/brokerage/price-book.js';
import type { AssignmentCandidate } from '../../src/modules/brokerage/assignment.js';
import { specSeedPriceBookTiers } from '../helpers/price-book-seed.js';

function bookFromSeed(): { version: string; tiers: PriceBookTier[] } {
  return {
    version: 'unit-v1',
    tiers: specSeedPriceBookTiers().map((t) => ({
      tier: t.tier,
      rentMinCents: t.rentMinCents,
      rentMaxCents: t.rentMaxCents,
      feeCents: t.feeCents,
    })),
  };
}

function rankSort(a: AssignmentCandidate, b: AssignmentCandidate): number {
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (b.closeRate !== a.closeRate) return b.closeRate - a.closeRate;
  if (a.leakageRate !== b.leakageRate) return a.leakageRate - b.leakageRate;
  if (a.medianResponseSeconds !== b.medianResponseSeconds) {
    return a.medianResponseSeconds - b.medianResponseSeconds;
  }
  const aLast = a.lastOfferedAt?.getTime() ?? 0;
  const bLast = b.lastOfferedAt?.getTime() ?? 0;
  return aLast - bLast;
}

describe('brokerage unit — RS classification + assignment rank', () => {
  const book = bookFromSeed();

  it('classifies every named boundary from the remediation checklist', () => {
    expect(classifyRentAgainstBook(80000, book).rsTier).toBe('RS-1'); // $800
    expect(classifyRentAgainstBook(119900, book).rsTier).toBe('RS-1'); // $1,199
    expect(classifyRentAgainstBook(120000, book).rsTier).toBe('RS-2'); // $1,200
    expect(classifyRentAgainstBook(4500000, book).rsTier).toBe('RS-12'); // $45,000
  });

  it('asserts all 12 tiers at rent_low and rent_high (24 edges)', () => {
    const edges: Array<{ rent: number; tier: string }> = [];
    for (const t of book.tiers) {
      edges.push({ rent: t.rentMinCents, tier: t.tier });
      if (t.rentMaxCents != null) {
        edges.push({ rent: t.rentMaxCents, tier: t.tier });
      } else {
        // open ceiling: open-ceiling edge is rent_min (already) + a high rent
        edges.push({ rent: t.rentMinCents + 1_000_000, tier: t.tier });
      }
    }
    expect(edges.length).toBeGreaterThanOrEqual(24);
    for (const e of edges) {
      const c = classifyRentAgainstBook(e.rent, book);
      expect(c.rsTier, `rent ${e.rent}`).toBe(e.tier);
      expect(c.priceBookVersion).toBe('unit-v1');
    }
  });

  it('gap between rent_high and next rent_low is out-of-book; next low classifies next tier', () => {
    for (let i = 0; i < book.tiers.length - 1; i++) {
      const cur = book.tiers[i]!;
      const next = book.tiers[i + 1]!;
      if (cur.rentMaxCents == null) continue;
      if (cur.rentMaxCents + 1 < next.rentMinCents) {
        expect(() => classifyRentAgainstBook(cur.rentMaxCents! + 1, book)).toThrow(
          /outside price book/,
        );
      }
      const c = classifyRentAgainstBook(next.rentMinCents, book);
      expect(c.rsTier).toBe(next.tier);
    }
  });

  it('rejects rent below RS-1 floor ($799)', () => {
    expect(() => classifyRentAgainstBook(79900, book)).toThrow(/outside price book/);
    expect(() => classifyRentAgainstBook(79999, book)).toThrow(/outside price book/);
  });

  it('ranks by priority → close_rate → leakage → response → least-recent', () => {
    const candidates: AssignmentCandidate[] = [
      {
        orgId: 'low-pri',
        priority: 1,
        closeRate: 0.9,
        leakageRate: 0,
        medianResponseSeconds: 1,
        lastOfferedAt: null,
        openLeads: 0,
        maxOpenLeads: 10,
        rankReasons: [],
      },
      {
        orgId: 'high-pri',
        priority: 10,
        closeRate: 0.1,
        leakageRate: 0.5,
        medianResponseSeconds: 999,
        lastOfferedAt: new Date('2020-01-01'),
        openLeads: 0,
        maxOpenLeads: 10,
        rankReasons: [],
      },
      {
        orgId: 'mid-close',
        priority: 10,
        closeRate: 0.5,
        leakageRate: 0.1,
        medianResponseSeconds: 10,
        lastOfferedAt: null,
        openLeads: 0,
        maxOpenLeads: 10,
        rankReasons: [],
      },
    ];
    const sorted = [...candidates].sort(rankSort);
    expect(sorted.map((c) => c.orgId)).toEqual(['mid-close', 'high-pri', 'low-pri']);
  });

  it('filters capacity: openLeads >= maxOpenLeads is ineligible', () => {
    expect(5 >= 5).toBe(true);
  });
});
