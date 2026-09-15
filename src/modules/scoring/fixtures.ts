/**
 * Synthetic fixtures for offline/online parity and shadow distribution tests.
 */

import type { FeatureAssemblyInput, FeatureObservation, RenterFeatures } from './types.js';

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ParityFixture = FeatureAssemblyInput & { id: string };

/** Generate N deterministic feature-assembly fixtures. */
export function generateParityFixtures(n: number, seed = 42): ParityFixture[] {
  const rand = mulberry32(seed);
  const fixtures: ParityFixture[] = [];
  const base = new Date('2025-06-01T00:00:00.000Z').getTime();

  for (let i = 0; i < n; i++) {
    const pit = new Date(base + i * 3600_000);
    const before = new Date(pit.getTime() - 7 * 24 * 3600_000);
    const approvals = Math.floor(rand() * 5);
    const declines = Math.floor(rand() * 3);
    const observations: FeatureObservation[] = [
      { name: 'application_count', value: Math.floor(rand() * 10), written_at: before },
      {
        name: 'interest_received_count',
        value: Math.floor(rand() * 8),
        written_at: before,
      },
      { name: 'approval_count', value: approvals, written_at: before },
      { name: 'decline_count', value: declines, written_at: before },
      { name: 'placement_count', value: Math.floor(rand() * 3), written_at: before },
      { name: 'fraud_flag_count', value: rand() < 0.05 ? 1 : 0, written_at: before },
      {
        name: 'paid_upfront_screening_count',
        value: Math.floor(rand() * 2),
        written_at: before,
      },
      { name: 'income_band', value: 1 + Math.floor(rand() * 5), written_at: before },
      { name: 'household_size', value: 1 + Math.floor(rand() * 5), written_at: before },
    ];
    fixtures.push({
      id: `parity-${i}`,
      partyId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      applicationId: null,
      pointInTimeKey: pit,
      observations,
    });
  }
  return fixtures;
}

export function featuresFromAssembled(features: RenterFeatures): RenterFeatures {
  return { ...features };
}
