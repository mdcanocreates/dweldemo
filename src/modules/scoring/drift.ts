/**
 * Drift monitors (§8.5): feature distribution, score distribution, outcome-rate.
 * Code paths refuse ML activation when Phase 7 gate is unmet.
 */

import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';
import { evaluatePhase7Gate } from './gate.js';
import type { Phase7GateResult, RenterFeatures } from './types.js';

export type FeatureDriftReport = {
  feature: string;
  baselineMean: number;
  currentMean: number;
  absDelta: number;
};

export type DriftMonitorResult = {
  featureDrift: FeatureDriftReport[];
  scoreDrift: { baselineMean: number; currentMean: number; absDelta: number };
  outcomeRateDrift: {
    baselineRate: number;
    currentRate: number;
    absDelta: number;
  };
  gate: Phase7GateResult;
  activationRefused: boolean;
  refuseReason: string;
};

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function computeFeatureDrift(
  baseline: RenterFeatures[],
  current: RenterFeatures[],
): FeatureDriftReport[] {
  if (baseline.length === 0 || current.length === 0) return [];
  const keys = Object.keys(baseline[0]!) as (keyof RenterFeatures)[];
  return keys.map((feature) => {
    const baselineMean = mean(baseline.map((r) => r[feature]));
    const currentMean = mean(current.map((r) => r[feature]));
    return {
      feature,
      baselineMean,
      currentMean,
      absDelta: Math.abs(currentMean - baselineMean),
    };
  });
}

export function computeScoreDrift(
  baselineScores: number[],
  currentScores: number[],
): { baselineMean: number; currentMean: number; absDelta: number } {
  const baselineMean = mean(baselineScores);
  const currentMean = mean(currentScores);
  return {
    baselineMean,
    currentMean,
    absDelta: Math.abs(currentMean - baselineMean),
  };
}

/**
 * Run drift monitors. Always refuses activation when gate unmet —
 * monitors are observational only until the gate clears.
 */
export async function runDriftMonitors(
  client: DbClient,
  input: {
    baselineFeatures: RenterFeatures[];
    currentFeatures: RenterFeatures[];
    baselineScores: number[];
    currentScores: number[];
    baselineOutcomeRate: number;
    currentOutcomeRate: number;
  },
): Promise<DriftMonitorResult> {
  const gate = await evaluatePhase7Gate(client);
  const featureDrift = computeFeatureDrift(input.baselineFeatures, input.currentFeatures);
  const scoreDrift = computeScoreDrift(input.baselineScores, input.currentScores);
  const outcomeRateDrift = {
    baselineRate: input.baselineOutcomeRate,
    currentRate: input.currentOutcomeRate,
    absDelta: Math.abs(input.currentOutcomeRate - input.baselineOutcomeRate),
  };

  if (!gate.met) {
    return {
      featureDrift,
      scoreDrift,
      outcomeRateDrift,
      gate,
      activationRefused: true,
      refuseReason: gate.reason,
    };
  }

  return {
    featureDrift,
    scoreDrift,
    outcomeRateDrift,
    gate,
    activationRefused: false,
    refuseReason: 'gate met — activation still requires explicit config call',
  };
}

/** Hard refuse helper used by activation path. */
export async function assertDriftAllowsActivation(client: DbClient): Promise<Phase7GateResult> {
  const gate = await evaluatePhase7Gate(client);
  if (!gate.met) {
    throw new AppError(
      `drift/activation refused: ${gate.reason}`,
      'phase7_gate_unmet',
      409,
    );
  }
  return gate;
}
