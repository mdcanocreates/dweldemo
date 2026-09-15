import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';
import { resolveConfig } from './config-version.js';

export async function resolveHoldTtlMs(
  client: DbClient,
  asOf: Date,
): Promise<number> {
  const cfg = await resolveConfig(client, 'hold_durations', asOf);
  const ms = Number(cfg?.hold_ttl_ms);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new AppError(
      'hold_durations.hold_ttl_ms missing from approved config',
      'config_required',
      500,
    );
  }
  return ms;
}

export type AuthSlaConfig = {
  magicTokenTtlMs: number;
  sessionTtlMs: number;
  elevationTtlMs: number;
  rebatePayoutDetailsTtlDays: number;
};

export async function resolveAuthSla(
  client: DbClient,
  asOf: Date,
): Promise<AuthSlaConfig> {
  const cfg = await resolveConfig(client, 'sla', asOf);
  if (!cfg) {
    throw new AppError('sla config missing', 'config_required', 500);
  }
  const magicTokenTtlMs = Number(cfg.magic_token_ttl_ms);
  const sessionTtlMs = Number(cfg.session_ttl_ms);
  const elevationTtlMs = Number(cfg.elevation_ttl_ms);
  const rebatePayoutDetailsTtlDays = Number(cfg.rebate_payout_details_ttl_days ?? 90);
  for (const [k, v] of Object.entries({
    magic_token_ttl_ms: magicTokenTtlMs,
    session_ttl_ms: sessionTtlMs,
    elevation_ttl_ms: elevationTtlMs,
  })) {
    if (!Number.isFinite(v) || v <= 0) {
      throw new AppError(`sla.${k} invalid`, 'config_invalid', 500);
    }
  }
  if (!Number.isFinite(rebatePayoutDetailsTtlDays) || rebatePayoutDetailsTtlDays <= 0) {
    throw new AppError('sla.rebate_payout_details_ttl_days invalid', 'config_invalid', 500);
  }
  return {
    magicTokenTtlMs,
    sessionTtlMs,
    elevationTtlMs,
    rebatePayoutDetailsTtlDays,
  };
}
