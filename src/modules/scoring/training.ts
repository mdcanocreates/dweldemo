/**
 * Training pipeline plumbing with point-in-time correctness (§8.3 / §17).
 * Runs against fixtures without requiring production labels.
 */

import { assembleTrainingFeatures, findLeakingObservations } from './features.js';
import { runRulesV0, runMlV1Candidate } from './rules-v0.js';
import type {
  FeatureAssemblyInput,
  FeatureObservation,
  RenterFeatures,
  ScoreResult,
} from './types.js';
import { AppError } from '../shared/errors.js';

export type TrainingRowFixture = {
  id: string;
  partyId: string;
  applicationId?: string | null;
  /** Decision / label time — features must be as-of this instant. */
  pointInTimeKey: Date;
  observations: FeatureObservation[];
  /** Optional label for offline eval (not used for feature assembly). */
  label?: number | null;
};

export type TrainingRow = {
  id: string;
  partyId: string;
  pointInTimeKey: Date;
  features: RenterFeatures;
  featureSources: Record<string, { written_at: string; source: string }>;
  label: number | null;
  leakingObservationCount: number;
};

export type TrainingPipelineResult = {
  rows: TrainingRow[];
  rowCount: number;
  leakageFailures: Array<{ rowId: string; leakingNames: string[] }>;
  ok: boolean;
};

/**
 * Assemble training matrix with PIT enforcement.
 * Fails closed if any fixture would require post-PIT observations to match a
 * "poison expected" marker — see assertNoLeakage / runTrainingPipeline.
 */
export function assembleTrainingMatrix(fixtures: TrainingRowFixture[]): TrainingRow[] {
  return fixtures.map((fx) => {
    const input: FeatureAssemblyInput = {
      partyId: fx.partyId,
      applicationId: fx.applicationId,
      pointInTimeKey: fx.pointInTimeKey,
      observations: fx.observations,
    };
    const assembled = assembleTrainingFeatures(input);
    const leaking = findLeakingObservations(fx.observations, fx.pointInTimeKey);
    return {
      id: fx.id,
      partyId: fx.partyId,
      pointInTimeKey: fx.pointInTimeKey,
      features: assembled.features,
      featureSources: assembled.featureSources,
      label: fx.label ?? null,
      leakingObservationCount: leaking.length,
    };
  });
}

/**
 * Leakage assertion: poisoned future observations must NOT appear in assembled features.
 * Pipeline fails (ok=false) when a fixture marked `expect_poison_blocked` still
 * reflects the poison value, or when raw assembly without PIT would differ and
 * we detect consumption of post-PIT data.
 */
