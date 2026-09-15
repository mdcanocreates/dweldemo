/**
 * B-9 — Notification sequences worker.
 */

import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { createNotification } from './notify.js';
import { systemClock, type Clock } from '../shared/clock.js';

export async function startSequenceForParty(
  client: DbClient,
  input: {
    sequenceKey: string;
    partyId: string;
    triggerEventId?: string | null;
    context?: Record<string, unknown>;
    clock?: Clock;
  },
): Promise<{ instanceId: string }> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const { rows: seq } = await client.query<{ id: string }>(
    `select id from notification_sequence where sequence_key = $1 and is_active`,
    [input.sequenceKey],
  );
  if (!seq[0]) throw new Error(`sequence not found: ${input.sequenceKey}`);

  const { rows: step1 } = await client.query<{ delay_hours: number }>(
    `select delay_hours from notification_sequence_step
     where sequence_id = $1 and step_number = 1`,
    [seq[0].id],
  );

  const id = randomUUID();
  const nextAt = new Date(now.getTime() + (step1[0]?.delay_hours ?? 0) * 3_600_000);
  await client.query(
    `insert into notification_sequence_instance (
       id, sequence_id, party_id, trigger_event_id, context,
       current_step, status, started_at, next_step_at
     ) values ($1,$2,$3,$4,$5::jsonb,1,'active',$6,$7)`,
    [
      id,
      seq[0].id,
      input.partyId,
      input.triggerEventId ?? null,
      JSON.stringify(input.context ?? {}),
      now,
      nextAt,
    ],
  );
  return { instanceId: id };
}

/**
 * Poll due instances (batch ≤100). Returns processed count.
 */
export async function processSequenceWorkerPoll(
  client: DbClient,
  opts?: { clock?: Clock; batchSize?: number },
): Promise<{ processed: number; cancelled: number; completed: number }> {
  const clock = opts?.clock ?? systemClock;
  const now = clock.now();
  const batch = Math.min(opts?.batchSize ?? 100, 100);

  const { rows: due } = await client.query<{
    id: string;
    sequence_id: string;
    party_id: string;
    current_step: number;
    started_at: Date;
    context: Record<string, unknown>;
  }>(
    `select id, sequence_id, party_id, current_step, started_at, context
     from notification_sequence_instance
     where status = 'active' and next_step_at <= $1
     order by next_step_at asc
     limit $2
     for update skip locked`,
    [now, batch],
  );

  let processed = 0;
  let cancelled = 0;
  let completed = 0;

  for (const inst of due) {
    const { rows: step } = await client.query<{
      step_number: number;
      template_key: string;
      channel: 'email' | 'in_platform' | 'sms';
      cancel_if: string | null;
      delay_hours: number;
    }>(
      `select step_number, template_key, channel, cancel_if, delay_hours
       from notification_sequence_step
       where sequence_id = $1 and step_number = $2`,
      [inst.sequence_id, inst.current_step],
    );
    const s = step[0];
    if (!s) {
      await client.query(
        `update notification_sequence_instance
         set status = 'failed', completed_at = $2 where id = $1`,
        [inst.id, now],
      );
      processed += 1;
      continue;
    }

    if (s.cancel_if) {
      const { rows: cancelEv } = await client.query<{ n: string }>(
        `select count(*)::text as n from domain_event de
         where de.occurred_at >= $2
           and (
             de.event_type = $1
             or (
               de.event_type = 'application.status_changed'
               and (
                 ($1 = 'screening_authorized' and de.payload->>'to' = 'screening_authorized')
                 or ($1 = 'application_closed' and de.payload->>'to' = 'closed')
               )
               and de.aggregate_id in (select id from application where party_id = $3)
             )
             or (
               de.event_type = $1
               and de.payload->>'party_id' = $3::text
             )
           )`,
        [s.cancel_if, inst.started_at, inst.party_id],
      );

      if (Number(cancelEv[0]?.n ?? 0) > 0) {
        await client.query(
          `update notification_sequence_instance
           set status = 'cancelled', cancelled_at = $2, cancel_reason = $3
           where id = $1`,
          [inst.id, now, s.cancel_if],
        );
        cancelled += 1;
        processed += 1;
        continue;
      }
    }

    await createNotification(client, {
      recipientPartyId: inst.party_id,
      channel: s.channel,
      eventType: `sequence.${s.template_key}`,
      templateKey: s.template_key,
      payload: { ...(inst.context ?? {}), step: s.step_number },
    });

    const { rows: nextStep } = await client.query<{
      step_number: number;
      delay_hours: number;
    }>(
      `select step_number, delay_hours from notification_sequence_step
       where sequence_id = $1 and step_number = $2`,
      [inst.sequence_id, inst.current_step + 1],
    );

    if (!nextStep[0]) {
      await client.query(
        `update notification_sequence_instance
         set status = 'completed', completed_at = $2, current_step = $3
         where id = $1`,
        [inst.id, now, inst.current_step],
      );
      completed += 1;
    } else {
      const nextAt = new Date(now.getTime() + nextStep[0].delay_hours * 3_600_000);
      await client.query(
        `update notification_sequence_instance
         set current_step = $2, next_step_at = $3
         where id = $1`,
        [inst.id, nextStep[0].step_number, nextAt],
      );
    }
    processed += 1;
  }

  return { processed, cancelled, completed };
}

/**
 * Hook: when application stays submitted without screening for 24h, start abandoned sequence.
 * For tests, call directly after submit with clock.
 */
export async function maybeStartAbandonedApplicationSequence(
  client: DbClient,
  input: {
    partyId: string;
    applicationId: string;
    clock?: Clock;
  },
): Promise<{ instanceId: string | null }> {
  const clock = input.clock ?? systemClock;
  const { rows } = await client.query<{ status: string; submitted_at: Date | null }>(
    `select status, submitted_at from application where id = $1`,
    [input.applicationId],
  );
  const app = rows[0];
  if (!app || !app.submitted_at) return { instanceId: null };
  if (app.status === 'screening_authorized' || app.status === 'closed') {
    return { instanceId: null };
  }

  const { instanceId } = await startSequenceForParty(client, {
    sequenceKey: 'renter_application_abandoned',
    partyId: input.partyId,
    context: { application_id: input.applicationId },
    clock,
  });
  return { instanceId };
}
