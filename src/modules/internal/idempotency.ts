/**
 * Idempotency-Key persistence for Control Center mutating internal actions.
 */

import type { DbClient } from '../../db/pool.js';

export type StoredIdempotentResponse = {
  status: number;
  body: unknown;
};

export async function findIdempotentResponse(
  client: DbClient,
  input: { idempotencyKey: string; routeKey: string },
): Promise<StoredIdempotentResponse | null> {
  const { rows } = await client.query<{
    response_status: number;
    response_body: unknown;
  }>(
    `select response_status, response_body
     from internal_action_idempotency
     where idempotency_key = $1
       and route_key = $2
       and expires_at > now()`,
    [input.idempotencyKey, input.routeKey],
  );
  const row = rows[0];
  if (!row) return null;
  return { status: row.response_status, body: row.response_body };
}

export async function storeIdempotentResponse(
  client: DbClient,
  input: {
    idempotencyKey: string;
    routeKey: string;
    requestHash?: string | null;
    status: number;
    body: unknown;
  },
): Promise<void> {
  await client.query(
    `insert into internal_action_idempotency (
       idempotency_key, route_key, request_hash, response_status, response_body
     ) values ($1, $2, $3, $4, $5::jsonb)
     on conflict (idempotency_key, route_key) do nothing`,
    [
      input.idempotencyKey,
      input.routeKey,
      input.requestHash ?? null,
      input.status,
      JSON.stringify(input.body ?? {}),
    ],
  );
}
