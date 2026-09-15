import { createHmac, randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { systemClock, type Clock } from '../shared/clock.js';

const SUPPRESSION_HMAC_SECRET =
  process.env.RBIT_NOTIFY_HMAC_SECRET ?? 'rbit-dev-notify-hmac-not-for-prod';

export function addressHmac(address: string): Buffer {
  return createHmac('sha256', SUPPRESSION_HMAC_SECRET)
    .update(address.normalize('NFKC').toLowerCase())
    .digest();
}

export async function createNotification(
  client: DbClient,
  input: {
    recipientPartyId: string;
    channel: 'in_platform' | 'email' | 'sms';
    eventType: string;
    templateKey: string;
    templateVersion?: string;
    payload: Record<string, unknown>;
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  // Notification is PARTY-RLS; bind recipient for WITH CHECK without leaving context sticky.
  const { rows: prev } = await client.query<{ v: string }>(
    `select current_setting('rbit.current_party_id', true) as v`,
  );
  await client.query(`select set_config('rbit.current_party_id', $1, true)`, [
    input.recipientPartyId,
  ]);
  try {
    await client.query(
      `insert into notification (
         id, recipient_party_id, channel, event_type, template_key,
         template_version, payload, status
       ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,'queued')`,
      [
        id,
        input.recipientPartyId,
        input.channel,
        input.eventType,
        input.templateKey,
        input.templateVersion ?? '1',
        JSON.stringify(input.payload),
      ],
    );
  } finally {
    await client.query(`select set_config('rbit.current_party_id', $1, true)`, [
      prev[0]?.v ?? '',
    ]);
  }
  await emitDomainEvent(client, {
    aggregateType: 'notification',
    aggregateId: id,
    eventType: 'notification.queued',
    payload: {
      channel: input.channel,
      event_type: input.eventType,
      recipient_party_id: input.recipientPartyId,
    },
    actorKind: 'system',
  });
  return { id };
}

/** Stub send: marks queued → sent. Checks suppression for email/sms. */
export async function sendNotificationStub(
  client: DbClient,
  notificationId: string,
  opts?: { addressForSuppressionCheck?: string; clock?: Clock },
): Promise<{ status: string }> {
  const clock = opts?.clock ?? systemClock;
  const now = clock.now();

  const { rows } = await client.query<{
    id: string;
    channel: string;
    status: string;
  }>(`select id, channel, status from notification where id = $1 for update`, [
    notificationId,
  ]);
  const row = rows[0];
  if (!row) throw new Error('notification not found');
  if (row.status !== 'queued') return { status: row.status };

  if (
    (row.channel === 'email' || row.channel === 'sms') &&
    opts?.addressForSuppressionCheck
  ) {
    const hmac = addressHmac(opts.addressForSuppressionCheck);
    const { rows: suppressed } = await client.query(
      `select 1 from notification_suppression where channel = $1 and address_hmac = $2 limit 1`,
      [row.channel, hmac],
    );
    if (suppressed.length) {
      await client.query(
        `update notification set status = 'failed' where id = $1`,
        [notificationId],
      );
      await emitDomainEvent(client, {
        aggregateType: 'notification',
        aggregateId: notificationId,
        eventType: 'notification.suppressed',
        payload: { channel: row.channel },
        actorKind: 'system',
        occurredAt: now,
      });
      return { status: 'failed' };
    }
  }

  await client.query(
    `update notification set status = 'sent', sent_at = $2, provider_message_id = $3
     where id = $1`,
    [notificationId, now, `stub-${notificationId}`],
  );
  await emitDomainEvent(client, {
    aggregateType: 'notification',
    aggregateId: notificationId,
    eventType: 'notification.sent',
    payload: { channel: row.channel },
    actorKind: 'system',
    occurredAt: now,
  });
  return { status: 'sent' };
}
