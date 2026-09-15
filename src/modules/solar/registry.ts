import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';
import { SOLAR_ENGINE_MODEL_KEY, SOLAR_ENGINE_VERSION } from './engine.js';

/** Ensure solar_underwriting rules model is registered and active. */
export async function ensureSolarUnderwritingModel(
  client: DbClient,
): Promise<{ modelKey: string; version: string }> {
  const { rows } = await client.query<{ model_key: string; version: string }>(
    `select model_key, version from model_registry
     where model_key = $1 and version = $2`,
    [SOLAR_ENGINE_MODEL_KEY, SOLAR_ENGINE_VERSION],
  );
  if (rows[0]) {
    return { modelKey: rows[0].model_key, version: rows[0].version };
  }
  await client.query(
    `insert into model_registry (model_key, version, kind, feature_spec, activated_at)
     values ($1, $2, 'rules', $3::jsonb, now())
     on conflict (model_key, version) do nothing`,
    [
      SOLAR_ENGINE_MODEL_KEY,
      SOLAR_ENGINE_VERSION,
      JSON.stringify({
        inputs: [
          'system_size_kw',
          'gross_project_cost_cents',
          'sale_price_cents',
          'redline_cents',
          'tier',
          'tier_cap_cents',
        ],
        config_namespaces: ['solar_underwriting', 'solar_tiers'],
      }),
    ],
  );
  return { modelKey: SOLAR_ENGINE_MODEL_KEY, version: SOLAR_ENGINE_VERSION };
}

export async function assertSolarModelActive(client: DbClient): Promise<void> {
  const { rows } = await client.query<{ id: string; kind: string }>(
    `select id, kind from model_registry
     where model_key = $1 and version = $2
       and activated_at is not null
       and (retired_at is null or retired_at > now())`,
    [SOLAR_ENGINE_MODEL_KEY, SOLAR_ENGINE_VERSION],
  );
  if (!rows[0]) {
    throw new AppError(
      'solar_underwriting model not active in model_registry',
      'solar_model_inactive',
      500,
    );
  }
  if (rows[0].kind !== 'rules') {
    throw new AppError('solar_underwriting must be kind=rules', 'solar_model_kind', 500);
  }
}
