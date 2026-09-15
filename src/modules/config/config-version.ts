import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { appendAdminAction, emitDomainEvent } from '../audit/index.js';
import {
  approveDualApproval,
  requestDualApproval,
  isSuperAdmin,
} from '../identity/index.js';

export async function proposeConfigVersion(
  client: DbClient,
  input: {
    namespace: string;
    version: string;
    payload: Record<string, unknown>;
    effectiveFrom: Date;
    proposedByPartyId: string;
    requestId?: string;
  },
): Promise<{ id: string; dualApprovalRequestId: string }> {
  const id = randomUUID();
  const dual = await requestDualApproval(client, {
    permissionKey: 'config.approve',
    requestedByPartyId: input.proposedByPartyId,
    payload: {
      config_version_id: id,
      namespace: input.namespace,
      version: input.version,
    },
    targetType: 'config_version',
    targetId: id,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    requestId: input.requestId,
  });

  await client.query(
    `insert into config_version (
       id, namespace, version, payload, effective_from,
       proposed_by_party_id, dual_approval_request_id
     ) values ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
    [
      id,
      input.namespace,
      input.version,
      JSON.stringify(input.payload),
      input.effectiveFrom,
      input.proposedByPartyId,
      dual.id,
    ],
  );

  await emitDomainEvent(client, {
    aggregateType: 'config_version',
    aggregateId: id,
    eventType: 'config.proposed',
    payload: {
      namespace: input.namespace,
      version: input.version,
      dual_approval_request_id: dual.id,
    },
    actorPartyId: input.proposedByPartyId,
    actorKind: 'admin',
    requestId: input.requestId ?? null,
  });

  return { id, dualApprovalRequestId: dual.id };
}

export async function approveConfigVersion(
  client: DbClient,
  input: {
    configVersionId: string;
    approverPartyId: string;
    requestId?: string;
  },
): Promise<void> {
  const { rows } = await client.query<{
    id: string;
    dual_approval_request_id: string | null;
    approved_by_party_id: string | null;
    namespace: string;
    version: string;
  }>(
    `select id, dual_approval_request_id, approved_by_party_id, namespace, version
     from config_version where id = $1 for update`,
    [input.configVersionId],
  );
  const cfg = rows[0];
  if (!cfg) throw new Error('config_version not found');
  if (cfg.approved_by_party_id) throw new Error('config_version already approved');
  if (!cfg.dual_approval_request_id) throw new Error('missing dual_approval_request_id');

  await approveDualApproval(client, {
    requestId: cfg.dual_approval_request_id,
    approverPartyId: input.approverPartyId,
    httpRequestId: input.requestId,
  });

  await client.query(
    `update config_version
     set approved_by_party_id = $2, approved_at = now()
     where id = $1`,
    [cfg.id, input.approverPartyId],
  );

  await emitDomainEvent(client, {
    aggregateType: 'config_version',
    aggregateId: cfg.id,
    eventType: 'config.approved',
    payload: { namespace: cfg.namespace, version: cfg.version },
    actorPartyId: input.approverPartyId,
    actorKind: 'admin',
    requestId: input.requestId ?? null,
  });

  await appendAdminAction(client, {
    actorPartyId: input.approverPartyId,
    action: 'config.approve',
    targetType: 'config_version',
    targetId: cfg.id,
    afterState: { namespace: cfg.namespace, version: cfg.version },
    dualApprovalRequestId: cfg.dual_approval_request_id,
    requestId: input.requestId ?? null,
  });
}

/** Resolve config as of timestamp — only approved versions are visible. */
export async function resolveConfig(
  client: DbClient,
  namespace: string,
  asOf: Date,
): Promise<Record<string, unknown> | null> {
  const { rows } = await client.query<{ payload: Record<string, unknown> }>(
    `select payload from config_version
     where namespace = $1
       and approved_by_party_id is not null
       and effective_from <= $2
       and (effective_to is null or effective_to > $2)
     order by effective_from desc
     limit 1`,
    [namespace, asOf],
  );
  return rows[0]?.payload ?? null;
}

export async function assertCanApproveConfig(
  client: DbClient,
  partyId: string,
): Promise<boolean> {
  return isSuperAdmin(client, partyId);
}
