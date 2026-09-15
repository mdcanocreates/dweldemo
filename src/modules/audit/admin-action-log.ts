import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import {
  computeRowHash,
  type AdminActionRowForHash,
  verifyHashChain,
} from './hash-chain.js';

export type AdminActionInput = {
  actorPartyId: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  reasonCode?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  impersonationSessionId?: string | null;
  dualApprovalRequestId?: string | null;
};

function asBuffer(value: Buffer | Uint8Array | null): Buffer | null {
  if (value == null) return null;
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

export async function appendAdminAction(
  client: DbClient,
  input: AdminActionInput,
): Promise<{ id: string; seq: string; rowHash: Buffer }> {
  const id = randomUUID();
  const occurredAtIso = new Date().toISOString();

  // Serialize chain tip under a transaction-level advisory lock.
  await client.query('select pg_advisory_xact_lock(872364001)');

  const { rows: tip } = await client.query<{ row_hash: Buffer | Uint8Array | null }>(
    `select row_hash from admin_action_log order by admin_action_log.seq desc limit 1`,
  );
  const prevHash = asBuffer(tip[0]?.row_hash ?? null);

  const { rows: seqRows } = await client.query<{ seq: string }>(
    `select nextval(pg_get_serial_sequence('admin_action_log','seq'))::text as seq`,
  );
  const seq = seqRows[0]?.seq;
  if (!seq) throw new Error('failed to allocate admin_action_log seq');

  const forHash: AdminActionRowForHash = {
    id,
    seq,
    actor_party_id: input.actorPartyId,
    impersonation_session_id: input.impersonationSessionId ?? null,
    dual_approval_request_id: input.dualApprovalRequestId ?? null,
    action: input.action,
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    before_state: input.beforeState ?? null,
    after_state: input.afterState ?? null,
    reason_code: input.reasonCode ?? null,
    request_id: input.requestId ?? null,
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
    occurred_at: occurredAtIso,
  };

  const rowHash = computeRowHash(prevHash, forHash);

  await client.query(
    `insert into admin_action_log (
       id, seq, actor_party_id, impersonation_session_id, dual_approval_request_id,
       action, target_type, target_id, before_state, after_state, reason_code,
       request_id, ip, user_agent, occurred_at, prev_hash, row_hash
     ) values (
       $1, $2::bigint, $3, $4, $5,
       $6, $7, $8, $9::jsonb, $10::jsonb, $11,
       $12::uuid, $13::inet, $14, $15::timestamptz, $16, $17
     )`,
    [
      id,
      seq,
      input.actorPartyId,
      input.impersonationSessionId ?? null,
      input.dualApprovalRequestId ?? null,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      JSON.stringify(input.beforeState ?? null),
      JSON.stringify(input.afterState ?? null),
      input.reasonCode ?? null,
      input.requestId ?? null,
      input.ip ?? null,
      input.userAgent ?? null,
      occurredAtIso,
      prevHash,
      rowHash,
    ],
  );

  return { id, seq, rowHash };
}

export async function verifyAdminActionChain(
  client: DbClient,
): Promise<ReturnType<typeof verifyHashChain>> {
  const { rows } = await client.query<{
    id: string;
    seq: string;
    actor_party_id: string;
    impersonation_session_id: string | null;
    dual_approval_request_id: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    before_state: unknown;
    after_state: unknown;
    reason_code: string | null;
    request_id: string | null;
    ip: string | null;
    user_agent: string | null;
    occurred_at: string;
    prev_hash: Buffer | Uint8Array | null;
    row_hash: Buffer | Uint8Array;
  }>(
    `select id, admin_action_log.seq::text as seq,
            actor_party_id, impersonation_session_id, dual_approval_request_id,
            action, target_type, target_id, before_state, after_state, reason_code,
            request_id::text, host(ip)::text as ip, user_agent,
            to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as occurred_at,
            prev_hash, row_hash
     from admin_action_log
     order by admin_action_log.seq asc`,
  );

  const normalized = rows.map((r) => ({
    ...r,
    prev_hash: asBuffer(r.prev_hash),
    row_hash: asBuffer(r.row_hash)!,
    // Normalize JS numbers that jsonb may have altered; keep structural equality via JSON roundtrip.
    before_state: r.before_state === null ? null : JSON.parse(JSON.stringify(r.before_state)),
    after_state: r.after_state === null ? null : JSON.parse(JSON.stringify(r.after_state)),
  }));

  return verifyHashChain(normalized);
}
