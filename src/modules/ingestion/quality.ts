import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import {
  approveDualApproval,
  requestDualApproval,
} from '../identity/index.js';
import {
  DEFAULT_INGESTION_THRESHOLDS,
  type IngestionThresholds,
  type PipelineCounts,
} from './types.js';

export type QualityDecision =
  | { quarantine: false }
  | { quarantine: true; reason: string };

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * §6A.5 Quality gates — quarantine and do not apply when thresholds breached.
 */
export function evaluateQualityGates(input: {
  counts: PipelineCounts;
  rentsCents: number[];
  priorMedianRentCents?: number | null;
  priorFetchedMedian?: number | null;
  thresholds?: Partial<IngestionThresholds>;
  /** Share of inventory that would be delisted this run. */
  wouldDelistShare?: number;
}): QualityDecision {
  const t = { ...DEFAULT_INGESTION_THRESHOLDS, ...input.thresholds };

  if (input.wouldDelistShare != null && input.wouldDelistShare > t.delist_quarantine_share) {
    return {
      quarantine: true,
      reason: `delist_share_${input.wouldDelistShare.toFixed(2)}_exceeds_${t.delist_quarantine_share}`,
    };
  }

  if (input.counts.fetched > 0) {
    const rejectionRate =
      (input.counts.rejected + input.counts.unresolvable) / input.counts.fetched;
    if (rejectionRate > t.rejection_rate_max) {
      return { quarantine: true, reason: `rejection_rate_${rejectionRate.toFixed(2)}` };
    }
    const resolutionFail =
      (input.counts.ambiguous + input.counts.unresolvable) / input.counts.fetched;
    if (resolutionFail > t.resolution_failure_rate_max && input.counts.fetched >= 5) {
      return { quarantine: true, reason: `resolution_failure_rate_${resolutionFail.toFixed(2)}` };
    }
  }

  if (input.priorFetchedMedian != null && input.priorFetchedMedian > 0 && input.counts.fetched > 0) {
    const deviation =
      Math.abs(input.counts.fetched - input.priorFetchedMedian) / input.priorFetchedMedian;
    if (deviation > t.record_count_deviation && input.counts.fetched < input.priorFetchedMedian) {
      // Large drop in volume — also covered by delist share; keep explicit gate.
      return { quarantine: true, reason: `record_count_deviation_${deviation.toFixed(2)}` };
    }
  }

  const med = median(input.rentsCents);
  if (
    med != null &&
    input.priorMedianRentCents != null &&
    input.priorMedianRentCents > 0
  ) {
    const shift = Math.abs(med - input.priorMedianRentCents) / input.priorMedianRentCents;
    if (shift > t.median_rent_shift_max) {
      return {
        quarantine: true,
        reason: `median_rent_shift_${shift.toFixed(2)}_currency_scale_suspect`,
      };
    }
  }

  return { quarantine: false };
}

export async function markSyncQuarantined(
  client: DbClient,
  input: {
    syncRunId: string;
    reason: string;
    counts: PipelineCounts;
  },
): Promise<void> {
  await client.query(
    `update sync_run set
       status = 'quarantined',
       finished_at = now(),
       quarantine_reason = $2,
       records_fetched = $3,
       records_new = $4,
       records_changed = $5,
       records_unchanged = $6,
       records_rejected = $7,
       records_absent = $8
     where id = $1`,
    [
      input.syncRunId,
      input.reason,
      input.counts.fetched,
      input.counts.new,
      input.counts.changed,
      input.counts.unchanged,
      input.counts.rejected + input.counts.unresolvable,
      input.counts.absent,
    ],
  );
  await emitDomainEvent(client, {
    aggregateType: 'sync_run',
    aggregateId: input.syncRunId,
    eventType: 'sync_run.quarantined',
    payload: { reason: input.reason, ...input.counts },
    actorKind: 'system',
  });
}

/**
 * Override quarantine requires ingestion.quarantine_override dual approval (§3.2).
 */
export async function requestQuarantineOverride(
  client: DbClient,
  input: {
    syncRunId: string;
    requestedByPartyId: string;
  },
): Promise<{ dualApprovalRequestId: string }> {
  const dual = await requestDualApproval(client, {
    permissionKey: 'ingestion.quarantine_override',
    requestedByPartyId: input.requestedByPartyId,
    payload: { sync_run_id: input.syncRunId },
    targetType: 'sync_run',
    targetId: input.syncRunId,
    expiresAt: new Date(Date.now() + 24 * 3600_000),
  });
  return { dualApprovalRequestId: dual.id };
}

export async function applyQuarantineOverride(
  client: DbClient,
  input: {
    syncRunId: string;
    dualApprovalRequestId: string;
    approverPartyId: string;
  },
): Promise<void> {
  await approveDualApproval(client, {
    requestId: input.dualApprovalRequestId,
    approverPartyId: input.approverPartyId,
  });
  await client.query(
    `update sync_run set status = 'succeeded', quarantine_reason = coalesce(quarantine_reason,'') || ';override_applied'
     where id = $1 and status = 'quarantined'`,
    [input.syncRunId],
  );
  await emitDomainEvent(client, {
    aggregateType: 'sync_run',
    aggregateId: input.syncRunId,
    eventType: 'sync_run.quarantine_overridden',
    payload: {
      dual_approval_request_id: input.dualApprovalRequestId,
      approver_party_id: input.approverPartyId,
    },
    actorPartyId: input.approverPartyId,
    actorKind: 'admin',
  });
}
