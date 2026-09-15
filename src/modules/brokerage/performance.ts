/**
 * B-4 — Broker performance dashboard (replica reads of materialised metrics).
 */

import type pg from 'pg';
import type { DbClient } from '../../db/pool.js';
import { resolveConfig } from '../config/index.js';
import { AppError } from '../shared/errors.js';

export type ReplicaQueryLogEntry = {
  sql: string;
  at: Date;
  path: 'replica';
};

/** Wraps a client and tags all queries as replica reads (P9). */
export class ReplicaQueryClient {
  readonly queryLog: ReplicaQueryLogEntry[] = [];
  constructor(private readonly inner: DbClient) {}

  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<T>> {
    this.queryLog.push({ sql: text, at: new Date(), path: 'replica' });
    return this.inner.query<T>(text, params);
  }
}

async function assertBrokerOrgMember(
  client: DbClient,
  partyId: string,
  orgId: string,
): Promise<void> {
  const { rows } = await client.query<{ n: string }>(
    `select count(*)::text as n from party_role
     where party_id = $1 and org_id = $2
       and role in ('broker','broker_admin','agent')
       and revoked_at is null`,
    [partyId, orgId],
  );
  if (Number(rows[0]?.n ?? 0) < 1) {
    throw new AppError('broker role required', 'forbidden', 403);
  }
}

export async function resolveBlendedBrokerMargin(
  client: DbClient,
  asOf = new Date(),
): Promise<number> {
  const cfg = await resolveConfig(client, 'broker_economics', asOf);
  if (!cfg || cfg.blended_broker_margin == null) {
    throw new AppError(
      'blended_broker_margin missing from broker_economics config',
      'config_required',
      500,
    );
  }
  return Number(cfg.blended_broker_margin);
}

export async function getBrokerPerformance(
  replica: ReplicaQueryClient,
  authClient: DbClient,
  input: {
    partyId: string;
    orgId: string;
    windowDays?: 30 | 60 | 90;
  },
): Promise<Record<string, unknown>> {
  await assertBrokerOrgMember(authClient, input.partyId, input.orgId);
  const windowDays = input.windowDays ?? 90;
  if (![30, 60, 90].includes(windowDays)) {
    throw new AppError('window_days must be 30|60|90', 'bad_request', 400);
  }

  const margin = await resolveBlendedBrokerMargin(authClient);

  const { rows } = await replica.query<{
    leads_offered: number;
    leads_accepted: number;
    placements_closed: number;
    close_rate: string | null;
    median_response_seconds: number | null;
    leakage_rate: string | null;
    dispute_count: number;
    prior_leads_offered: number;
    prior_leads_accepted: number;
    prior_placements_closed: number;
    prior_close_rate: string | null;
    prior_median_response_seconds: number | null;
    prior_leakage_rate: string | null;
    prior_dispute_count: number;
  }>(
    `select leads_offered, leads_accepted, placements_closed, close_rate::text,
            median_response_seconds, leakage_rate::text, dispute_count,
            prior_leads_offered, prior_leads_accepted, prior_placements_closed,
            prior_close_rate::text, prior_median_response_seconds,
            prior_leakage_rate::text, prior_dispute_count
     from broker_performance where org_id = $1`,
    [input.orgId],
  );
  const row = rows[0];
  if (!row) {
    throw new AppError('broker performance not found', 'not_found', 404);
  }

  const closeRate = row.close_rate != null ? Number(row.close_rate) : 0;
  const acceptanceRate =
    row.leads_offered > 0 ? row.leads_accepted / row.leads_offered : 0;
  const evPerLead = closeRate * margin;

  // Percentile of close_rate among brokers sharing coverage submarkets — anonymised
  const { rows: rankOk } = await replica.query<{ rank_in_submarket: string }>(
    `with peers as (
       select distinct bp.org_id, coalesce(bp.close_rate, 0) as close_rate
       from broker_coverage bc
       join broker_coverage peer on peer.submarket_id = bc.submarket_id and peer.is_active
       join broker_performance bp on bp.org_id = peer.org_id
       where bc.org_id = $1 and bc.is_active
     ),
     ranked as (
       select org_id,
              percent_rank() over (order by close_rate) * 100 as pct
       from peers
     )
     select pct::text as rank_in_submarket from ranked where org_id = $1`,
    [input.orgId],
  );

  const { rows: best } = await replica.query<{ submarket_id: string }>(
    `select submarket_id::text
     from broker_performance_submarket
     where org_id = $1 and window_days = $2
     order by close_rate desc nulls last
     limit 1`,
    [input.orgId, windowDays],
  );

  return {
    leads_offered: row.leads_offered,
    leads_accepted: row.leads_accepted,
    acceptance_rate: acceptanceRate,
    placements_closed: row.placements_closed,
    close_rate: closeRate,
    median_response_seconds: row.median_response_seconds,
    leakage_rate: row.leakage_rate != null ? Number(row.leakage_rate) : 0,
    dispute_count: row.dispute_count,
    ev_per_lead: evPerLead,
    window_days: windowDays,
    rank_in_submarket:
      rankOk[0] != null ? Math.round(Number(rankOk[0].rank_in_submarket)) : null,
    best_performing_submarket: best[0]?.submarket_id ?? null,
    trend: {
      window_days: windowDays,
      leads_offered: row.prior_leads_offered,
      leads_accepted: row.prior_leads_accepted,
      placements_closed: row.prior_placements_closed,
      close_rate: row.prior_close_rate != null ? Number(row.prior_close_rate) : 0,
      median_response_seconds: row.prior_median_response_seconds,
      leakage_rate:
        row.prior_leakage_rate != null ? Number(row.prior_leakage_rate) : 0,
      dispute_count: row.prior_dispute_count,
    },
  };
}

