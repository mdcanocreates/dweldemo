import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';
import type { BrokerInvitationRow } from './invitations.js';

const DEFAULT_PERMISSIONS = [
  'view_listings',
  'view_applicants',
  'request_screening',
  'recommend',
] as const;

export type DelegationRow = {
  id: string;
  broker_org_id: string;
  provider_org_id: string;
  invitation_id: string | null;
  status: string;
  permissions: string[];
  accepted_at: string;
  revoked_at: string | null;
};

/**
 * Home Provider accepts a broker invitation.
 * Creates broker_provider_delegation AND syncs org.managed_by_broker_org_id
 * (legacy portfolio queries still use managed_by — documented limitation).
 */
export async function acceptBrokerInvitation(
  client: DbClient,
  input: {
    invitationId: string;
    providerOrgId: string;
    actorPartyId: string;
  },
): Promise<{ invitation: BrokerInvitationRow; delegation: DelegationRow }> {
  const { rows: inv } = await client.query<{
    id: string;
    broker_org_id: string;
    provider_org_id: string | null;
    contact_email: string;
    business_name: string | null;
    note: string | null;
    status: string;
    invited_by_party_id: string;
    created_at: Date;
    accepted_at: Date | null;
    expires_at: Date | null;
  }>(
    `select * from broker_provider_invitation where id = $1 for update`,
    [input.invitationId],
  );
  const invitation = inv[0];
  if (!invitation) throw new AppError('invitation not found', 'invitation_not_found', 404);
  if (!['pending', 'delivered'].includes(invitation.status)) {
    throw new AppError(
      `cannot accept invitation in status ${invitation.status}`,
      'invitation_not_acceptable',
      409,
    );
  }
  if (invitation.expires_at && invitation.expires_at.getTime() < Date.now()) {
    await client.query(
      `update broker_provider_invitation set status = 'expired' where id = $1`,
      [invitation.id],
    );
    throw new AppError('invitation expired', 'invitation_expired', 409);
  }

  const { rows: updatedInv } = await client.query<{
    id: string;
    broker_org_id: string;
    provider_org_id: string | null;
    contact_email: string;
    business_name: string | null;
    note: string | null;
    status: string;
    invited_by_party_id: string;
    created_at: Date;
    accepted_at: Date | null;
    expires_at: Date | null;
  }>(
    `update broker_provider_invitation
     set status = 'accepted',
         provider_org_id = $2,
         accepted_at = now()
     where id = $1
     returning *`,
    [invitation.id, input.providerOrgId],
  );

  const { rows: del } = await client.query<{
    id: string;
    broker_org_id: string;
    provider_org_id: string;
    invitation_id: string | null;
    status: string;
    permissions: string[];
    accepted_at: Date;
    revoked_at: Date | null;
  }>(
    `insert into broker_provider_delegation (
       broker_org_id, provider_org_id, invitation_id, status, permissions,
       accepted_at, accepted_by_party_id
     ) values ($1,$2,$3,'accepted',$4::text[], now(), $5)
     on conflict (broker_org_id, provider_org_id) do update set
       status = 'accepted',
       invitation_id = excluded.invitation_id,
       permissions = excluded.permissions,
       accepted_at = now(),
       revoked_at = null,
       accepted_by_party_id = excluded.accepted_by_party_id,
       revoked_by_party_id = null
     returning *`,
    [
      invitation.broker_org_id,
      input.providerOrgId,
      invitation.id,
      [...DEFAULT_PERMISSIONS],
      input.actorPartyId,
    ],
  );

  // Legacy portfolio path: sync managed_by_broker_org_id transactionally.
  await client.query(
    `update org set managed_by_broker_org_id = $2 where id = $1`,
    [input.providerOrgId, invitation.broker_org_id],
  );

  const d = del[0]!;
  const delegation: DelegationRow = {
    id: d.id,
    broker_org_id: d.broker_org_id,
    provider_org_id: d.provider_org_id,
    invitation_id: d.invitation_id,
    status: d.status,
    permissions: d.permissions,
    accepted_at: d.accepted_at.toISOString(),
    revoked_at: null,
  };

  const invRow = updatedInv[0]!;
  const invitationOut: BrokerInvitationRow = {
    id: invRow.id,
    broker_org_id: invRow.broker_org_id,
    provider_org_id: invRow.provider_org_id,
    contact_email: invRow.contact_email,
    business_name: invRow.business_name,
    note: invRow.note,
    status: invRow.status,
    invited_by_party_id: invRow.invited_by_party_id,
    created_at: invRow.created_at.toISOString(),
    accepted_at: invRow.accepted_at?.toISOString() ?? null,
    expires_at: invRow.expires_at?.toISOString() ?? null,
  };

  await emitDomainEvent(client, {
    aggregateType: 'org',
    aggregateId: input.providerOrgId,
    eventType: 'broker_provider_delegation.accepted',
    payload: {
      invitation_id: invitation.id,
      broker_org_id: invitation.broker_org_id,
      provider_org_id: input.providerOrgId,
      permissions: [...DEFAULT_PERMISSIONS],
      legacy_managed_by_synced: true,
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });

  return { invitation: invitationOut, delegation };
}

/**
 * Revoke delegation immediately — blocks future broker access.
 * Invitation row stays (status revoked); audit preserved.
 */
export async function revokeBrokerDelegation(
  client: DbClient,
  input: {
    brokerOrgId: string;
    providerOrgId: string;
    actorPartyId: string;
  },
): Promise<DelegationRow> {
  const { rows } = await client.query<{
    id: string;
    broker_org_id: string;
    provider_org_id: string;
    invitation_id: string | null;
    status: string;
    permissions: string[];
    accepted_at: Date;
    revoked_at: Date | null;
  }>(
    `update broker_provider_delegation
     set status = 'revoked',
         revoked_at = now(),
         revoked_by_party_id = $3
     where broker_org_id = $1 and provider_org_id = $2 and status = 'accepted'
     returning *`,
    [input.brokerOrgId, input.providerOrgId, input.actorPartyId],
  );
  if (!rows[0]) {
    throw new AppError('active delegation not found', 'delegation_not_found', 404);
  }

  await client.query(
    `update org
     set managed_by_broker_org_id = null
     where id = $1 and managed_by_broker_org_id = $2`,
    [input.providerOrgId, input.brokerOrgId],
  );

  if (rows[0].invitation_id) {
    await client.query(
      `update broker_provider_invitation
       set status = 'revoked'
       where id = $1 and status = 'accepted'`,
      [rows[0].invitation_id],
    );
  }

  await emitDomainEvent(client, {
    aggregateType: 'org',
    aggregateId: input.providerOrgId,
    eventType: 'broker_provider_delegation.revoked',
    payload: {
      broker_org_id: input.brokerOrgId,
      provider_org_id: input.providerOrgId,
      invitation_id: rows[0].invitation_id,
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });

  const d = rows[0];
  return {
    id: d.id,
    broker_org_id: d.broker_org_id,
    provider_org_id: d.provider_org_id,
    invitation_id: d.invitation_id,
    status: d.status,
    permissions: d.permissions,
    accepted_at: d.accepted_at.toISOString(),
    revoked_at: d.revoked_at?.toISOString() ?? null,
  };
}

export async function assertDelegatedAccess(
  client: DbClient,
  brokerOrgId: string,
  providerOrgId: string,
): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `select id from broker_provider_delegation
     where broker_org_id = $1 and provider_org_id = $2 and status = 'accepted'
     limit 1`,
    [brokerOrgId, providerOrgId],
  );
  if (rows[0]) return;

  // Legacy fallback while both paths coexist
  const { rows: legacy } = await client.query<{ id: string }>(
    `select id from org
     where id = $1 and managed_by_broker_org_id = $2`,
    [providerOrgId, brokerOrgId],
  );
  if (!legacy[0]) {
    throw new AppError('provider not in broker portfolio', 'broker_provider_forbidden', 403);
  }
}
