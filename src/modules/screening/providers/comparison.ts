import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { systemClock, type Clock } from '../../shared/clock.js';
import { getScreeningProviderAdapter } from './registry.js';
import type { ScreeningProviderId } from './types.js';

/** Official synthetic / canned scenarios — never real applicants. */
export const COMPARISON_SCENARIOS = [
  { key: 'checkr_hudson_green', provider: 'checkr_tenant' as const, label: 'Hudson Green (hosted UX)' },
  { key: 'checkr_herbert_humphrey', provider: 'checkr_tenant' as const, label: 'Herbert Humphrey (criminal consider)' },
  { key: 'checkr_madelyn_webster', provider: 'checkr_tenant' as const, label: 'Madelyn Webster (credit consider)' },
  { key: 'checkr_norma_davies', provider: 'checkr_tenant' as const, label: 'Norma Davies (eviction consider)' },
  { key: 'checkr_tim_watkins', provider: 'checkr_tenant' as const, label: 'Tim Watkins (multi consider)' },
  { key: 'checkr_ingrid_vance', provider: 'checkr_tenant' as const, label: 'Ingrid Vance (document income)' },
  { key: 'certn_sandbox_order', provider: 'certn' as const, label: 'Certn sandbox order create' },
] as const;

export type ComparisonRunRow = {
  id: string;
  scenario_key: string;
  provider: ScreeningProviderId;
  provider_screening_id: string | null;
  screening_status: string | null;
  applicant_flow_completed: boolean;
  request_latency_ms: number | null;
  webhook_received: boolean;
  report_available: boolean;
  error_code: string | null;
  provider_response_metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

/**
 * Record a comparison run row (sandbox / synthetic only).
 * Does not create live production screenings.
 */
export async function recordComparisonRun(
  client: DbClient,
  input: {
    scenarioKey: string;
    provider: ScreeningProviderId;
    providerScreeningId?: string | null;
    screeningStatus?: string | null;
    applicantFlowCompleted?: boolean;
    requestLatencyMs?: number | null;
    webhookReceived?: boolean;
    reportAvailable?: boolean;
    errorCode?: string | null;
    metadata?: Record<string, unknown>;
    actorPartyId?: string | null;
    clock?: Clock;
  },
): Promise<ComparisonRunRow> {
  const clock = input.clock ?? systemClock;
  const id = randomUUID();
  const { rows } = await client.query<ComparisonRunRow>(
    `insert into screening_comparison_run (
       id, scenario_key, provider, provider_screening_id, screening_status,
       applicant_flow_completed, request_latency_ms, webhook_received,
       report_available, error_code, provider_response_metadata, actor_party_id,
       created_at, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$13)
     returning *`,
    [
      id,
      input.scenarioKey,
      input.provider,
      input.providerScreeningId ?? null,
      input.screeningStatus ?? null,
      input.applicantFlowCompleted ?? false,
      input.requestLatencyMs ?? null,
      input.webhookReceived ?? false,
      input.reportAvailable ?? false,
      input.errorCode ?? null,
      JSON.stringify(sanitizeMetadata(input.metadata ?? {})),
      input.actorPartyId ?? null,
      clock.now(),
    ],
  );
  return rows[0]!;
}

export async function listComparisonRuns(
  client: DbClient,
  opts?: { provider?: ScreeningProviderId; limit?: number },
): Promise<ComparisonRunRow[]> {
  const limit = Math.min(opts?.limit ?? 100, 500);
  if (opts?.provider) {
    const { rows } = await client.query<ComparisonRunRow>(
      `select * from screening_comparison_run
       where provider = $1
       order by created_at desc
       limit $2`,
      [opts.provider, limit],
    );
    return rows;
  }
  const { rows } = await client.query<ComparisonRunRow>(
    `select * from screening_comparison_run
     order by created_at desc
     limit $1`,
    [limit],
  );
  return rows;
}

/**
 * Dry-run infrastructure probe for a provider (no real applicant).
 * Records latency + readiness into comparison_run.
 */
export async function probeProviderForComparison(
  client: DbClient,
  input: {
    provider: ScreeningProviderId;
    scenarioKey: string;
    actorPartyId: string;
  },
): Promise<ComparisonRunRow> {
  const adapter = getScreeningProviderAdapter(input.provider);
  const started = Date.now();
  if (!adapter.isInfrastructureReady()) {
    return recordComparisonRun(client, {
      scenarioKey: input.scenarioKey,
      provider: input.provider,
      screeningStatus: 'failed',
      requestLatencyMs: Date.now() - started,
      errorCode: 'infrastructure_not_ready',
      metadata: { ready: false },
      actorPartyId: input.actorPartyId,
    });
  }
  return recordComparisonRun(client, {
    scenarioKey: input.scenarioKey,
    provider: input.provider,
    screeningStatus: 'ready',
    requestLatencyMs: Date.now() - started,
    metadata: {
      ready: true,
      display_name: adapter.displayName,
      note: 'probe_only_no_order_created',
    },
    actorPartyId: input.actorPartyId,
  });
}

export function buildComparisonReport(runs: ComparisonRunRow[]): {
  by_provider: Record<
    string,
    {
      runs: number;
      errors: number;
      avg_latency_ms: number | null;
      webhooks: number;
      reports: number;
    }
  >;
  scenarios: typeof COMPARISON_SCENARIOS;
} {
  const by_provider: Record<
    string,
    {
      runs: number;
      errors: number;
      avg_latency_ms: number | null;
      webhooks: number;
      reports: number;
      _latencySum: number;
      _latencyN: number;
    }
  > = {};

  for (const run of runs) {
    const bucket = (by_provider[run.provider] ??= {
      runs: 0,
      errors: 0,
      avg_latency_ms: null,
      webhooks: 0,
      reports: 0,
      _latencySum: 0,
      _latencyN: 0,
    });
    bucket.runs += 1;
    if (run.error_code) bucket.errors += 1;
    if (run.webhook_received) bucket.webhooks += 1;
    if (run.report_available) bucket.reports += 1;
    if (run.request_latency_ms != null) {
      bucket._latencySum += run.request_latency_ms;
      bucket._latencyN += 1;
    }
  }

  const out: ReturnType<typeof buildComparisonReport>['by_provider'] = {};
  for (const [k, v] of Object.entries(by_provider)) {
    out[k] = {
      runs: v.runs,
      errors: v.errors,
      avg_latency_ms: v._latencyN ? Math.round(v._latencySum / v._latencyN) : null,
      webhooks: v.webhooks,
      reports: v.reports,
    };
  }
  return { by_provider: out, scenarios: COMPARISON_SCENARIOS };
}

function sanitizeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(meta)
    .replace(/ckr_sk_(live|test)_[A-Za-z0-9]+/g, 'ckr_sk_***')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '***-**-****');
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new AppError('invalid comparison metadata', 'validation_error', 400);
  }
}