export async function getBrokerPerformanceLeads(
  replica: ReplicaQueryClient,
  authClient: DbClient,
  input: {
    partyId: string;
    orgId: string;
    status?: string | null;
    from?: Date | null;
    to?: Date | null;
    limit?: number;
    offset?: number;
  },
): Promise<{ items: unknown[]; total: number }> {
  await assertBrokerOrgMember(authClient, input.partyId, input.orgId);
  const limit = Math.min(input.limit ?? 50, 100);
  const offset = input.offset ?? 0;
  const params: unknown[] = [input.orgId];
  const where = [`lo.broker_org_id = $1`];
  if (input.status) {
    params.push(input.status);
    where.push(`l.status = $${params.length}`);
  }
  if (input.from) {
    params.push(input.from);
    where.push(`lo.offered_at >= $${params.length}`);
  }
  if (input.to) {
    params.push(input.to);
    where.push(`lo.offered_at <= $${params.length}`);
  }

  const { rows: countRows } = await replica.query<{ n: string }>(
    `select count(*)::text as n
     from lead_offer lo
     join lead l on l.id = lo.lead_id
     where ${where.join(' and ')}`,
    params,
  );

  params.push(limit, offset);
  const { rows } = await replica.query(
    `select l.id as lead_id, l.rs_tier, l.fee_amount_cents, lo.offered_at, l.status,
            p.status as placement_status,
            po.payment_status as outcome_payment_status,
            case
              when l.status = 'closed' and p.id is not null then 'closed_on_platform'
              when l.status = 'resolved' then 'closed_off_platform'
              when l.status = 'expired' then 'lapsed'
              else l.status
            end as resolution
     from lead_offer lo
     join lead l on l.id = lo.lead_id
     left join placement p on p.application_id = l.application_id and p.broker_org_id = lo.broker_org_id
     left join placement_outcome po on po.placement_id = p.id and po.horizon_days = 30
     where ${where.join(' and ')}
     order by lo.offered_at desc
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );

  return { items: rows, total: Number(countRows[0]!.n) };
}

export async function getBrokerPerformanceSubmarkets(
  replica: ReplicaQueryClient,
  authClient: DbClient,
  input: { partyId: string; orgId: string; windowDays?: 30 | 60 | 90 },
): Promise<unknown[]> {
  await assertBrokerOrgMember(authClient, input.partyId, input.orgId);
  const windowDays = input.windowDays ?? 90;
  const { rows } = await replica.query(
    `select bps.submarket_id::text, s.name,
            bps.leads_offered, bps.leads_accepted, bps.placements_closed,
            bps.close_rate, bps.median_response_seconds
     from broker_performance_submarket bps
     join submarket s on s.id = bps.submarket_id
     where bps.org_id = $1 and bps.window_days = $2
     order by bps.close_rate desc nulls last`,
    [input.orgId, windowDays],
  );
  return rows;
}
