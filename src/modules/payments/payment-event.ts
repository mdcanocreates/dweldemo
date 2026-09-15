import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { getVendorRegistry } from '../vendors/index.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';

export async function ingestPaymentEvent(
  client: DbClient,
  input: {
    provider: string;
    providerEventId: string;
    eventType: string;
    rawPayload: Record<string, unknown>;
    signature: string;
    webhookSecret?: string;
    clock?: Clock;
  },
): Promise<{ id: string; isSignatureValid: boolean; duplicate: boolean }> {
  const clock = input.clock ?? systemClock;
  const rail = getVendorRegistry().paymentRail();
  const isSignatureValid = rail.verifyWebhookSignature(
    {
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      payload: input.rawPayload,
      signature: input.signature,
    },
    input.webhookSecret ?? 'stub-secret',
  );

  const existing = await client.query<{ id: string }>(
    `select id from payment_event
     where provider = $1 and provider_event_id = $2`,
    [input.provider, input.providerEventId],
  );
  if (existing.rows[0]) {
    return {
      id: existing.rows[0].id,
      isSignatureValid,
      duplicate: true,
    };
  }

  const id = randomUUID();
  await client.query(
    `insert into payment_event (
       id, provider, provider_event_id, event_type, raw_payload,
       is_signature_valid, received_at
     ) values ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
    [
      id,
      input.provider,
      input.providerEventId,
      input.eventType,
      JSON.stringify(input.rawPayload),
      isSignatureValid,
      clock.now(),
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'payment_event',
    aggregateId: id,
    eventType: 'payment_event.ingested',
    payload: {
      provider: input.provider,
      provider_event_id: input.providerEventId,
      event_type: input.eventType,
      is_signature_valid: isSignatureValid,
    },
    actorKind: 'vendor',
    occurredAt: clock.now(),
  });

  return { id, isSignatureValid, duplicate: false };
}

export async function markPaymentEventProcessed(
  client: DbClient,
  paymentEventId: string,
  error?: string | null,
): Promise<void> {
  await client.query(
    `update payment_event
     set processed_at = case when $2::text is null then now() else processed_at end,
         process_attempts = process_attempts + 1,
         process_error = $2
     where id = $1`,
    [paymentEventId, error ?? null],
  );
}
