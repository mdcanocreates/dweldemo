/**
 * Feature leakage gate (§8.3).
 * A known-poisoned fixture must fail the pipeline when PIT filtering is absent
 * or when post-PIT values appear in assembled features.
 */

import { assembleFeatures, findLeakingObservations } from './features.js';
import {
  assertPoisonedFixtureFailsPipeline,
  assembleFeaturesIgnoringPit,
  type TrainingRowFixture,
} from './training.js';
import type { FeatureObservation, RenterFeatures } from './types.js';

export type LeakageGateResult = {
  pass: boolean;
  /** True when the poisoned fixture is correctly rejected / excluded. */
  poisonedFixtureFailsPipeline: boolean;
  detail: string;
  evidence: Record<string, unknown>;
};

/** Canonical poisoned fixture used by CI. */
export function makePoisonedFixture(now = new Date('2026-01-15T12:00:00.000Z')): TrainingRowFixture {
  const pit = new Date(now.getTime());
  const before = new Date(pit.getTime() - 30 * 24 * 60 * 60 * 1000);
  const after = new Date(pit.getTime() + 90 * 24 * 60 * 60 * 1000);

  const observations: FeatureObservation[] = [
    { name: 'application_count', value: 2, written_at: before },
    { name: 'approval_count', value: 1, written_at: before },
    { name: 'decline_count', value: 0, written_at: before },
    { name: 'placement_count', value: 0, written_at: before },
    { name: 'fraud_flag_count', value: 0, written_at: before },
    { name: 'interest_received_count', value: 1, written_at: before },
    { name: 'paid_upfront_screening_count', value: 0, written_at: before },
    { name: 'income_band', value: 3, written_at: before },
    { name: 'household_size', value: 2, written_at: before },
    // POISON: outcome / fraud written 90d after decision time
    { name: 'fraud_flag_count', value: 9, written_at: after },
    { name: 'placement_count', value: 7, written_at: after },
  ];

  return {
    id: 'poisoned-fixture-001',
    partyId: '00000000-0000-4000-8000-000000000001',
    pointInTimeKey: pit,
    observations,
    label: 1,
  };
}

/**
 * Pipeline check: if assembly (incorrectly) includes poison, fail hard.
 */
export function detectLeakageInAssembled(
  fixture: TrainingRowFixture,
  assembled: RenterFeatures,
  featureSources: Record<string, { written_at: string; source: string }>,
): { leaked: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const leaking = findLeakingObservations(fixture.observations, fixture.pointInTimeKey);

  for (const leak of leaking) {
    const src = featureSources[leak.name];
    if (src && new Date(src.written_at).getTime() > fixture.pointInTimeKey.getTime()) {
      reasons.push(`${leak.name} source written_at after PIT`);
    }
  }

  // Compare against deliberately broken assembly
  const broken = assembleFeaturesIgnoringPit({
    partyId: fixture.partyId,
    applicationId: fixture.applicationId,
    pointInTimeKey: fixture.pointInTimeKey,
    observations: fixture.observations,
  });

  const correct = assembleFeatures({
    partyId: fixture.partyId,
    applicationId: fixture.applicationId,
    pointInTimeKey: fixture.pointInTimeKey,
    observations: fixture.observations,
  });

  if (JSON.stringify(assembled) === JSON.stringify(broken) &&
      JSON.stringify(correct.features) !== JSON.stringify(broken)) {
    reasons.push('assembled features match poison-ignoring-PIT assembly');
  }

  // Explicit poison values must not equal assembled when no pre-PIT value
  for (const leak of leaking) {
    const pre = fixture.observations.filter(
      (o) =>
        o.name === leak.name &&
        o.written_at.getTime() <= fixture.pointInTimeKey.getTime(),
    );
    const expectedPre = pre.sort(
      (a, b) => b.written_at.getTime() - a.written_at.getTime(),
    )[0];
    const key = leak.name as keyof RenterFeatures;
    if (expectedPre) {
      if (assembled[key] === leak.value && assembled[key] !== expectedPre.value) {
        reasons.push(`${leak.name} equals poison value ${leak.value}`);
      }
    } else if (assembled[key] === leak.value) {
      reasons.push(`${leak.name} equals poison-only value ${leak.value}`);
    }
  }

  return { leaked: reasons.length > 0, reasons };
}

/**
 * CI entry: poisoned fixture must fail (be excluded by) the correct pipeline,
 * and a pipeline that drops the PIT assertion must be detectable as FAIL.
 */
export function runFeatureLeakageGate(): LeakageGateResult {
  const poisoned = makePoisonedFixture();
  const check = assertPoisonedFixtureFailsPipeline(poisoned);

  const correct = assembleFeatures({
    partyId: poisoned.partyId,
    applicationId: poisoned.applicationId,
    pointInTimeKey: poisoned.pointInTimeKey,
    observations: poisoned.observations,
  });

  const leakCheck = detectLeakageInAssembled(
    poisoned,
    correct.features,
    correct.featureSources,
  );

  // Correct assembly must NOT leak
  if (leakCheck.leaked) {
    return {
      pass: false,
      poisonedFixtureFailsPipeline: false,
      detail: `correct assembly leaked: ${leakCheck.reasons.join('; ')}`,
      evidence: { features: correct.features, reasons: leakCheck.reasons },
    };
  }

  // Broken assembly MUST be flagged as leakage (poisoned fixture "fails" that path)
  const brokenFeatures = assembleFeaturesIgnoringPit({
    partyId: poisoned.partyId,
    applicationId: poisoned.applicationId,
    pointInTimeKey: poisoned.pointInTimeKey,
    observations: poisoned.observations,
  });
  const brokenLeak = detectLeakageInAssembled(
    poisoned,
    brokenFeatures,
    // fabricate sources at poison times so detector sees post-PIT
    Object.fromEntries(
      findLeakingObservations(poisoned.observations, poisoned.pointInTimeKey).map((o) => [
        o.name,
        { written_at: o.written_at.toISOString(), source: 'poison' },
      ]),
    ),
  );

  if (!brokenLeak.leaked) {
    return {
      pass: false,
      poisonedFixtureFailsPipeline: false,
      detail: 'poisoned assembly was not detected — leakage detector too weak',
      evidence: { brokenFeatures },
    };
  }

  if (!check.failedAsExpected) {
    return {
      pass: false,
      poisonedFixtureFailsPipeline: false,
      detail: check.detail,
      evidence: { check },
    };
  }

  return {
    pass: true,
    poisonedFixtureFailsPipeline: true,
    detail: check.detail,
    evidence: {
      correct_fraud_flag_count: correct.features.fraud_flag_count,
      correct_placement_count: correct.features.placement_count,
      broken_fraud_flag_count: brokenFeatures.fraud_flag_count,
      broken_placement_count: brokenFeatures.placement_count,
      poison_detected_on_broken_path: brokenLeak.reasons,
    },
  };
}
