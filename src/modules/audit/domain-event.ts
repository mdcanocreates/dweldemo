import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';

export type DomainEventInput = {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion?: number;
  payload: Record<string, unknown>;
  actorPartyId?: string | null;
  actorKind?: 'user' | 'system' | 'vendor' | 'admin';
  requestId?: string | null;
  occurredAt?: Date;
};

export async function emitDomainEvent(
  client: DbClient,
  input: DomainEventInput,
): Promise<{ id: string; seq: string }> {
  const id = randomUUID();
  const { rows } = await client.query<{ id: string; seq: string }>(
    `insert into domain_event (
       id, aggregate_type, aggregate_id, event_type, event_version,
       payload, actor_party_id, actor_kind, request_id, occurred_at
     ) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
     returning id, seq::text`,
    [
      id,
      input.aggregateType,
      input.aggregateId,
      input.eventType,
      input.eventVersion ?? 1,
      JSON.stringify(input.payload),
      input.actorPartyId ?? null,
      input.actorKind ?? 'system',
      input.requestId ?? null,
      input.occurredAt ?? new Date(),
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('failed to emit domain_event');
  return row;
}
