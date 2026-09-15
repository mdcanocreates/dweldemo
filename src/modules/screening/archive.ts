import { createHash, randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';

/**
 * Vendor request/response archival + cost attribution.
 * Payloads must never contain SSN / government-ID values (asserted in tests).
 */

const FORBIDDEN_KEYS = new Set([
  'ssn',
  'social_security_number',
  'socialSecurityNumber',
  'government_id',
  'governmentId',
  'gov_id',
  'passport_number',
  'drivers_license',
  'driversLicense',
]);

export function assertNoForbiddenPii(payload: unknown, path = ''): void {
  if (payload == null) return;
  if (Array.isArray(payload)) {
    payload.forEach((v, i) => assertNoForbiddenPii(v, `${path}[${i}]`));
    return;
  }
  if (typeof payload === 'object') {
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k)) {
        throw new Error(`forbidden PII key in archived payload: ${path}.${k}`);
      }
      assertNoForbiddenPii(v, path ? `${path}.${k}` : k);
    }
  }
}

export async function archiveVendorRequest(
  client: DbClient,
  input: {
    vendor: string;
    capability: string;
    correlationId: string;
    requestPayload: Record<string, unknown>;
    screeningOrderId?: string | null;
    applicationId?: string | null;
  },
): Promise<string> {
  assertNoForbiddenPii(input.requestPayload);
  const id = randomUUID();
  await client.query(
    `insert into vendor_request_archive (
       id, vendor, capability, correlation_id, screening_order_id,
       application_id, request_payload
     ) values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      id,
      input.vendor,
      input.capability,
      input.correlationId,
      input.screeningOrderId ?? null,
      input.applicationId ?? null,
      JSON.stringify(input.requestPayload),
    ],
  );
  return id;
}

export async function archiveVendorResponse(
  client: DbClient,
  input: {
    vendor: string;
    capability: string;
    correlationId: string;
    responsePayload: Record<string, unknown>;
    screeningOrderId?: string | null;
    applicationId?: string | null;
    httpStatus?: number | null;
  },
): Promise<string> {
  assertNoForbiddenPii(input.responsePayload);
  const id = randomUUID();
  await client.query(
    `insert into vendor_response_archive (
       id, vendor, capability, correlation_id, screening_order_id,
       application_id, response_payload, http_status
     ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      id,
      input.vendor,
      input.capability,
      input.correlationId,
      input.screeningOrderId ?? null,
      input.applicationId ?? null,
      JSON.stringify(input.responsePayload),
      input.httpStatus ?? null,
    ],
  );
  return id;
}

/**
 * TEMPORARY cost attribution store — Phase 3 journals into the real ledger.
 */
export async function recordVendorCost(
  client: DbClient,
  input: {
    vendor: string;
    capability: string;
    amountCents: number;
    screeningOrderId?: string | null;
    applicationId?: string | null;
    correlationId?: string | null;
    webhookEventId?: string | null;
    occurredAt?: Date;
    note?: string | null;
  },
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `insert into vendor_cost_entry (
       id, vendor, capability, screening_order_id, application_id,
       amount_cents, occurred_at, correlation_id, webhook_event_id, note
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      input.vendor,
      input.capability,
      input.screeningOrderId ?? null,
      input.applicationId ?? null,
      input.amountCents,
      input.occurredAt ?? new Date(),
      input.correlationId ?? null,
      input.webhookEventId ?? null,
      input.note ?? null,
    ],
  );
  return id;
}

export async function queryCostByVendorAndDate(
  client: DbClient,
  input: { vendor?: string; from: Date; to: Date; applicationId?: string },
): Promise<
  Array<{
    vendor: string;
    day: string;
    total_cents: number;
    entry_count: number;
  }>
> {
  const params: unknown[] = [input.from, input.to];
  const where = [`occurred_at >= $1`, `occurred_at < $2`];
  if (input.vendor) {
    params.push(input.vendor);
    where.push(`vendor = $${params.length}`);
  }
  if (input.applicationId) {
    params.push(input.applicationId);
    where.push(`application_id = $${params.length}`);
  }
  const { rows } = await client.query<{
    vendor: string;
    day: string;
    total_cents: string;
    entry_count: string;
  }>(
    `select vendor,
            to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD') as day,
            sum(amount_cents)::text as total_cents,
            count(*)::text as entry_count
     from vendor_cost_entry
     where ${where.join(' and ')}
     group by vendor, day
     order by day, vendor`,
    params,
  );
  return rows.map((r) => ({
    vendor: r.vendor,
    day: r.day,
    total_cents: Number(r.total_cents),
    entry_count: Number(r.entry_count),
  }));
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
