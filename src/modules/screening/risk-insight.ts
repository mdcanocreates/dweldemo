import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { isRiskInsightAutoAdverseEnabled } from './config.js';

export type AdverseActionInput = {
  applicationId: string;
  partyId: string;
  primaryDriver: 'risk_insight' | 'credit' | 'criminal' | 'other';
  reasonCodes: string[];
  detail?: Record<string, unknown>;
};

export type AdverseActionResult =
  | { action: 'auto_reject'; status: 'closed' }
  | { action: 'review_queue'; reviewId: string; status: 'screening_running' | string };

/**
 * D-15 — while risk_insight_auto_adverse_action_enabled = false,
 * RI-driven declines route to human review (fraud_signal review queue), not auto-reject.
 */
export async function evaluateAdverseAction(
  client: DbClient,
  input: AdverseActionInput,
  clock: Clock = systemClock,
): Promise<AdverseActionResult> {
  const now = clock.now();
  const autoEnabled = await isRiskInsightAutoAdverseEnabled(client, clock);

  if (input.primaryDriver === 'risk_insight' && !autoEnabled) {
    const reviewId = randomUUID();
    await client.query(
      `insert into fraud_signal (
         id, party_id, application_id, signal_kind, severity, detail, detected_at, review_status
       ) values ($1,$2,$3,'risk_insight_adverse','high',$4::jsonb,$5,'pending')`,
      [
        reviewId,
        input.partyId,
        input.applicationId,
        JSON.stringify({
          reason_codes: input.reasonCodes,
          primary_driver: input.primaryDriver,
          ...(input.detail ?? {}),
        }),
        now,
      ],
    );
    await emitDomainEvent(client, {
      aggregateType: 'application',
      aggregateId: input.applicationId,
      eventType: 'application.adverse_action_review_queued',
      payload: {
        review_id: reviewId,
        primary_driver: input.primaryDriver,
        auto_adverse_enabled: false,
      },
      actorKind: 'system',
      occurredAt: now,
    });
    return { action: 'review_queue', reviewId, status: 'screening_running' };
  }

  // Non-RI or auto-enabled path
  await client.query(
    `update application set status = 'closed', closed_at = $2 where id = $1`,
    [input.applicationId, now],
  );
  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: input.applicationId,
    eventType: 'application.adverse_action_rejected',
    payload: {
      primary_driver: input.primaryDriver,
      reason_codes: input.reasonCodes,
      auto_adverse_enabled: autoEnabled,
    },
    actorKind: 'system',
    occurredAt: now,
  });
  return { action: 'auto_reject', status: 'closed' };
}
