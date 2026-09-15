/**
 * Single feature-assembly implementation for live scoring and training (§8.3).
 * Reconstructs state as of point_in_time_key — never reads observations written after.
 */

import {
  FEATURE_SET_VERSION,
  type AssembledFeatures,
  type FeatureAssemblyInput,
  type FeatureObservation,
  type RenterFeatureName,
  type RenterFeatures,
} from './types.js';

const FEATURE_NAMES: RenterFeatureName[] = [
  'application_count',
  'interest_received_count',
  'approval_count',
  'decline_count',
  'placement_count',
  'fraud_flag_count',
  'paid_upfront_screening_count',
  'income_band',
  'household_size',
  'approval_rate',
];

const COUNT_DEFAULTS: Omit<RenterFeatures, 'approval_rate' | 'income_band' | 'household_size'> & {
  income_band: number;
  household_size: number;
} = {
  application_count: 0,
  interest_received_count: 0,
  approval_count: 0,
  decline_count: 0,
  placement_count: 0,
  fraud_flag_count: 0,
  paid_upfront_screening_count: 0,
  income_band: 0,
  household_size: 0,
};

/**
 * Point-in-time filter: keep only observations with written_at <= point_in_time_key.
 * Latest observation per name wins.
 */
export function filterPointInTime(
  observations: FeatureObservation[],
  pointInTimeKey: Date,
): FeatureObservation[] {
  const pitMs = pointInTimeKey.getTime();
  const byName = new Map<string, FeatureObservation>();
  for (const obs of observations) {
    if (obs.written_at.getTime() > pitMs) continue;
    const prev = byName.get(obs.name);
    if (!prev || obs.written_at.getTime() >= prev.written_at.getTime()) {
      byName.set(obs.name, obs);
    }
  }
  return [...byName.values()];
}

/** Detect observations that would leak if consumed (written after PIT). */
export function findLeakingObservations(
  observations: FeatureObservation[],
  pointInTimeKey: Date,
): FeatureObservation[] {
  const pitMs = pointInTimeKey.getTime();
  return observations.filter((o) => o.written_at.getTime() > pitMs);
}

export function assembleFeatures(input: FeatureAssemblyInput): AssembledFeatures {
  const filtered = filterPointInTime(input.observations, input.pointInTimeKey);
  const values: Partial<RenterFeatures> = { ...COUNT_DEFAULTS };
  const featureSources: AssembledFeatures['featureSources'] = {};

  for (const obs of filtered) {
    if (!FEATURE_NAMES.includes(obs.name as RenterFeatureName)) continue;
    if (obs.name === 'approval_rate') continue; // derived
    const num = obs.value ?? 0;
    values[obs.name as RenterFeatureName] = num;
    featureSources[obs.name] = {
      written_at: obs.written_at.toISOString(),
      source: 'observation',
    };
  }

  const approvals = values.approval_count ?? 0;
  const declines = values.decline_count ?? 0;
  const denom = approvals + declines;
  const approvalRate = denom === 0 ? 0 : approvals / denom;
  values.approval_rate = approvalRate;
  featureSources.approval_rate = {
    written_at: input.pointInTimeKey.toISOString(),
    source: 'derived',
  };

  const features = values as RenterFeatures;
  for (const name of FEATURE_NAMES) {
    if (features[name] === undefined || features[name] === null) {
      features[name] = name === 'approval_rate' ? 0 : 0;
    }
  }

  return {
    features,
    featureSources,
    featureSetVersion: FEATURE_SET_VERSION,
    pointInTimeKey: input.pointInTimeKey,
    partyId: input.partyId,
    applicationId: input.applicationId ?? null,
  };
}

/**
 * Online path: assemble from live observation list (same function as training).
 */
export function assembleOnlineFeatures(input: FeatureAssemblyInput): AssembledFeatures {
  return assembleFeatures(input);
}

/**
 * Offline/training path: identical assembly — divergence is prohibited (§8.3).
 */
export function assembleTrainingFeatures(input: FeatureAssemblyInput): AssembledFeatures {
  return assembleFeatures(input);
}

export function featuresEqual(a: RenterFeatures, b: RenterFeatures, eps = 1e-9): boolean {
  for (const name of FEATURE_NAMES) {
    if (Math.abs((a[name] ?? 0) - (b[name] ?? 0)) > eps) return false;
  }
  return true;
}

export { FEATURE_NAMES };
