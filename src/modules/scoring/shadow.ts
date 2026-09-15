/**
 * Shadow scoring (§8.5 / §17): score with candidate model alongside v0.
 * Refuses activation when Phase 7 gate is unmet.
 */

import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';
import { evaluatePhase7Gate } from './gate.js';
import { runMlV1Candidate, runRulesV0 } from './rules-v0.js';
import {
  ML_V1_CANDIDATE_VERSION,
  RULES_V0_VERSION,
  type RenterFeatures,
  type ScoreResult,
} from './types.js';

export type ShadowScorePair = {
  v0: ScoreResult;
  candidate: ScoreResult;
  candidateVersion: string;
};

export function shadowScoreFeatures(
  features: RenterFeatures,
  candidateVersion = ML_V1_CANDIDATE_VERSION,
): ShadowScorePair {
  const v0 = runRulesV0(features, { computedBy: 'scoring.shadow.v0' });
  const candidate =
    candidateVersion === ML_V1_CANDIDATE_VERSION
      ? runMlV1Candidate(features, { computedBy: 'scoring.shadow.candidate' })
      : runRulesV0(features, { computedBy: 'scoring.shadow.candidate' });
  return { v0, candidate, candidateVersion };
}

export type ShadowRunSummary = {
  n: number;
  v0Mean: number;
  candidateMean: number;
  meanAbsDiff: number;
  bandAgreementRate: number;
  gateMet: boolean;
  activationAllowed: boolean;
  note: string;
};

/** Compare score distributions (fixture or prod-shadow harness). */
export function compareScoreDistributions(
  pairs: ShadowScorePair[],
): Omit<ShadowRunSummary, 'gateMet' | 'activationAllowed' | 'note'> {
  const n = pairs.length;
  if (n === 0) {
    return { n: 0, v0Mean: 0, candidateMean: 0, meanAbsDiff: 0, bandAgreementRate: 0 };
  }
  let v0Sum = 0;
  let cSum = 0;
  let abs = 0;
  let agree = 0;
  for (const p of pairs) {
    v0Sum += p.v0.rawScore;
    cSum += p.candidate.rawScore;
    abs += Math.abs(p.v0.rawScore - p.candidate.rawScore);
    if (p.v0.band === p.candidate.band) agree += 1;
  }
  return {
    n,
    v0Mean: v0Sum / n,
    candidateMean: cSum / n,
    meanAbsDiff: abs / n,
    bandAgreementRate: agree / n,
  };
}

/**
 * 30-day shadow harness. Fixture mode runs immediately.
 * Real 30-day prod shadow is N/A until gate met — documented in return note.
 */
export async function runShadowHarness(
  client: DbClient,
  featureRows: RenterFeatures[],
  opts?: { candidateVersion?: string; mode?: 'fixture' | 'prod' },
): Promise<ShadowRunSummary> {
  const gate = await evaluatePhase7Gate(client);
  const mode = opts?.mode ?? 'fixture';
  const pairs = featureRows.map((f) =>
    shadowScoreFeatures(f, opts?.candidateVersion ?? ML_V1_CANDIDATE_VERSION),
  );
  const dist = compareScoreDistributions(pairs);

  if (mode === 'prod' && !gate.met) {
    return {
      ...dist,
      gateMet: false,
      activationAllowed: false,
      note:
        'N/A: real 30-day production shadow requires Phase 7 gate (6mo placements + ≥60% 90d labels). Fixture-based distribution comparison may run in CI. ML activation refused.',
    };
  }

  return {
    ...dist,
    gateMet: gate.met,
    activationAllowed: gate.met,
    note: gate.met
      ? 'Gate met — shadow results may inform activation decision'
      : 'Gate UNMET — fixture shadow only; ML activation refused; rules-v0 remains active',
  };
}

/** Persist shadow scores only as non-activating side channel — never flips active model. */
export async function recordShadowScoresRefuseActivation(
  client: DbClient,
  features: RenterFeatures,
): Promise<{ pair: ShadowScorePair; activationBlocked: true; reason: string }> {
  const gate = await evaluatePhase7Gate(client);
  const pair = shadowScoreFeatures(features);
  if (gate.met) {
    // Still do not auto-activate; activation is an explicit config call.
    return {
      pair,
      activationBlocked: true,
      reason: 'Shadow path never auto-activates; call activateModelViaConfig explicitly',
    };
  }
  return {
    pair,
    activationBlocked: true,
    reason: gate.reason,
  };
}

export function assertNotActivatingFromShadow(summary: ShadowRunSummary): void {
  if (summary.activationAllowed && !summary.gateMet) {
    throw new AppError(
      'shadow harness incorrectly allowed activation',
      'shadow_activation_invariant',
      500,
    );
  }
  if (!summary.gateMet && summary.note.includes('activation') === false) {
    // soft check — note should mention refusal
  }
  void RULES_V0_VERSION;
}
