import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { recomputeListingAfterDelist } from './merge.js';
import { DEFAULT_INGESTION_THRESHOLDS } from './types.js';

/**
 * §6A.4 Delta delist signal — apply immediately when adapter supportsDelistSignal.
 */
export async function applyDeltaDelistSignal(
  client: DbClient,
  input: {
    sourceId: string;
    externalId: string;
    mappedStatus: 'delisted' | 'rented';
  },
): Promise<void> {
  const { rows } = await client.query<{ id: string; unit_id: string | null; mapped_status: string }>(
    `update source_listing
     set mapped_status = $3, last_seen_at = now(), absent_since = coalesce(absent_since, now())
     where source_id = $1 and external_id = $2
     returning id, unit_id, mapped_status`,
    [input.sourceId, input.externalId, input.mappedStatus],
  );
  if (!rows[0]) return;
  await emitDomainEvent(client, {
    aggregateType: 'source_listing',
    aggregateId: rows[0].id,
    eventType: 'source_listing.delisted',
    payload: { reason: 'delta_signal', mapped_status: input.mappedStatus },
    actorKind: 'system',
  });
  if (rows[0].unit_id) {
    await recomputeListingAfterDelist(client, rows[0].unit_id);
  }
}

/**
 * Full reconciliation: stamp absent_since on listings not seen in this run.
 * Returns candidates that would be marked absent (for quarantine gate).
 */
export async function stampAbsentFromReconcile(
  client: DbClient,
  input: {
    sourceId: string;
    syncRunId: string;
    startedAt: Date;
    seenExternalIds: Set<string>;
    apply: boolean;
  },
): Promise<{ wouldAbsent: number; activeBefore: number }> {
  const { rows: active } = await client.query<{ id: string; external_id: string }>(
    `select id, external_id from source_listing
     where source_id = $1 and mapped_status = 'active'`,
    [input.sourceId],
  );
  const missing = active.filter((r) => !input.seenExternalIds.has(r.external_id));
  if (input.apply) {
    for (const row of missing) {
      await client.query(
        `update source_listing
         set absent_since = coalesce(absent_since, $2)
         where id = $1 and absent_since is null`,
        [row.id, input.startedAt],
      );
    }
    await client.query(
      `update sync_run set records_absent = $2 where id = $1`,
      [input.syncRunId, missing.length],
    );
  }
  return { wouldAbsent: missing.length, activeBefore: active.length };
}

/**
 * After grace window, absent → delisted; recompute canonical listing.
 */
export async function applyDelistGrace(
  client: DbClient,
  opts?: { clock?: Clock; graceHours?: number },
): Promise<{ delisted: number }> {
  const clock = opts?.clock ?? systemClock;
  const graceHours = opts?.graceHours ?? DEFAULT_INGESTION_THRESHOLDS.delist_grace_hours;
  const cutoff = new Date(clock.now().getTime() - graceHours * 3600_000);

  const { rows } = await client.query<{ id: string; unit_id: string | null }>(
    `update source_listing
     set mapped_status = 'delisted'
     where mapped_status = 'active'
       and absent_since is not null
       and absent_since <= $1
     returning id, unit_id`,
    [cutoff],
  );

  for (const row of rows) {
    await emitDomainEvent(client, {
      aggregateType: 'source_listing',
      aggregateId: row.id,
      eventType: 'source_listing.delisted',
      payload: { reason: 'grace_elapsed' },
      actorKind: 'system',
    });
    if (row.unit_id) {
      await recomputeListingAfterDelist(client, row.unit_id);
    }
  }
  return { delisted: rows.length };
}
