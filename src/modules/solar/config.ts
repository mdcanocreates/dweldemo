/**
 * Solar underwriting config — values live in config_version only (P8).
 * TEST_ONLY seeds supply reference model params for acceptance tests.
 */

import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';

export type SolarUnderwritingConfig = {
  configVersionId: string;
  version: string;
  installedCostBasisCentsPerWatt: number;
  netProfitPoolBps: number;
  rbitShareOfNetBps: number;
  netToRbitFloorCents: number;
  minimumViableCashbackCents: number;
  raw: Record<string, unknown>;
};

export type SolarTierDef = {
  tier: number;
  sizeMinKw: number;
  sizeMaxKw: number;
  capCents: number;
};

export type SolarTiersConfig = {
  configVersionId: string;
  version: string;
  tiers: SolarTierDef[];
  raw: Record<string, unknown>;
};

async function loadApprovedConfig(
  client: DbClient,
  namespace: string,
  asOf: Date,
): Promise<{ id: string; version: string; payload: Record<string, unknown> }> {
  const { rows } = await client.query<{
    id: string;
    version: string;
    payload: Record<string, unknown>;
  }>(
    `select id, version, payload from config_version
     where namespace = $1
       and approved_by_party_id is not null
       and effective_from <= $2
       and (effective_to is null or effective_to > $2)
     order by effective_from desc, approved_at desc nulls last
     limit 1`,
    [namespace, asOf],
  );
  const row = rows[0];
  if (!row) {
    throw new AppError(
      `no approved config for namespace ${namespace}`,
      'solar_config_missing',
      500,
    );
  }
  return row;
}

function requireNumber(payload: Record<string, unknown>, key: string): number {
  const v = payload[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new AppError(`solar config missing numeric ${key}`, 'solar_config_invalid', 500);
  }
  return v;
}

export async function resolveSolarUnderwritingConfig(
  client: DbClient,
  asOf: Date = new Date(),
): Promise<SolarUnderwritingConfig> {
  const row = await loadApprovedConfig(client, 'solar_underwriting', asOf);
  const p = row.payload;
  return {
    configVersionId: row.id,
    version: row.version,
    installedCostBasisCentsPerWatt: requireNumber(p, 'installed_cost_basis_cents_per_watt'),
    netProfitPoolBps: requireNumber(p, 'net_profit_pool_bps'),
    rbitShareOfNetBps: requireNumber(p, 'rbit_share_of_net_bps'),
    netToRbitFloorCents: requireNumber(p, 'net_to_rbit_floor_cents'),
    minimumViableCashbackCents: requireNumber(p, 'minimum_viable_cashback_cents'),
    raw: p,
  };
}

export async function resolveSolarTiersConfig(
  client: DbClient,
  asOf: Date = new Date(),
): Promise<SolarTiersConfig> {
  const row = await loadApprovedConfig(client, 'solar_tiers', asOf);
  const tiersRaw = row.payload.tiers;
  if (!Array.isArray(tiersRaw) || tiersRaw.length === 0) {
    throw new AppError('solar_tiers payload.tiers required', 'solar_config_invalid', 500);
  }
  const tiers: SolarTierDef[] = tiersRaw.map((t) => {
    const o = t as Record<string, unknown>;
    return {
      tier: Number(o.tier),
      sizeMinKw: Number(o.size_min_kw),
      sizeMaxKw: Number(o.size_max_kw),
      capCents: Number(o.cap_cents),
    };
  });
  return {
    configVersionId: row.id,
    version: row.version,
    tiers,
    raw: row.payload,
  };
}

/**
 * Tier bands: [min, max) for tiers 1–3; [min, max] inclusive for tier 4.
 * 15 kW → tier 2, 25 → tier 3, 35 → tier 4.
 */
export function resolveTier(
  systemSizeKw: number,
  tiers: SolarTierDef[],
): SolarTierDef {
  const sorted = [...tiers].sort((a, b) => a.tier - b.tier);
  for (const t of sorted) {
    const isLast = t.tier === sorted[sorted.length - 1]!.tier;
    if (isLast) {
      if (systemSizeKw >= t.sizeMinKw && systemSizeKw <= t.sizeMaxKw) return t;
    } else if (systemSizeKw >= t.sizeMinKw && systemSizeKw < t.sizeMaxKw) {
      return t;
    }
  }
  throw new AppError(
    `system_size_kw ${systemSizeKw} outside configured tier bands`,
    'solar_tier_out_of_range',
    400,
  );
}
