import type { DbClient } from '../../db/pool.js';
import { resolveConfig } from '../config/index.js';
import { AppError } from '../shared/errors.js';
import { systemClock, type Clock } from '../shared/clock.js';

/** Launch package identity per §7.3 — cost lives in screening_package.total_cost_cents. */
export const STANDARD_PACKAGE = {
  packageKey: 'standard',
  version: '1',
  vendor: 'certn',
  productCodes: ['oneid', 'criminal_tier_1', 'credit_equifax', 'risk_insight'],
} as const;

export async function ensureStandardPackage(
  client: DbClient,
): Promise<{ id: string }> {
  const { rows: existing } = await client.query<{ id: string }>(
    `select id from screening_package where package_key = $1 and version = $2`,
    [STANDARD_PACKAGE.packageKey, STANDARD_PACKAGE.version],
  );
  if (existing[0]) {
    await client.query(`update screening_package set is_active = true where id = $1`, [
      existing[0].id,
    ]);
    return { id: existing[0].id };
  }
  throw new AppError(
    'screening_package standard/1 missing — seed via migration (total_cost_cents catalog)',
    'package_not_seeded',
    500,
  );
}

export async function getActivePackage(
  client: DbClient,
  packageKey = 'standard',
): Promise<{
  id: string;
  package_key: string;
  version: string;
  vendor: string;
  product_codes: string[];
  total_cost_cents: number;
}> {
  const { rows } = await client.query<{
    id: string;
    package_key: string;
    version: string;
    vendor: string;
    product_codes: string[];
    total_cost_cents: number;
  }>(
    `select id, package_key, version, vendor, product_codes, total_cost_cents
     from screening_package
     where package_key = $1 and is_active = true
     order by version desc
     limit 1`,
    [packageKey],
  );
  if (!rows[0]) throw new AppError('screening package not found', 'package_not_found', 404);
  return rows[0];
}

/**
 * D-02 — report_portability_days from config_version when present.
 * Production path requires config; tests seed TEST_ONLY defaults into config_version.
 */
export async function resolveReportPortabilityDays(
  client: DbClient,
  clock: Clock = systemClock,
): Promise<number> {
  const cfg = await resolveConfig(client, 'screening_policy', clock.now());
  if (!cfg || cfg.report_portability_days == null) {
    throw new AppError(
      'report_portability_days missing from screening_policy config (D-02)',
      'config_required',
      500,
    );
  }
  const days = Number(cfg.report_portability_days);
  if (!Number.isFinite(days) || days <= 0) {
    throw new AppError('invalid report_portability_days', 'config_invalid', 500);
  }
  return days;
}

/** D-15 — must remain false until Klaus/Jacob decision. */
export async function isRiskInsightAutoAdverseEnabled(
  client: DbClient,
  clock: Clock = systemClock,
): Promise<boolean> {
  const cfg = await resolveConfig(client, 'screening_policy', clock.now());
  if (!cfg) return false;
  return cfg.risk_insight_auto_adverse_action_enabled === true;
}

export async function resolveVerificationConfidence(
  client: DbClient,
  method: string,
  clock: Clock = systemClock,
): Promise<number> {
  const cfg = await resolveConfig(client, 'verification_confidence', clock.now());
  if (!cfg || typeof cfg[method] !== 'number') {
    throw new AppError(
      `verification_confidence.${method} missing from config`,
      'config_required',
      500,
    );
  }
  return Number(cfg[method]);
}

export async function resolveFraudThresholds(
  client: DbClient,
  clock: Clock = systemClock,
): Promise<Record<string, number>> {
  const cfg = await resolveConfig(client, 'fraud_thresholds', clock.now());
  if (!cfg) {
    throw new AppError('fraud_thresholds config missing', 'config_required', 500);
  }
  return cfg as Record<string, number>;
}
