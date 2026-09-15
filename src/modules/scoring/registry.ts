import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';
import {
  FEATURE_SET_VERSION,
  RENTER_SCORE_MODEL_KEY,
  RULES_V0_VERSION,
} from './types.js';

const RULES_FEATURE_SPEC = {
  feature_set_version: FEATURE_SET_VERSION,
  features: [
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
  ],
  cohort_floor: 50,
};

export async function ensureRulesV0Registered(
  client: DbClient,
): Promise<{ modelKey: string; version: string }> {
  const { rows } = await client.query<{ model_key: string; version: string }>(
    `select model_key, version from model_registry
     where model_key = $1 and version = $2`,
    [RENTER_SCORE_MODEL_KEY, RULES_V0_VERSION],
  );
  if (rows[0]) {
    return { modelKey: rows[0].model_key, version: rows[0].version };
  }
  await client.query(
    `insert into model_registry (model_key, version, kind, feature_spec, activated_at)
     values ($1, $2, 'rules', $3::jsonb, now())
     on conflict (model_key, version) do nothing`,
    [RENTER_SCORE_MODEL_KEY, RULES_V0_VERSION, JSON.stringify(RULES_FEATURE_SPEC)],
  );
  return { modelKey: RENTER_SCORE_MODEL_KEY, version: RULES_V0_VERSION };
}

/** Active model for live scoring — must be rules-v0 while gate unmet. */
export async function getActiveRenterScoreModel(
  client: DbClient,
): Promise<{ modelKey: string; version: string; kind: string }> {
  const { rows } = await client.query<{
    model_key: string;
    version: string;
    kind: string;
  }>(
    `select model_key, version, kind from model_registry
     where model_key = $1
       and activated_at is not null
       and (retired_at is null or retired_at > now())
     order by activated_at desc
     limit 1`,
    [RENTER_SCORE_MODEL_KEY],
  );
  if (!rows[0]) {
    throw new AppError(
      'no active renter_score model in model_registry',
      'score_model_inactive',
      500,
    );
  }
  return {
    modelKey: rows[0].model_key,
    version: rows[0].version,
    kind: rows[0].kind,
  };
}

export async function isModelActivated(
  client: DbClient,
  modelKey: string,
  version: string,
): Promise<boolean> {
  const { rows } = await client.query<{ n: string }>(
    `select count(*)::text as n from model_registry
     where model_key = $1 and version = $2
       and activated_at is not null
       and (retired_at is null or retired_at > now())`,
    [modelKey, version],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}
