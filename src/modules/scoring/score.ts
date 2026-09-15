/**
 * Live scoring path — uses the same feature assembly as training (§8.3).
 */

import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import { assembleOnlineFeatures } from './features.js';
import { getActiveRenterScoreModel, ensureRulesV0Registered } from './registry.js';
import { runMlV1Candidate, runRulesV0, replayFromSnapshot } from './rules-v0.js';
import {
  FEATURE_SET_VERSION,
  RULES_V0_VERSION,
  type FeatureAssemblyInput,
  type RenterFeatures,
  type ScoreResult,
} from './types.js';

export type ComputeScoreInput = FeatureAssemblyInput & {
  renterProfileId?: string | null;
  cohortKey?: string;
  cohortN?: number;
  /** Force a model version (e.g. shadow). Default = active registry model. */
  modelVersion?: string;
  persist?: boolean;
};

export type PersistedScore = ScoreResult & {
  id: string;
  computedAt: Date;
};

function scoreWithVersion(
  features: RenterFeatures,
  version: string,
  opts: {
    cohortKey: string;
    cohortN: number;
    featureSources: ScoreResult['featureSources'];
    computedBy: string;
  },
): ScoreResult {
  if (version === RULES_V0_VERSION) {
    return runRulesV0(features, opts);
  }
  if (version === 'ml-v1-candidate') {
    return runMlV1Candidate(features, opts);
  }
  throw new AppError(`unsupported model_version: ${version}`, 'score_unknown_model', 400);
}

export async function computeRenterScore(
  client: DbClient,
  input: ComputeScoreInput,
  clock: Clock = systemClock,
): Promise<PersistedScore> {
  await ensureRulesV0Registered(client);

  const assembled = assembleOnlineFeatures(input);

  let version = input.modelVersion;
  if (!version) {
    const active = await getActiveRenterScoreModel(client);
    version = active.version;
  }

  const result = scoreWithVersion(assembled.features, version, {
    cohortKey: input.cohortKey ?? 'global|fallback',
    cohortN: input.cohortN ?? 0,
    featureSources: assembled.featureSources,
    computedBy: `scoring.${version}`,
  });

  if (!result.explanation || Object.keys(result.explanation).length === 0) {
    throw new AppError('score missing explanation', 'score_no_explanation', 500);
  }

  const computedAt = clock.now();
  const id = randomUUID();

  if (input.persist !== false) {
    await client.query(
      `insert into feature_snapshot (
         id, party_id, application_id, computed_at, feature_set_version, features, point_in_time_key
       ) values ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        randomUUID(),
        input.partyId,
        input.applicationId ?? null,
        computedAt,
        FEATURE_SET_VERSION,
        JSON.stringify(assembled.features),
        assembled.pointInTimeKey,
      ],
    );

    await client.query(
      `insert into score (
         id, application_id, renter_profile_id, party_id,
         model_key, model_version, cohort_key, cohort_n,
         raw_score, percentile, band,
         feature_snapshot, feature_sources, explanation,
         computed_at, computed_by
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16
       )`,
      [
        id,
        input.applicationId ?? null,
        input.renterProfileId ?? null,
        input.partyId,
        result.modelKey,
        result.modelVersion,
        result.cohortKey,
        result.cohortN,
        result.rawScore,
        result.percentile,
        result.band,
        JSON.stringify(result.featureSnapshot),
        JSON.stringify(result.featureSources),
        JSON.stringify(result.explanation),
        computedAt,
        result.computedBy,
      ],
    );

    await client.query(
      `update party_features set latest_score = $2, updated_at = $3 where party_id = $1`,
      [input.partyId, result.rawScore, computedAt],
    );

    await emitDomainEvent(client, {
      aggregateType: 'score',
      aggregateId: id,
      eventType: 'score.computed',
      payload: {
        model_key: result.modelKey,
        model_version: result.modelVersion,
        raw_score: result.rawScore,
        band: result.band,
        party_id: input.partyId,
      },
      actorKind: 'system',
    });
  }

  return { ...result, id, computedAt };
}

/** Recompute raw_score from persisted feature_snapshot + model_version (§8.1). */
export function recomputeHistoricalScore(
  featureSnapshot: RenterFeatures,
  modelVersion: string,
): ScoreResult {
  return replayFromSnapshot(featureSnapshot, modelVersion);
}

export async function loadScore(
  client: DbClient,
  scoreId: string,
): Promise<{
  id: string;
  model_version: string;
  raw_score: number;
  feature_snapshot: RenterFeatures;
  explanation: Record<string, unknown>;
} | null> {
  const { rows } = await client.query<{
    id: string;
    model_version: string;
    raw_score: string;
    feature_snapshot: RenterFeatures;
    explanation: Record<string, unknown>;
  }>(
    `select id, model_version, raw_score::text, feature_snapshot, explanation
     from score where id = $1`,
    [scoreId],
  );
  if (!rows[0]) return null;
  return {
    ...rows[0],
    raw_score: Number(rows[0].raw_score),
  };
}
