/**
 * B-8 — Solar rep quick-quote (no DB row). Quote token is HMAC-signed JSON, 15min TTL.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { resolveConfig } from '../config/index.js';
import { AppError } from '../shared/errors.js';
import { systemClock, type Clock } from '../shared/clock.js';
import {
  resolveSolarTiersConfig,
  resolveSolarUnderwritingConfig,
  resolveTier,
} from './config.js';
import { runSolarUnderwriting, type UnderwritingResult } from './engine.js';
import { assertSolarModelActive, ensureSolarUnderwritingModel } from './registry.js';

const QUOTE_SECRET =
  process.env.RBIT_SOLAR_QUOTE_SECRET ?? 'rbit-dev-solar-quote-not-for-prod';

function signPayload(payload: string): string {
  return createHmac('sha256', QUOTE_SECRET).update(payload).digest('base64url');
}

export type QuickQuoteResult = {
  tier: number;
  tier_name: string;
  approved_cashback_cents: number;
  approved_cashback_display: string;
  equation_path: 'eq1_passed' | 'eq2_adjusted' | 'declined';
  explanation: string;
  plain_language: string;
  quote_expires_at: string;
  quote_token: string;
  decline_code?: string;
};

async function assertSolarRep(client: DbClient, partyId: string): Promise<void> {
  const { rows } = await client.query<{ n: string }>(
    `select count(*)::text as n from party_role
     where party_id = $1 and role = 'solar_rep' and revoked_at is null`,
    [partyId],
  );
  if (Number(rows[0]?.n ?? 0) < 1) {
    throw new AppError('solar_rep role required', 'forbidden', 403);
  }
}

function formatCashback(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function equationPath(r: UnderwritingResult): QuickQuoteResult['equation_path'] {
  if (r.decision === 'declined') return 'declined';
  if (r.equation_2_applied) return 'eq2_adjusted';
  return 'eq1_passed';
}

export async function quickQuoteSolar(
  client: DbClient,
  input: {
    actorPartyId: string;
    salePriceCents: number;
    systemSizeKw: number;
    zipCode: string;
    clock?: Clock;
  },
): Promise<QuickQuoteResult> {
  const clock = input.clock ?? systemClock;
  await assertSolarRep(client, input.actorPartyId);
  await ensureSolarUnderwritingModel(client);
  await assertSolarModelActive(client);

  const uw = await resolveSolarUnderwritingConfig(client, clock.now());
  const tiers = await resolveSolarTiersConfig(client, clock.now());
  const tier = resolveTier(input.systemSizeKw, tiers.tiers);

  const result = runSolarUnderwriting({
    system_size_kw: input.systemSizeKw,
    gross_project_cost_cents: input.salePriceCents,
    sale_price_cents: input.salePriceCents,
    redline_cents: null,
    underwriting_config: {
      installed_cost_basis_cents_per_watt: uw.installedCostBasisCentsPerWatt,
      net_profit_pool_bps: uw.netProfitPoolBps,
      rbit_share_of_net_bps: uw.rbitShareOfNetBps,
      net_to_rbit_floor_cents: uw.netToRbitFloorCents,
      minimum_viable_cashback_cents: uw.minimumViableCashbackCents,
    },
    tier: tier.tier,
    tier_cap_cents: tier.capCents,
    tiers_config_version_id: tiers.configVersionId,
    underwriting_config_version_id: uw.configVersionId,
  });

  const path = equationPath(result);
  const tierName = `Tier ${tier.tier}`;
  const display = formatCashback(result.approved_cashback_cents);

  const templates =
    (await resolveConfig(client, 'solar_explanation_templates', clock.now())) ?? {};
  let plain =
    (templates.plain_language as string) ??
    'Your customer qualifies for up to {cashback_display} cash back, paid after installation is complete.';
  plain = plain
    .replaceAll('{system_size_kw}', String(input.systemSizeKw))
    .replaceAll('{tier_name}', tierName)
    .replaceAll('{cashback_display}', display);
  if (path === 'eq2_adjusted') {
    plain = `${plain} (adjusted based on deal margin)`;
  }

  const expires = new Date(clock.now().getTime() + 15 * 60_000);
  const body = JSON.stringify({
    sale_price_cents: input.salePriceCents,
    system_size_kw: input.systemSizeKw,
    zip_code: input.zipCode,
    decision: result.decision,
    approved_cashback_cents: result.approved_cashback_cents,
    net_to_rbit_cents: result.net_to_rbit_cents,
    tier: result.tier,
    tier_cap_cents: result.tier_cap_cents,
    equation_1_passed: result.equation_1_passed,
    equation_2_applied: result.equation_2_applied,
    equation_path: path,
    engine_result: result,
    expires_at: expires.toISOString(),
  });
  const quote_token = `${Buffer.from(body).toString('base64url')}.${signPayload(body)}`;

  if (result.decision === 'declined') {
    return {
      tier: result.tier,
      tier_name: tierName,
      approved_cashback_cents: 0,
      approved_cashback_display: '$0',
      equation_path: 'declined',
      explanation: 'This system size does not currently qualify for cash back.',
      plain_language: 'This quote does not qualify for cash back at this time.',
      quote_expires_at: expires.toISOString(),
      quote_token,
      decline_code: 'declined',
    };
  }

  return {
    tier: result.tier,
    tier_name: tierName,
    approved_cashback_cents: result.approved_cashback_cents,
    approved_cashback_display: display,
    equation_path: path,
    explanation: `Your ${input.systemSizeKw}kW system qualifies for ${tierName}.`,
    plain_language: plain,
    quote_expires_at: expires.toISOString(),
    quote_token,
  };
}

export function verifyQuoteToken(
  token: string,
  clock: Clock = systemClock,
): {
  valid: boolean;
  expired: boolean;
  payload: Record<string, unknown> | null;
  engineResult: UnderwritingResult | null;
} {
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) {
    return { valid: false, expired: false, payload: null, engineResult: null };
  }
  const body = Buffer.from(b64, 'base64url').toString('utf8');
  const expect = signPayload(body);
  try {
    if (
      expect.length !== sig.length ||
      !timingSafeEqual(Buffer.from(expect), Buffer.from(sig))
    ) {
      return { valid: false, expired: false, payload: null, engineResult: null };
    }
  } catch {
    return { valid: false, expired: false, payload: null, engineResult: null };
  }
  const payload = JSON.parse(body) as Record<string, unknown>;
  const exp = Date.parse(String(payload.expires_at));
  const engineResult = (payload.engine_result as UnderwritingResult) ?? null;
  if (exp < clock.now().getTime()) {
    return { valid: false, expired: true, payload, engineResult };
  }
  return { valid: true, expired: false, payload, engineResult };
}
