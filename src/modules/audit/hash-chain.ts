import { createHash } from 'node:crypto';

export type AdminActionRowForHash = {
  id: string;
  seq: string | number;
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
  occurred_at: string | Date;
};

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function computeRowHash(
  prevHash: Buffer | null,
  row: AdminActionRowForHash,
): Buffer {
  const occurredAt =
    typeof row.occurred_at === 'string'
      ? row.occurred_at
      : row.occurred_at.toISOString();

  const body = {
    id: row.id,
    seq: String(row.seq),
    actor_party_id: row.actor_party_id,
    impersonation_session_id: row.impersonation_session_id,
    dual_approval_request_id: row.dual_approval_request_id,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    before_state: row.before_state,
    after_state: row.after_state,
    reason_code: row.reason_code,
    request_id: row.request_id,
    ip: row.ip,
    user_agent: row.user_agent,
    occurred_at: occurredAt,
  };
  const prev = prevHash ?? Buffer.alloc(32, 0);
  return createHash('sha256')
    .update(Buffer.from(prev))
    .update(canonicalJson(body))
    .digest();
}

export function verifyHashChain(
  rows: Array<AdminActionRowForHash & { prev_hash: Buffer | null; row_hash: Buffer }>,
): { ok: true } | { ok: false; brokenAtSeq: string; reason: string } {
  let expectedPrev: Buffer | null = null;
  for (const row of rows) {
    if (expectedPrev === null) {
      if (row.prev_hash !== null) {
        return { ok: false, brokenAtSeq: String(row.seq), reason: 'first row prev_hash must be null' };
      }
    } else if (!row.prev_hash || !expectedPrev.equals(row.prev_hash)) {
      return { ok: false, brokenAtSeq: String(row.seq), reason: 'prev_hash mismatch' };
    }
    const computed = computeRowHash(row.prev_hash, row);
    if (!computed.equals(row.row_hash)) {
      return { ok: false, brokenAtSeq: String(row.seq), reason: 'row_hash mismatch' };
    }
    expectedPrev = row.row_hash;
  }
  return { ok: true };
}
