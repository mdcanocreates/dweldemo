import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { appendAdminAction, emitDomainEvent } from '../audit/index.js';

export class DualApprovalError extends Error {
  constructor(
    message: string,
    readonly code: 'SELF_APPROVAL' | 'NOT_PENDING' | 'EXPIRED' | 'NOT_FOUND' | 'FORBIDDEN',
  ) {
    super(message);
    this.name = 'DualApprovalError';
  }
}

export async function partyHasRole(
  client: DbClient,
  partyId: string,
  role: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `select 1 from party_role
     where party_id = $1 and role = $2 and revoked_at is null
     limit 1`,
    [partyId, role],
  );
  return rows.length > 0;
}

export async function isSuperAdmin(client: DbClient, partyId: string): Promise<boolean> {
  return partyHasRole(client, partyId, 'rbit_super_admin');
}

export async function requestDualApproval(
  client: DbClient,
  input: {
    permissionKey: string;
    requestedByPartyId: string;
    payload: Record<string, unknown>;
    targetType?: string;
    targetId?: string;
    expiresAt: Date;
    requestId?: string;
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  await client.query(
    `insert into dual_approval_request (
       id, permission_key, requested_by_party_id, payload, target_type, target_id,
       status, expires_at
     ) values ($1,$2,$3,$4::jsonb,$5,$6,'pending',$7)`,
    [
      id,
      input.permissionKey,
      input.requestedByPartyId,
      JSON.stringify(input.payload),
      input.targetType ?? null,
      input.targetId ?? null,
      input.expiresAt,
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'dual_approval_request',
    aggregateId: id,
    eventType: 'dual_approval.requested',
    payload: {
      permission_key: input.permissionKey,
      requested_by_party_id: input.requestedByPartyId,
    },
    actorPartyId: input.requestedByPartyId,
    actorKind: 'admin',
    requestId: input.requestId ?? null,
  });

  return { id };
}

/**
 * Approve a dual-approval request.
 * - Requester cannot approve their own request.
 * - rbit_super_admin bypasses the dual-approval requirement entirely (may approve any, including own).
 */
export async function approveDualApproval(
  client: DbClient,
  input: {
    requestId: string;
    approverPartyId: string;
    httpRequestId?: string;
  },
): Promise<{ status: 'approved'; bypassed: boolean }> {
  const { rows } = await client.query<{
    id: string;
    permission_key: string;
    requested_by_party_id: string;
    status: string;
    expires_at: Date;
  }>(
    `select id, permission_key, requested_by_party_id, status, expires_at
     from dual_approval_request where id = $1 for update`,
    [input.requestId],
  );
  const req = rows[0];
  if (!req) throw new DualApprovalError('request not found', 'NOT_FOUND');
  if (req.status !== 'pending') {
    throw new DualApprovalError(`request is ${req.status}`, 'NOT_PENDING');
  }
  if (new Date(req.expires_at) < new Date()) {
    await client.query(
      `update dual_approval_request set status = 'expired', resolved_at = now() where id = $1`,
      [req.id],
    );
    throw new DualApprovalError('request expired', 'EXPIRED');
  }

  const bypass = await isSuperAdmin(client, input.approverPartyId);

  if (!bypass && req.requested_by_party_id === input.approverPartyId) {
    throw new DualApprovalError('requester cannot approve own request', 'SELF_APPROVAL');
  }

  await client.query(
    `update dual_approval_request
     set status = 'approved', approved_by_party_id = $2, resolved_at = now()
     where id = $1`,
    [req.id, input.approverPartyId],
  );

  await emitDomainEvent(client, {
    aggregateType: 'dual_approval_request',
    aggregateId: req.id,
    eventType: 'dual_approval.approved',
    payload: {
      permission_key: req.permission_key,
      approved_by_party_id: input.approverPartyId,
      bypassed: bypass,
    },
    actorPartyId: input.approverPartyId,
    actorKind: 'admin',
    requestId: input.httpRequestId ?? null,
  });

  await appendAdminAction(client, {
    actorPartyId: input.approverPartyId,
    action: 'dual_approval.approve',
    targetType: 'dual_approval_request',
    targetId: req.id,
    afterState: { status: 'approved', bypassed: bypass },
    dualApprovalRequestId: req.id,
    requestId: input.httpRequestId ?? null,
  });

  return { status: 'approved', bypassed: bypass };
}

/** Super-admin path: execute a dual-approval-gated action without a second approver. */
export async function bypassDualApprovalAsSuperAdmin(
  client: DbClient,
  input: {
    permissionKey: string;
    superAdminPartyId: string;
    payload: Record<string, unknown>;
    httpRequestId?: string;
  },
): Promise<{ id: string }> {
  if (!(await isSuperAdmin(client, input.superAdminPartyId))) {
    throw new DualApprovalError('super admin role required', 'FORBIDDEN');
  }
  const created = await requestDualApproval(client, {
    permissionKey: input.permissionKey,
    requestedByPartyId: input.superAdminPartyId,
    payload: input.payload,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    requestId: input.httpRequestId,
  });
  await approveDualApproval(client, {
    requestId: created.id,
    approverPartyId: input.superAdminPartyId,
    httpRequestId: input.httpRequestId,
  });
  return created;
}
