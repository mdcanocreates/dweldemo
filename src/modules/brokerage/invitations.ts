import type { DbClient } from '../../db/pool.js';
import {
  isEmailDeliveryEnabled,
  sendTransactionalEmail,
} from '../../infra/email/transport.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';

export type BrokerInvitationRow = {
  id: string;
  broker_org_id: string;
  provider_org_id: string | null;
  contact_email: string;
  business_name: string | null;
  note: string | null;
  status: string;
  invited_by_party_id: string;
  created_at: string;
  accepted_at: string | null;
  expires_at: string | null;
};

function mapRow(row: {
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
}): BrokerInvitationRow {
  return {
    id: row.id,
    broker_org_id: row.broker_org_id,
    provider_org_id: row.provider_org_id,
    contact_email: row.contact_email,
    business_name: row.business_name,
    note: row.note,
    status: row.status,
    invited_by_party_id: row.invited_by_party_id,
    created_at: row.created_at.toISOString(),
    accepted_at: row.accepted_at?.toISOString() ?? null,
    expires_at: row.expires_at?.toISOString() ?? null,
  };
}

export async function listBrokerInvitations(
  client: DbClient,
  brokerOrgId: string,
): Promise<BrokerInvitationRow[]> {
  const { rows } = await client.query<{
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
    `select * from broker_provider_invitation
     where broker_org_id = $1
     order by created_at desc`,
    [brokerOrgId],
  );
  return rows.map(mapRow);
}

/**
 * Create invitation. Prod SES send is best-effort:
 * - EMAIL_PROVIDER!=ses → leave status pending (no send)
 * - SES fails → mark delivery_failed
 * Preview stays in-memory elsewhere.
 */
export async function createBrokerInvitation(
  client: DbClient,
  input: {
    brokerOrgId: string;
    actorPartyId: string;
    contactEmail: string;
    businessName?: string | null;
    note?: string | null;
    expiresAt?: string | null;
  },
): Promise<BrokerInvitationRow> {
  const email = input.contactEmail.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new AppError('valid contact_email required', 'validation_error', 400);
  }

  const { rows } = await client.query<{
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
    `insert into broker_provider_invitation (
       broker_org_id, contact_email, business_name, note,
       status, invited_by_party_id, expires_at
     ) values ($1,$2,$3,$4,'pending',$5,$6::timestamptz)
     returning *`,
    [
      input.brokerOrgId,
      email,
      input.businessName?.trim() || null,
      input.note?.trim()?.slice(0, 2000) || null,
      input.actorPartyId,
      input.expiresAt ?? null,
    ],
  );
  let row = mapRow(rows[0]!);

  // Attempt delivery only when SES transport is enabled; otherwise remain pending.
  if (isEmailDeliveryEnabled()) {
    try {
      await sendTransactionalEmail({
        product: 'dwel',
        to: email,
        subject: 'Dwel broker invitation',
        // [PLACEHOLDER] counsel must replace invitation copy before production marketing use
        html: '<p>[PLACEHOLDER] You have been invited to connect with a Dwel broker.</p>',
        text: '[PLACEHOLDER] You have been invited to connect with a Dwel broker.',
      });
      const { rows: updated } = await client.query<{
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
        `update broker_provider_invitation set status = 'delivered' where id = $1 returning *`,
        [row.id],
      );
      row = mapRow(updated[0]!);
    } catch {
      const { rows: failed } = await client.query<{
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
        `update broker_provider_invitation set status = 'delivery_failed' where id = $1 returning *`,
        [row.id],
      );
      row = mapRow(failed[0]!);
    }
  }

  await emitDomainEvent(client, {
    aggregateType: 'org',
    aggregateId: input.brokerOrgId,
    eventType: 'broker_provider_invitation.created',
    payload: {
      invitation_id: row.id,
      status: row.status,
      contact_email: email,
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });

  return row;
}

export async function cancelBrokerInvitation(
  client: DbClient,
  input: { brokerOrgId: string; invitationId: string; actorPartyId: string },
): Promise<BrokerInvitationRow> {
  const { rows } = await client.query<{
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
    `select * from broker_provider_invitation
     where id = $1 and broker_org_id = $2
     for update`,
    [input.invitationId, input.brokerOrgId],
  );
  const existing = rows[0];
  if (!existing) throw new AppError('invitation not found', 'invitation_not_found', 404);
  if (['accepted', 'revoked', 'expired'].includes(existing.status)) {
    throw new AppError(
      `cannot cancel invitation in status ${existing.status}`,
      'invitation_not_cancellable',
      409,
    );
  }

  const { rows: updated } = await client.query<{
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
    `update broker_provider_invitation set status = 'revoked' where id = $1 returning *`,
    [input.invitationId],
  );
  const row = mapRow(updated[0]!);

  await emitDomainEvent(client, {
    aggregateType: 'org',
    aggregateId: input.brokerOrgId,
    eventType: 'broker_provider_invitation.revoked',
    payload: { invitation_id: row.id },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });

  return row;
}

/**
 * Pending invitations visible to a Home Provider org:
 * - provider_org_id already set to this org, or
 * - contact_email matches a party email linked to this org (optional email match).
 */
export async function listPendingInvitationsForProviderOrg(
  client: DbClient,
  input: { providerOrgId: string; contactEmail?: string | null },
): Promise<BrokerInvitationRow[]> {
  const email = input.contactEmail?.trim().toLowerCase() ?? null;
  const { rows } = await client.query<{
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
    `select *
     from broker_provider_invitation
     where status in ('pending', 'delivered')
       and (
         provider_org_id = $1
         or ($2::text is not null and lower(contact_email) = $2)
       )
     order by created_at desc`,
    [input.providerOrgId, email],
  );
  return rows.map(mapRow);
}
