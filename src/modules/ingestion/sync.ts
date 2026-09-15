import type { DbClient } from '../../db/pool.js';
import { getAdapter } from './adapters/registry.js';
import { sanitizeErrorDetail } from './credentials.js';
import {
  acquireSyncSlot,
  recordSyncFailure,
  recordSyncSuccess,
} from './rate-limit.js';
import { runIngestionPipeline } from './pipeline.js';
import type { AdapterKind, PipelineCounts, SourceConfig } from './types.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';

/**
 * Pull adapter → shared pipeline. Never normalizes inside the adapter.
 */
export async function syncSourceFromAdapter(
  client: DbClient,
  input: {
    sourceId: string;
    mode?: 'incremental' | 'full';
    clock?: Clock;
    configOverride?: SourceConfig;
  },
): Promise<{ syncRunId: string; counts: PipelineCounts; quarantined: boolean }> {
  const clock = input.clock ?? systemClock;
  const { rows } = await client.query<{
    id: string;
    adapter_kind: string;
    config: SourceConfig;
    last_cursor: string | null;
    rate_limit_per_minute: number | null;
    credential_ref: string | null;
    status: string;
  }>(
    `select id, adapter_kind, config, last_cursor, rate_limit_per_minute, credential_ref, status
     from source where id = $1`,
    [input.sourceId],
  );
  const source = rows[0];
  if (!source) throw new Error('source not found');

  const slot = acquireSyncSlot(source.id, {
    rateLimitPerMinute: source.rate_limit_per_minute ?? 60,
    clock,
  });
  if (!slot.ok) {
    await client.query(
      `insert into sync_run (source_id, run_kind, status, error_class, error_detail, finished_at)
       values ($1,'incremental','aborted',$2,$3, now())`,
      [source.id, slot.reason, `retry_after_ms=${slot.retryAfterMs}`],
    );
    throw new Error(slot.reason);
  }

  const adapter = getAdapter(source.adapter_kind as AdapterKind);
  const cfg = { ...source.config, ...input.configOverride };
  const mode = input.mode ?? (adapter.capabilities().supportsIncremental ? 'incremental' : 'full');

  try {
    const records: Record<string, unknown>[] = [];
    let cursorTo: string | null = null;
    const iter =
      mode === 'incremental'
        ? adapter.fetchIncremental(cfg, source.last_cursor)
        : adapter.fetchFull(cfg);
    for await (const rec of iter) {
      records.push({ ...rec.payload, external_id: rec.externalId });
      if (rec.cursor) cursorTo = rec.cursor;
      else if (rec.sourceModifiedAt) cursorTo = rec.sourceModifiedAt;
    }

    const result = await runIngestionPipeline(client, {
      sourceId: source.id,
      records,
      runKind: mode === 'full' ? 'full_reconcile' : 'incremental',
      reconcile: mode === 'full',
    });

    if (cursorTo) {
      await client.query(`update source set last_cursor = $2 where id = $1`, [
        source.id,
        cursorTo,
      ]);
    }
    recordSyncSuccess(source.id);
    return result;
  } catch (err) {
    const { openedBreaker } = recordSyncFailure(source.id, { clock });
    const detail = sanitizeErrorDetail(
      err instanceof Error ? err.message : String(err),
      source.credential_ref ? [source.credential_ref] : [],
    );
    await client.query(
      `update source set
         consecutive_failures = consecutive_failures + 1,
         status = case when $2 then 'failed' else status end
       where id = $1`,
      [source.id, openedBreaker],
    );
    await client.query(
      `insert into sync_run (source_id, run_kind, status, error_class, error_detail, finished_at)
       values ($1,$2,'failed','sync_error',$3, now())`,
      [source.id, mode === 'full' ? 'full_reconcile' : 'incremental', detail],
    );
    throw err;
  }
}
