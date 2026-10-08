/**
 * Control Center transactional outbox writer.
 * Never include FCRA screening report bodies in payloads.
 */

import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  'derived_summary',
  'report_body',
  'screening_report',
  'screening_score',
  'credit_report',
  'criminal_report',
  'payload_ref',
  'fcra',
]);

export function sanitizeOutboxPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(k)) continue;
    if (k.toLowerCase().includes('screening') && typeof v === 'object' && v != null) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

export type CcOutboxInput = {
  eventType: string;
  sourceCaseId?: string | null;
  sourcePartyId?: string | null;
  sourceVersion?: string | null;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
};

export async function writeCcOutboxEvent(
  client: DbClient,
  input: CcOutboxInput,
): Promise<{ eventId: string }> {
  const eventId = randomUUID();
  await client.query(
    `insert into cc_outbox (
       event_id, schema_version, event_type, product,
       source_case_id, source_party_id, occurred_at, source_version, payload
     ) values ($1, 1, $2, 'dwel', $3, $4, $5, $6, $7::jsonb)`,
    [
      eventId,
      input.eventType,
      input.sourceCaseId ?? null,
      input.sourcePartyId ?? null,
      input.occurredAt ?? new Date(),
      input.sourceVersion ?? null,
      JSON.stringify(sanitizeOutboxPayload(input.payload ?? {})),
    ],
  );
  return { eventId };
}