export function assertTrainingPointInTime(fixtures: TrainingRowFixture[]): {
  ok: boolean;
  failures: Array<{ rowId: string; detail: string }>;
} {
  const failures: Array<{ rowId: string; detail: string }> = [];

  for (const fx of fixtures) {
    const leaking = findLeakingObservations(fx.observations, fx.pointInTimeKey);
    const assembled = assembleTrainingFeatures({
      partyId: fx.partyId,
      applicationId: fx.applicationId,
      pointInTimeKey: fx.pointInTimeKey,
      observations: fx.observations,
    });

    for (const leak of leaking) {
      const usedSource = assembled.featureSources[leak.name];
      if (
        usedSource &&
        new Date(usedSource.written_at).getTime() > fx.pointInTimeKey.getTime()
      ) {
        failures.push({
          rowId: fx.id,
          detail: `LEAK: feature ${leak.name} sourced from ${usedSource.written_at} after PIT ${fx.pointInTimeKey.toISOString()}`,
        });
      }
      // If poison value equals assembled value and no pre-PIT obs exists for that name,
      // that is also leakage.
      const prePit = fx.observations.filter(
        (o) =>
          o.name === leak.name && o.written_at.getTime() <= fx.pointInTimeKey.getTime(),
      );
      if (prePit.length === 0) {
        const assembledVal = assembled.features[leak.name as keyof RenterFeatures];
        if (assembledVal === leak.value) {
          failures.push({
            rowId: fx.id,
            detail: `LEAK: poison-only feature ${leak.name}=${leak.value} present in assembled row`,
          });
        }
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

export function runTrainingPipeline(fixtures: TrainingRowFixture[]): TrainingPipelineResult {
  const pit = assertTrainingPointInTime(fixtures);
  if (!pit.ok) {
    return {
      rows: [],
      rowCount: 0,
      leakageFailures: pit.failures.map((f) => ({
        rowId: f.rowId,
        leakingNames: [f.detail],
      })),
      ok: false,
    };
  }

  const rows = assembleTrainingMatrix(fixtures);
  return {
    rows,
    rowCount: rows.length,
    leakageFailures: [],
    ok: true,
  };
}

/** Offline eval harness: score training rows with a model version. */
export function offlineEval(
  rows: TrainingRow[],
  modelVersion: string,
): Array<{ rowId: string; score: ScoreResult; label: number | null }> {
  return rows.map((row) => {
    const score =
      modelVersion === 'ml-v1-candidate'
        ? runMlV1Candidate(row.features)
        : runRulesV0(row.features);
    return { rowId: row.id, score, label: row.label };
  });
}

/**
 * Deliberately broken assembly that IGNORES point-in-time (for leakage CI).
 * Must not be used in production paths.
 */
export function assembleFeaturesIgnoringPit(input: FeatureAssemblyInput): RenterFeatures {
  // Take latest observation per name regardless of PIT — this is the poison path.
  const byName = new Map<string, FeatureObservation>();
  for (const obs of input.observations) {
    const prev = byName.get(obs.name);
    if (!prev || obs.written_at.getTime() >= prev.written_at.getTime()) {
      byName.set(obs.name, obs);
    }
  }
  const broken = assembleTrainingFeatures({
    ...input,
    // Pretend PIT is far in the future so filter keeps everything
    pointInTimeKey: new Date('2999-01-01T00:00:00.000Z'),
    observations: [...byName.values()],
  });
  return broken.features;
}

export function assertPoisonedFixtureFailsPipeline(
  poisoned: TrainingRowFixture,
): { failedAsExpected: boolean; detail: string } {
  // Correct pipeline must exclude poison
  const correct = runTrainingPipeline([poisoned]);
  if (!correct.ok) {
    return {
      failedAsExpected: true,
      detail: 'pipeline reported leakage failure',
    };
  }

  const row = correct.rows[0]!;
  const poisonObs = findLeakingObservations(poisoned.observations, poisoned.pointInTimeKey);
  if (poisonObs.length === 0) {
    throw new AppError(
      'fixture is not poisoned (no post-PIT observations)',
      'leakage_fixture_invalid',
      500,
    );
  }

  // Broken path would include poison
  const brokenFeatures = assembleFeaturesIgnoringPit({
    partyId: poisoned.partyId,
    applicationId: poisoned.applicationId,
    pointInTimeKey: poisoned.pointInTimeKey,
    observations: poisoned.observations,
  });

  let poisonWouldChange = false;
  for (const p of poisonObs) {
    const key = p.name as keyof RenterFeatures;
    if (brokenFeatures[key] !== row.features[key]) {
      poisonWouldChange = true;
      break;
    }
  }

  if (!poisonWouldChange) {
    return {
      failedAsExpected: false,
      detail: 'poison does not change features — fixture too weak',
    };
  }

  // Correct row must not equal broken (poisoned) features
  const leaked =
    JSON.stringify(row.features) === JSON.stringify(brokenFeatures);
  if (leaked) {
    return {
      failedAsExpected: false,
      detail: 'FAIL: correct pipeline matched poisoned assembly — PIT broken',
    };
  }

  return {
    failedAsExpected: true,
    detail: 'poisoned fixture correctly excluded by PIT assembly; broken path differs',
  };
}
