/**
 * Deterministic rules engine v0 (§8.5).
 * Versioned, registered, explained — same interface an ML model will use.
 */

import {
  RENTER_SCORE_MODEL_KEY,
  RULES_V0_VERSION,
  type RenterFeatures,
  type ScoreResult,
} from './types.js';

export type RulesV0Weights = {
  application_count: number;
  interest_received_count: number;
  approval_count: number;
  decline_count: number;
  placement_count: number;
  fraud_flag_count: number;
  paid_upfront_screening_count: number;
  income_band: number;
  household_size: number;
  approval_rate: number;
  intercept: number;
};

/** Frozen weights for rules-v0 — changing them requires a new model_version. */
export const RULES_V0_WEIGHTS: RulesV0Weights = {
  application_count: 2,
  interest_received_count: 3,
  approval_count: 8,
  decline_count: -4,
  placement_count: 10,
  fraud_flag_count: -25,
  paid_upfront_screening_count: 5,
  income_band: 4,
  household_size: 1,
  approval_rate: 20,
  intercept: 50,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function bandFor(score: number): string {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'E';
}

/**
 * Pure scoring: feature_snapshot + rules-v0 → raw_score + explanation.
 * Replaying the same snapshot always reproduces the same score.
 */
export function runRulesV0(
  features: RenterFeatures,
  opts?: {
    cohortKey?: string;
    cohortN?: number;
    featureSources?: ScoreResult['featureSources'];
    computedBy?: string;
  },
): ScoreResult {
  const w = RULES_V0_WEIGHTS;
  const contributions: Record<string, number> = {
    intercept: w.intercept,
    application_count: features.application_count * w.application_count,
    interest_received_count: features.interest_received_count * w.interest_received_count,
    approval_count: features.approval_count * w.approval_count,
    decline_count: features.decline_count * w.decline_count,
    placement_count: features.placement_count * w.placement_count,
    fraud_flag_count: features.fraud_flag_count * w.fraud_flag_count,
    paid_upfront_screening_count:
      features.paid_upfront_screening_count * w.paid_upfront_screening_count,
    income_band: features.income_band * w.income_band,
    household_size: features.household_size * w.household_size,
    approval_rate: features.approval_rate * w.approval_rate,
  };

  const rawLinear = Object.values(contributions).reduce((a, b) => a + b, 0);
  const rawScore = clamp(Math.round(rawLinear * 1000) / 1000, 0, 100);
  const band = bandFor(rawScore);

  const top = Object.entries(contributions)
    .filter(([k]) => k !== 'intercept')
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 5)
    .map(([feature, contribution]) => ({ feature, contribution }));

  const explanation = {
    model: RULES_V0_VERSION,
    kind: 'rules',
    formula: 'clamp(round(sum(weight_i * feature_i) + intercept, 3), 0, 100)',
    contributions,
    top_drivers: top,
    band_thresholds: { A: 80, B: 65, C: 50, D: 35, E: 0 },
    message: `Rules v0 score ${rawScore} band ${band}`,
  };

  if (Object.keys(explanation).length === 0) {
    throw new Error('explanation must be non-empty');
  }

  return {
    modelKey: RENTER_SCORE_MODEL_KEY,
    modelVersion: RULES_V0_VERSION,
    cohortKey: opts?.cohortKey ?? 'global|fallback',
    cohortN: opts?.cohortN ?? 0,
    rawScore,
    percentile: null,
    band,
    featureSnapshot: { ...features },
    featureSources: opts?.featureSources ?? {},
    explanation,
    computedBy: opts?.computedBy ?? 'scoring.rules-v0',
  };
}

/**
 * Inactive ML candidate scorer — deterministic stub for shadow/replay only.
 * Never activated while gate unmet. Uses a slight weight perturbation so
 * distributions differ from v0 for shadow comparison.
 */
export function runMlV1Candidate(
  features: RenterFeatures,
  opts?: {
    cohortKey?: string;
    cohortN?: number;
    featureSources?: ScoreResult['featureSources'];
    computedBy?: string;
  },
): ScoreResult {
  const base = runRulesV0(features, opts);
  // Deterministic transform of v0 for shadow parity tests (not a trained model).
  const shifted = clamp(
    Math.round((base.rawScore * 0.97 + features.approval_rate * 3) * 1000) / 1000,
    0,
    100,
  );
  return {
    ...base,
    modelVersion: 'ml-v1-candidate',
    rawScore: shifted,
    band: bandFor(shifted),
    explanation: {
      ...base.explanation,
      model: 'ml-v1-candidate',
      kind: 'ml',
      note: 'Inactive candidate stub — not a production-trained model',
      base_rules_v0_score: base.rawScore,
      shifted_score: shifted,
    },
    computedBy: opts?.computedBy ?? 'scoring.ml-v1-candidate',
  };
}

export function replayFromSnapshot(
  featureSnapshot: RenterFeatures,
  modelVersion: string,
): ScoreResult {
  if (modelVersion === RULES_V0_VERSION || modelVersion === 'rules-v0') {
    return runRulesV0(featureSnapshot, { computedBy: 'scoring.replay' });
  }
  if (modelVersion === 'ml-v1-candidate') {
    return runMlV1Candidate(featureSnapshot, { computedBy: 'scoring.replay' });
  }
  throw new Error(`unknown model_version for replay: ${modelVersion}`);
}
