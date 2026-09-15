import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';
import { systemClock, type Clock } from '../shared/clock.js';
import {
  resolveSolarTiersConfig,
  resolveSolarUnderwritingConfig,
  resolveTier,
} from './config.js';
import {
  runSolarUnderwriting,
  SOLAR_ENGINE_VERSION,
  type UnderwritingResult,
} from './engine.js';
import { assertSolarModelActive, ensureSolarUnderwritingModel } from './registry.js';
import { journalSolarApprovalAccrual } from './ledger-flows.js';

export type SubmitSolarDealInput = {
  homeownerPartyId: string;
  partnerOrgId: string;
  systemSizeKw: number;
  grossProjectCostCents: number;
  salePriceCents: number;
  redlineCents?: number | null;
  repPartyId?: string | null;
  externalProjectRef?: string | null;
  addressId?: string | null;
  /** B-8: optional quick-quote token — skip engine if valid. */
  quoteToken?: string | null;
  clock?: Clock;
};

export type SubmitSolarDealResult = {
  dealId: string;
  status: string;
  decision: UnderwritingResult;
  decisionId: string;
};

/**
 * Deal intake + synchronous underwriting (§13.4).
 * submitted → underwriting → approved | declined in one call.
 */
export async function submitSolarDeal(
  client: DbClient,
  input: SubmitSolarDealInput,
): Promise<SubmitSolarDealResult> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();

  await ensureSolarUnderwritingModel(client);
  await assertSolarModelActive(client);

  // Validate partner org is solar_partner
  const { rows: orgs } = await client.query<{ id: string; kind: string }>(
    `select id, kind from org where id = $1`,
    [input.partnerOrgId],
  );
  if (!orgs[0]) throw new AppError('partner org not found', 'org_not_found', 404);
  if (orgs[0].kind !== 'solar_partner') {
    throw new AppError('partner org must be kind=solar_partner', 'invalid_org_kind', 400);
  }

  const dealId = randomUUID();
  await client.query(
    `insert into solar_deal (
       id, homeowner_party_id, rep_party_id, partner_org_id, external_project_ref,
       address_id, system_size_kw, gross_project_cost_cents, redline_cents,
       sale_price_cents, status, submitted_at, created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'submitted',$11,$11)`,
    [
      dealId,
      input.homeownerPartyId,
      input.repPartyId ?? null,
      input.partnerOrgId,
      input.externalProjectRef ?? null,
      input.addressId ?? null,
      input.systemSizeKw,
      input.grossProjectCostCents,
      input.redlineCents ?? null,
      input.salePriceCents,
      now,
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'solar_deal',
    aggregateId: dealId,
    eventType: 'solar_deal.submitted',
    payload: {
      partner_org_id: input.partnerOrgId,
      system_size_kw: input.systemSizeKw,
      gross_project_cost_cents: input.grossProjectCostCents,
    },
    actorPartyId: input.homeownerPartyId,
    actorKind: 'user',
    occurredAt: now,
  });

  await client.query(`update solar_deal set status = 'underwriting' where id = $1`, [
    dealId,
  ]);
  await emitDomainEvent(client, {
    aggregateType: 'solar_deal',
    aggregateId: dealId,
    eventType: 'solar_deal.underwriting',
    payload: {},
    actorKind: 'system',
    occurredAt: now,
  });

  const uwConfig = await resolveSolarUnderwritingConfig(client, now);
  const tiersConfig = await resolveSolarTiersConfig(client, now);
  const tierDef = resolveTier(input.systemSizeKw, tiersConfig.tiers);

  let decision: UnderwritingResult;
  let usedQuoteToken = false;

  if (input.quoteToken) {
    const { verifyQuoteToken } = await import('./quick-quote.js');
    const verified = verifyQuoteToken(input.quoteToken, clock);
    if (verified.valid && verified.engineResult) {
      decision = verified.engineResult;
      usedQuoteToken = true;
    } else if (verified.expired) {
      decision = runSolarUnderwriting({
        system_size_kw: input.systemSizeKw,
        gross_project_cost_cents: input.grossProjectCostCents,
        sale_price_cents: input.salePriceCents,
        redline_cents: input.redlineCents ?? null,
        underwriting_config: {
          installed_cost_basis_cents_per_watt: uwConfig.installedCostBasisCentsPerWatt,
          net_profit_pool_bps: uwConfig.netProfitPoolBps,
          rbit_share_of_net_bps: uwConfig.rbitShareOfNetBps,
          net_to_rbit_floor_cents: uwConfig.netToRbitFloorCents,
          minimum_viable_cashback_cents: uwConfig.minimumViableCashbackCents,
        },
        tier: tierDef.tier,
        tier_cap_cents: tierDef.capCents,
        tiers_config_version_id: tiersConfig.configVersionId,
        underwriting_config_version_id: uwConfig.configVersionId,
      });
      await emitDomainEvent(client, {
        aggregateType: 'solar_deal',
        aggregateId: dealId,
        eventType: 'solar_quote.expired_rerun',
        payload: {
          quoted_cashback: verified.payload?.approved_cashback_cents ?? null,
          new_cashback: decision.approved_cashback_cents,
          differed:
            verified.payload?.approved_cashback_cents !==
            decision.approved_cashback_cents,
        },
        actorKind: 'system',
        occurredAt: now,
      });
    } else {
      throw new AppError('invalid quote_token', 'bad_request', 400);
    }
  } else {
    decision = runSolarUnderwriting({
      system_size_kw: input.systemSizeKw,
      gross_project_cost_cents: input.grossProjectCostCents,
      sale_price_cents: input.salePriceCents,
      redline_cents: input.redlineCents ?? null,
      underwriting_config: {
        installed_cost_basis_cents_per_watt: uwConfig.installedCostBasisCentsPerWatt,
        net_profit_pool_bps: uwConfig.netProfitPoolBps,
        rbit_share_of_net_bps: uwConfig.rbitShareOfNetBps,
        net_to_rbit_floor_cents: uwConfig.netToRbitFloorCents,
        minimum_viable_cashback_cents: uwConfig.minimumViableCashbackCents,
      },
      tier: tierDef.tier,
      tier_cap_cents: tierDef.capCents,
      tiers_config_version_id: tiersConfig.configVersionId,
      underwriting_config_version_id: uwConfig.configVersionId,
    });
  }

  void usedQuoteToken;

  const decisionId = randomUUID();
  await client.query(
    `insert into solar_underwriting_decision (
       id, solar_deal_id, engine_version, config_version_id, tier, tier_cap_cents,
       equation_1_passed, equation_1_net_to_rbit_cents, equation_2_applied,
       adjusted_cap_cents, approved_cashback_cents, net_to_rbit_cents,
       decision, decline_reason, input_snapshot, explanation, computed_at
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17
     )`,
    [
      decisionId,
      dealId,
      SOLAR_ENGINE_VERSION,
      uwConfig.configVersionId,
      decision.tier,
      decision.tier_cap_cents,
      decision.equation_1_passed,
      decision.equation_1_net_to_rbit_cents,
      decision.equation_2_applied,
      decision.adjusted_cap_cents,
      decision.approved_cashback_cents,
      decision.net_to_rbit_cents,
      decision.decision,
      decision.decline_reason,
      JSON.stringify(decision.input_snapshot),
      JSON.stringify(decision.explanation),
      now,
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'solar_underwriting_decision',
    aggregateId: decisionId,
    eventType: 'solar_underwriting.computed',
    payload: {
      solar_deal_id: dealId,
      decision: decision.decision,
      approved_cashback_cents: decision.approved_cashback_cents,
      equation_2_applied: decision.equation_2_applied,
      engine_version: SOLAR_ENGINE_VERSION,
      config_version_id: uwConfig.configVersionId,
    },
    actorKind: 'system',
    occurredAt: now,
  });

  const nextStatus = decision.decision === 'approved' ? 'approved' : 'declined';
  await client.query(
    `update solar_deal set status = $2, decided_at = $3 where id = $1`,
    [dealId, nextStatus, now],
  );
  await emitDomainEvent(client, {
    aggregateType: 'solar_deal',
    aggregateId: dealId,
    eventType: `solar_deal.${nextStatus}`,
    payload: {
      decision_id: decisionId,
      approved_cashback_cents: decision.approved_cashback_cents,
      decline_reason: decision.decline_reason,
    },
    actorKind: 'system',
    occurredAt: now,
  });

  if (decision.decision === 'approved' && decision.approved_cashback_cents > 0) {
    await journalSolarApprovalAccrual(client, {
      solarDealId: dealId,
      expectedProfitShareCents: decision.expected_profit_share_cents,
      approvedCashbackCents: decision.approved_cashback_cents,
      clock,
    });
  }

  return { dealId, status: nextStatus, decision, decisionId };
}

