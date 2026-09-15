import type { DbClient } from '../../db/pool.js';
import { credentialExpiryRunwayDays } from './credentials.js';
import { getBreakerState } from './rate-limit.js';
import { DEFAULT_INGESTION_THRESHOLDS } from './types.js';

export type SourceObservability = {
  sourceId: string;
  syncSuccessRate: number | null;
  recordsFetched: number;
  recordsChanged: number;
  recordsRejected: number;
  resolutionRate: number | null;
  medianFreshnessHours: number | null;
  quarantineCount: number;
  mediaFailureRate: number | null;
  credentialExpiryRunwayDays: number | null;
  breakerState: 'closed' | 'open' | 'half_open';
  alerts: string[];
};

/**
 * §6A.9 Per-source observability snapshot.
 */
export async function getSourceObservability(
  client: DbClient,
  sourceId: string,
  opts?: { now?: Date },
): Promise<SourceObservability> {
  const now = opts?.now ?? new Date();
  const { rows: sourceRows } = await client.query<{
    credential_ref: string | null;
    sync_interval_seconds: number | null;
    last_success_at: Date | null;
  }>(
    `select credential_ref, sync_interval_seconds, last_success_at from source where id = $1`,
    [sourceId],
  );
  const source = sourceRows[0];

  const { rows: runs } = await client.query<{
    status: string;
    records_fetched: number;
    records_changed: number;
    records_rejected: number;
    started_at: Date;
    finished_at: Date | null;
  }>(
    `select status, records_fetched, records_changed, records_rejected, started_at, finished_at
     from sync_run where source_id = $1 order by started_at desc limit 50`,
    [sourceId],
  );

  const total = runs.length;
  const succeeded = runs.filter((r) => r.status === 'succeeded').length;
  const quarantined = runs.filter((r) => r.status === 'quarantined').length;
  const fetched = runs.reduce((a, r) => a + r.records_fetched, 0);
  const changed = runs.reduce((a, r) => a + r.records_changed, 0);
  const rejected = runs.reduce((a, r) => a + r.records_rejected, 0);

  const { rows: res } = await client.query<{ total: string; resolved: string }>(
    `select count(*)::text as total,
            count(*) filter (where resolution_status = 'resolved')::text as resolved
     from source_listing where source_id = $1`,
    [sourceId],
  );
  const slTotal = Number(res[0]?.total ?? 0);
  const slResolved = Number(res[0]?.resolved ?? 0);

  let medianFreshnessHours: number | null = null;
  if (source?.last_success_at) {
    medianFreshnessHours =
      (now.getTime() - new Date(source.last_success_at).getTime()) / 3600_000;
  }

  const runway = source?.credential_ref
    ? credentialExpiryRunwayDays(source.credential_ref, now)
    : null;

  const alerts: string[] = [];
  if (getBreakerState(sourceId) === 'open') alerts.push('source_failed_breaker_open');
  if (quarantined > 0) alerts.push('quarantined_run');
  if (runway != null && runway < DEFAULT_INGESTION_THRESHOLDS.credential_expiry_alert_days) {
    alerts.push('credential_expiring_within_7_days');
  }
  if (
    source?.sync_interval_seconds &&
    medianFreshnessHours != null &&
    medianFreshnessHours * 3600 > source.sync_interval_seconds * 2
  ) {
    alerts.push('freshness_exceeds_2x_sync_interval');
  }
  if (slTotal > 0 && slResolved / slTotal < 0.5) {
    alerts.push('resolution_rate_below_threshold');
  }

  return {
    sourceId,
    syncSuccessRate: total ? succeeded / total : null,
    recordsFetched: fetched,
    recordsChanged: changed,
    recordsRejected: rejected,
    resolutionRate: slTotal ? slResolved / slTotal : null,
    medianFreshnessHours,
    quarantineCount: quarantined,
    mediaFailureRate: null,
    credentialExpiryRunwayDays: runway,
    breakerState: getBreakerState(sourceId),
    alerts,
  };
}