export async function markSolarDealInstalled(
  client: DbClient,
  dealId: string,
  clock: Clock = systemClock,
): Promise<void> {
  const now = clock.now();
  const { rows } = await client.query<{ status: string }>(
    `select status from solar_deal where id = $1 for update`,
    [dealId],
  );
  const deal = rows[0];
  if (!deal) throw new AppError('solar_deal not found', 'solar_deal_not_found', 404);
  if (deal.status !== 'approved') {
    throw new AppError(
      `cannot mark installed from status=${deal.status}`,
      'solar_invalid_transition',
      409,
    );
  }
  await client.query(
    `update solar_deal set status = 'installed', installed_at = $2 where id = $1`,
    [dealId, now],
  );
  await emitDomainEvent(client, {
    aggregateType: 'solar_deal',
    aggregateId: dealId,
    eventType: 'solar_deal.installed',
    payload: {},
    actorKind: 'system',
    occurredAt: now,
  });
}

export async function cancelSolarDeal(
  client: DbClient,
  dealId: string,
  clock: Clock = systemClock,
): Promise<void> {
  const now = clock.now();
  const { rows } = await client.query<{ status: string }>(
    `select status from solar_deal where id = $1 for update`,
    [dealId],
  );
  const deal = rows[0];
  if (!deal) throw new AppError('solar_deal not found', 'solar_deal_not_found', 404);
  if (deal.status !== 'approved') {
    throw new AppError(
      `cannot cancel from status=${deal.status}`,
      'solar_invalid_transition',
      409,
    );
  }
  await client.query(`update solar_deal set status = 'cancelled' where id = $1`, [dealId]);
  await emitDomainEvent(client, {
    aggregateType: 'solar_deal',
    aggregateId: dealId,
    eventType: 'solar_deal.cancelled',
    payload: {},
    actorKind: 'system',
    occurredAt: now,
  });
}

export async function getLatestUnderwritingDecision(
  client: DbClient,
  dealId: string,
): Promise<{
  id: string;
  engine_version: string;
  config_version_id: string;
  approved_cashback_cents: number;
  decision: string;
  equation_2_applied: boolean;
  explanation: Record<string, unknown>;
  input_snapshot: Record<string, unknown>;
} | null> {
  const { rows } = await client.query<{
    id: string;
    engine_version: string;
    config_version_id: string;
    approved_cashback_cents: number;
    decision: string;
    equation_2_applied: boolean;
    explanation: Record<string, unknown>;
    input_snapshot: Record<string, unknown>;
  }>(
    `select id, engine_version, config_version_id, approved_cashback_cents, decision,
            equation_2_applied, explanation, input_snapshot
     from solar_underwriting_decision
     where solar_deal_id = $1
     order by computed_at desc
     limit 1`,
    [dealId],
  );
  return rows[0] ?? null;
}
