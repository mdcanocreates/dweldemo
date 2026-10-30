import { createHash, randomBytes } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';
import {
  mayAcknowledgePacket,
  mayReadAgencyCase,
  mayReadSensitiveCaseFields,
  mayVerifyAssistance,
  type AuthorityPrincipal,
} from './access.js';
import type { AuthorityRoleName, CreateHousingCaseInput } from './contracts.js';
import { appointmentStatusLabel, caseStatusLabel, nextCaseAction, packetStatusLabel } from './labels.js';

export function authorityLiteEnabled(): boolean {
  return process.env.DWEL_AUTHORITY_LITE === '1';
}

export function authoritySandboxEnabled(): boolean {
  return (
    authorityLiteEnabled() &&
    process.env.DWEL_AUTHORITY_SANDBOX === '1' &&
    process.env.APP_ENV !== 'production'
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export type StaffContext = AuthorityPrincipal & { agencyId: string };

export async function loadStaff(
  client: DbClient,
  partyId: string,
  agencyId: string,
): Promise<StaffContext> {
  const { rows } = await client.query<{ id: string; role: AuthorityRoleName }>(
    `select id, role from authority_membership
     where agency_id = $1 and staff_party_id = $2 and status = 'active'
     order by case role
       when 'agency_owner' then 1
       when 'agency_supervisor' then 2
       when 'caseworker' then 3
       when 'inspection_coordinator' then 4
       else 5
     end
     limit 1`,
    [agencyId, partyId],
  );
  const row = rows[0];
  if (!row) throw new AppError('not found', 'not_found', 404);
  return { partyId, agencyId, membershipId: row.id, role: row.role };
}

async function recordEvent(
  client: DbClient,
  input: {
    agencyId: string;
    caseId: string | null;
    actorPartyId: string;
    actorKind: 'agency' | 'participant' | 'provider' | 'system' | 'integration';
    eventType: string;
    requestId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `insert into authority_event (
       agency_id, case_id, actor_party_id, actor_kind, event_type, metadata, request_id
     ) values ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      input.agencyId,
      input.caseId,
      input.actorPartyId,
      input.actorKind,
      input.eventType,
      JSON.stringify(input.metadata ?? {}),
      input.requestId,
    ],
  );
  if (input.actorKind === 'participant' || input.actorKind === 'provider') return;
  await client.query(
    `insert into authority_outbox (agency_id, case_id, event_type, payload)
     values ($1,$2,$3,$4::jsonb)`,
    [
      input.agencyId,
      input.caseId,
      input.eventType,
      JSON.stringify({ requestId: input.requestId }),
    ],
  );
}

async function replayOrStore(
  client: DbClient,
  input: {
    agencyId: string;
    actorPartyId: string;
    operation: string;
    idempotencyKey: string | null;
    payloadHash: string;
    response: Record<string, unknown>;
  },
): Promise<Record<string, unknown> | null> {
  if (!input.idempotencyKey) return null;
  const existing = await client.query<{ payload_hash: string; response_json: Record<string, unknown> }>(
    `select payload_hash, response_json from authority_idempotency
     where agency_id = $1 and actor_party_id = $2 and operation = $3 and idempotency_key = $4`,
    [input.agencyId, input.actorPartyId, input.operation, input.idempotencyKey],
  );
  const prior = existing.rows[0];
  if (prior) {
    if (prior.payload_hash !== input.payloadHash) {
      throw new AppError('idempotency key was reused with a different payload', 'idempotency_conflict', 409);
    }
    return prior.response_json;
  }
  await client.query(
    `insert into authority_idempotency (
       agency_id, actor_party_id, operation, idempotency_key, payload_hash, response_json
     ) values ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      input.agencyId,
      input.actorPartyId,
      input.operation,
      input.idempotencyKey,
      input.payloadHash,
      JSON.stringify(input.response),
    ],
  );
  return null;
}

export async function createSandboxAgency(
  client: DbClient,
  input: { partyId: string; displayName: string },
): Promise<{ agencyId: string; membershipId: string }> {
  const tenant = await client.query<{ id: string }>(
    `insert into authority_tenant (display_name, status) values ($1, 'trial') returning id`,
    [input.displayName],
  );
  const agencyId = tenant.rows[0]!.id;
  const member = await client.query<{ id: string }>(
    `insert into authority_membership (agency_id, staff_party_id, role, status)
     values ($1,$2,'agency_owner','active') returning id`,
    [agencyId, input.partyId],
  );
  return { agencyId, membershipId: member.rows[0]!.id };
}

export async function inviteStaff(
  client: DbClient,
  staff: StaffContext,
  input: { email: string; role: AuthorityRoleName },
): Promise<{ invitationId: string; expiresAt: string; acceptToken: string }> {
  if (staff.role !== 'agency_owner') throw new AppError('not found', 'forbidden', 403);
  const token = randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 7 * 86400000);
  const row = await client.query<{ id: string }>(
    `insert into authority_invitation (agency_id, email, role, token_hash, expires_at)
     values ($1,$2,$3,$4,$5) returning id`,
    [staff.agencyId, input.email.trim().toLowerCase(), input.role, sha256(token), expires],
  );
  return {
    invitationId: row.rows[0]!.id,
    expiresAt: expires.toISOString(),
    acceptToken: token,
  };
}

export async function acceptInvitation(
  client: DbClient,
  input: { partyId: string; token: string },
): Promise<{ agencyId: string; role: string }> {
  const found = await client.query<{ id: string; agency_id: string; role: AuthorityRoleName; expires_at: Date }>(
    `select id, agency_id, role, expires_at from authority_invitation
     where token_hash = $1 and accepted_party_id is null`,
    [sha256(input.token)],
  );
  const invite = found.rows[0];
  if (!invite || invite.expires_at.getTime() < Date.now()) {
    throw new AppError('invitation not found', 'not_found', 404);
  }
  await client.query(
    `insert into authority_membership (agency_id, staff_party_id, role, status)
     values ($1,$2,$3,'active')
     on conflict (agency_id, staff_party_id, role) do update set status = 'active'`,
    [invite.agency_id, input.partyId, invite.role],
  );
  await client.query(`update authority_invitation set accepted_party_id = $2 where id = $1`, [
    invite.id,
    input.partyId,
  ]);
  return { agencyId: invite.agency_id, role: invite.role };
}

async function loadVisibleCase(
  client: DbClient,
  staff: StaffContext,
  caseId: string,
): Promise<Record<string, unknown>> {
  const { rows } = await client.query<Record<string, unknown>>(
    `select * from authority_housing_case where id = $1 and agency_id = $2`,
    [caseId, staff.agencyId],
  );
  const row = rows[0];
  if (!row) throw new AppError('not found', 'not_found', 404);
  const shares = await client.query<{ grantee_party_id: string }>(
    `select grantee_party_id from authority_case_share
     where case_id = $1 and revoked_at is null and accepted_at is not null and expires_at > now()`,
    [caseId],
  );
  const allowed = mayReadAgencyCase({
    principal: staff,
    assignedMembershipId: (row.assigned_membership_id as string | null) ?? null,
    sharedPartyIds: shares.rows.map((share) => share.grantee_party_id),
  });
  if (!allowed) throw new AppError('not found', 'not_found', 404);
  if (!mayReadSensitiveCaseFields(staff.role)) {
    return { ...row, verification_source: null, program_type: null, assistance_indicator: 'unknown' };
  }
  return row;
}

function presentCase(row: Record<string, unknown>) {
  const status = String(row.status);
  return {
    id: row.id,
    reference: row.display_reference,
    status,
    statusLabel: caseStatusLabel(status),
    nextAction: nextCaseAction(status),
    assistanceIndicator: row.assistance_indicator,
    searchPreferences: row.search_preferences,
    version: row.version,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export async function createHousingCase(
  client: DbClient,
  staff: StaffContext,
  input: CreateHousingCaseInput,
  idempotencyKey: string | null,
  requestId: string,
): Promise<Record<string, unknown>> {
  if (!['agency_owner', 'agency_supervisor', 'caseworker'].includes(staff.role)) {
    throw new AppError('not found', 'forbidden', 403);
  }
  const payloadHash = sha256(JSON.stringify(input));
  if (idempotencyKey) {
    const existing = await client.query<{ payload_hash: string; response_json: Record<string, unknown> }>(
      `select payload_hash, response_json from authority_idempotency
       where agency_id = $1 and actor_party_id = $2 and operation = 'case.create' and idempotency_key = $3`,
      [staff.agencyId, staff.partyId, idempotencyKey],
    );
    const prior = existing.rows[0];
    if (prior) {
      if (prior.payload_hash !== payloadHash) {
        throw new AppError('idempotency key was reused with a different payload', 'idempotency_conflict', 409);
      }
      return prior.response_json;
    }
  }
  const assigned = input.assignedMembershipId ?? staff.membershipId;
  const inserted = await client.query(
    `insert into authority_housing_case (
       agency_id, display_reference, status, search_preferences, assistance_indicator,
       assigned_membership_id, dwel_party_id
     ) values ($1,$2,'draft',$3::jsonb,$4,$5,$6)
     returning *`,
    [
      staff.agencyId,
      input.displayReference,
      JSON.stringify(input.searchPreferences),
      input.assistanceIndicator,
      assigned,
      input.dwelPartyId ?? null,
    ],
  );
  const row = inserted.rows[0] as Record<string, unknown>;
  await recordEvent(client, {
    agencyId: staff.agencyId,
    caseId: String(row.id),
    actorPartyId: staff.partyId,
    actorKind: 'agency',
    eventType: 'authority.case_created',
    requestId,
  });
  const response = { case: presentCase(row), replayed: false };
  const replay = await replayOrStore(client, {
    agencyId: staff.agencyId,
    actorPartyId: staff.partyId,
    operation: 'case.create',
    idempotencyKey,
    payloadHash,
    response,
  });
  return replay ?? response;
}

export async function listHousingCases(client: DbClient, staff: StaffContext) {
  const { rows } = await client.query(
    `select * from authority_housing_case where agency_id = $1 order by updated_at desc limit 100`,
    [staff.agencyId],
  );
  const visible = [];
  for (const row of rows) {
    try {
      const loaded = await loadVisibleCase(client, staff, String((row as { id: string }).id));
      visible.push(presentCase(loaded));
    } catch (err) {
      if (!(err instanceof AppError) || err.status !== 404) throw err;
    }
  }
  return { cases: visible };
}

export async function getHousingCase(client: DbClient, staff: StaffContext, caseId: string) {
  return { case: presentCase(await loadVisibleCase(client, staff, caseId)) };
}

export async function dashboard(client: DbClient, staff: StaffContext) {
  const cases = await listHousingCases(client, staff);
  const rows = cases.cases as Array<{ status: string }>;
  return {
    active_searches: rows.filter((row) => row.status === 'searching' || row.status === 'draft').length,
    packets_needing_input: rows.filter((row) => row.status === 'tenancy_packet').length,
    confirmed_leaseups: rows.filter((row) => row.status === 'leaseup_confirmed').length,
    source: 'authority_housing_case',
    updatedAt: new Date().toISOString(),
  };
}

export async function shareCase(
  client: DbClient,
  staff: StaffContext,
  caseId: string,
  input: { granteePartyId: string; purpose: string; days: number },
) {
  await loadVisibleCase(client, staff, caseId);
  if (!['agency_owner', 'agency_supervisor', 'caseworker'].includes(staff.role)) {
    throw new AppError('not found', 'forbidden', 403);
  }
  const expires = new Date(Date.now() + input.days * 86400000);
  const row = await client.query<{ id: string }>(
    `insert into authority_case_share (
       agency_id, case_id, grantee_party_id, scope, purpose, expires_at
     ) values ($1,$2,$3,$4,$5,$6) returning id`,
    [staff.agencyId, caseId, input.granteePartyId, ['case.read'], input.purpose, expires],
  );
  return { shareId: row.rows[0]!.id, expiresAt: expires.toISOString() };
}

export async function acceptShare(client: DbClient, partyId: string, shareId: string, requestId: string) {
  const updated = await client.query<{ agency_id: string; case_id: string }>(
    `update authority_case_share
     set accepted_at = now()
     where id = $1 and grantee_party_id = $2 and revoked_at is null and expires_at > now()
     returning agency_id, case_id`,
    [shareId, partyId],
  );
  const row = updated.rows[0];
  if (!row) throw new AppError('not found', 'not_found', 404);
  await recordEvent(client, {
    agencyId: row.agency_id,
    caseId: row.case_id,
    actorPartyId: partyId,
    actorKind: 'participant',
    eventType: 'authority.share_accepted',
    requestId,
  });
  return { accepted: true, caseId: row.case_id };
}

export async function revokeShare(client: DbClient, partyId: string, shareId: string) {
  const updated = await client.query(
    `update authority_case_share set revoked_at = now()
     where id = $1 and grantee_party_id = $2 and revoked_at is null
     returning id`,
    [shareId, partyId],
  );
  if (!updated.rows[0]) throw new AppError('not found', 'not_found', 404);
  return { revoked: true };
}

export async function createLead(
  client: DbClient,
  staff: StaffContext,
  caseId: string,
  input: { listingId: string; providerPartyId: string },
) {
  await loadVisibleCase(client, staff, caseId);
  const listing = await client.query<{ id: string; status: string }>(
    `select id, status from listing where id = $1`,
    [input.listingId],
  );
  if (!listing.rows[0]) throw new AppError('listing not found', 'not_found', 404);
  const row = await client.query(
    `insert into authority_housing_lead (
       agency_id, case_id, dwel_listing_id, provider_party_id, listing_source,
       availability_checked_at, status
     ) values ($1,$2,$3,$4,'dwel', now(), 'saved')
     returning id, status, availability_checked_at`,
    [staff.agencyId, caseId, input.listingId, input.providerPartyId],
  );
  return { lead: row.rows[0] };
}

export async function sendOutreach(
  client: DbClient,
  staff: StaffContext,
  leadId: string,
  input: { body: string; idempotencyKey: string },
) {
  const payloadHash = sha256(input.body);
  const prior = await replayOrStore(client, {
    agencyId: staff.agencyId,
    actorPartyId: staff.partyId,
    operation: 'lead.outreach',
    idempotencyKey: input.idempotencyKey,
    payloadHash,
    response: {},
  });
  if (prior && Object.keys(prior).length > 0) return prior;
  const lead = await client.query<{ case_id: string }>(
    `select case_id from authority_housing_lead where id = $1 and agency_id = $2`,
    [leadId, staff.agencyId],
  );
  if (!lead.rows[0]) throw new AppError('not found', 'not_found', 404);
  const message = await client.query<{ id: string }>(
    `insert into authority_outreach (agency_id, lead_id, idempotency_key, body)
     values ($1,$2,$3,$4) returning id`,
    [staff.agencyId, leadId, input.idempotencyKey, input.body],
  );
  await client.query(
    `update authority_housing_lead set status = 'contacted', updated_at = now() where id = $1`,
    [leadId],
  );
  const response = { outreachId: message.rows[0]!.id, statusLabel: 'Contacted' };
  await client.query(
    `update authority_idempotency set response_json = $5::jsonb
     where agency_id = $1 and actor_party_id = $2 and operation = 'lead.outreach' and idempotency_key = $3
       and payload_hash = $4`,
    [staff.agencyId, staff.partyId, input.idempotencyKey, payloadHash, JSON.stringify(response)],
  );
  return response;
}

export async function startPacket(client: DbClient, staff: StaffContext, caseId: string, leadId: string) {
  await loadVisibleCase(client, staff, caseId);
  const row = await client.query(
    `insert into authority_tenancy_packet (
       agency_id, case_id, lead_id, form_version, status
     ) values ($1,$2,$3,'rfta-lite-1','awaiting_participant')
     returning id, status`,
    [staff.agencyId, caseId, leadId],
  );
  await client.query(
    `update authority_housing_case set status = 'tenancy_packet', updated_at = now(), version = version + 1
     where id = $1`,
    [caseId],
  );
  return {
    packetId: (row.rows[0] as { id: string }).id,
    statusLabel: packetStatusLabel('awaiting_participant'),
  };
}

export async function patchPacketSection(
  client: DbClient,
  input: {
    partyId: string;
    packetId: string;
    section: 'participant' | 'provider';
    fields: Record<string, unknown>;
  },
) {
  if (input.section === 'provider') {
    const lead = await client.query<{ provider_party_id: string | null }>(
      `select l.provider_party_id
       from authority_tenancy_packet p
       join authority_housing_lead l on l.id = p.lead_id
       where p.id = $1`,
      [input.packetId],
    );
    if (lead.rows[0]?.provider_party_id !== input.partyId) {
      throw new AppError('not found', 'not_found', 404);
    }
  } else {
    const housing = await client.query<{ dwel_party_id: string | null }>(
      `select c.dwel_party_id
       from authority_tenancy_packet p
       join authority_housing_case c on c.id = p.case_id
       where p.id = $1`,
      [input.packetId],
    );
    if (housing.rows[0]?.dwel_party_id !== input.partyId) {
      throw new AppError('not found', 'not_found', 404);
    }
  }
  const column = input.section === 'participant' ? 'participant_fields' : 'provider_fields';
  const updated = await client.query<{ status: string }>(
    `update authority_tenancy_packet
     set ${column} = $2::jsonb, updated_at = now(), version = version + 1,
         status = case
           when $3 = 'participant' then 'awaiting_provider'
           else status
         end
     where id = $1
     returning status`,
    [input.packetId, JSON.stringify(input.fields), input.section],
  );
  if (!updated.rows[0]) throw new AppError('not found', 'not_found', 404);
  return { statusLabel: packetStatusLabel(updated.rows[0].status) };
}

export async function submitPacket(client: DbClient, staff: StaffContext, packetId: string, requestId: string) {
  const packet = await client.query<{
    id: string;
    case_id: string;
    status: string;
    participant_fields: Record<string, unknown>;
    provider_fields: Record<string, unknown>;
    form_version: string;
  }>(
    `select id, case_id, status, participant_fields, provider_fields, form_version
     from authority_tenancy_packet where id = $1 and agency_id = $2`,
    [packetId, staff.agencyId],
  );
  const row = packet.rows[0];
  if (!row) throw new AppError('not found', 'not_found', 404);
  const participant = row.participant_fields ?? {};
  const provider = row.provider_fields ?? {};
  if (!participant.contact_name || provider.proposed_rent_cents == null) {
    throw new AppError('packet is incomplete', 'packet_incomplete', 409);
  }
  const contentHash = sha256(JSON.stringify({ form: row.form_version, participant, provider }));
  await client.query(
    `update authority_tenancy_packet
     set status = 'sent_to_agency', content_hash = $2, updated_at = now()
     where id = $1 and status <> 'agency_acknowledged'`,
    [packetId, contentHash],
  );
  await client.query(
    `update authority_housing_case set status = 'agency_review', updated_at = now() where id = $1`,
    [row.case_id],
  );
  await recordEvent(client, {
    agencyId: staff.agencyId,
    caseId: row.case_id,
    actorPartyId: staff.partyId,
    actorKind: 'agency',
    eventType: 'authority.packet_sent',
    requestId,
    metadata: { contentHash },
  });
  return { status: 'sent_to_agency', statusLabel: packetStatusLabel('sent_to_agency'), contentHash };
}

export async function acknowledgePacket(
  client: DbClient,
  staff: StaffContext,
  packetId: string,
  reference: string,
  requestId: string,
) {
  if (!mayAcknowledgePacket(staff.role)) throw new AppError('not found', 'forbidden', 403);
  const updated = await client.query<{ case_id: string }>(
    `update authority_tenancy_packet
     set status = 'agency_acknowledged', agency_ack_reference = $3, updated_at = now()
     where id = $1 and agency_id = $2 and status = 'sent_to_agency'
     returning case_id`,
    [packetId, staff.agencyId, reference],
  );
  const row = updated.rows[0];
  if (!row) throw new AppError('not found', 'not_found', 404);
  await recordEvent(client, {
    agencyId: staff.agencyId,
    caseId: row.case_id,
    actorPartyId: staff.partyId,
    actorKind: 'agency',
    eventType: 'authority.agency_ack_received',
    requestId,
  });
  return { statusLabel: packetStatusLabel('agency_acknowledged') };
}

export async function scheduleAppointment(
  client: DbClient,
  staff: StaffContext,
  caseId: string,
  windowStart: string,
) {
  if (!['inspection_coordinator', 'agency_supervisor', 'agency_owner'].includes(staff.role)) {
    throw new AppError('not found', 'forbidden', 403);
  }
  await loadVisibleCase(client, staff, caseId);
  const row = await client.query<{ id: string; status: string }>(
    `insert into authority_appointment (agency_id, case_id, status, window_start)
     values ($1,$2,'scheduled',$3) returning id, status`,
    [staff.agencyId, caseId, windowStart],
  );
  return {
    appointmentId: row.rows[0]!.id,
    statusLabel: appointmentStatusLabel(row.rows[0]!.status),
  };
}

export async function recordExternalInspection(
  client: DbClient,
  staff: StaffContext,
  appointmentId: string,
  input: { source: string; observation: string },
) {
  if (!['inspection_coordinator', 'agency_supervisor', 'agency_owner'].includes(staff.role)) {
    throw new AppError('not found', 'forbidden', 403);
  }
  if (!input.source.trim()) throw new AppError('agency source is required', 'validation_error', 400);
  const updated = await client.query<{ status: string }>(
    `update authority_appointment
     set status = 'external_result_recorded', official_source = $3, official_observation = $4,
         recorded_by_party_id = $5, updated_at = now()
     where id = $1 and agency_id = $2
     returning status`,
    [appointmentId, staff.agencyId, input.source.trim(), input.observation.trim(), staff.partyId],
  );
  if (!updated.rows[0]) throw new AppError('not found', 'not_found', 404);
  return { statusLabel: appointmentStatusLabel('external_result_recorded') };
}

export async function createUploadIntent(
  client: DbClient,
  staff: StaffContext,
  caseId: string,
  input: { filename: string; mimeType: string; byteSize: number },
) {
  await loadVisibleCase(client, staff, caseId);
  const row = await client.query<{ id: string }>(
    `insert into authority_document (
       agency_id, case_id, storage_key, mime_type, byte_size, scan_status, created_by_party_id
     ) values ($1,$2,$3,$4,$5,'quarantine',$6) returning id`,
    [
      staff.agencyId,
      caseId,
      `authority/${staff.agencyId}/${caseId}/${input.filename}`,
      input.mimeType,
      input.byteSize,
      staff.partyId,
    ],
  );
  const id = row.rows[0]!.id;
  await client.query(`update authority_document set storage_key = $2 where id = $1`, [
    id,
    `authority/${staff.agencyId}/${caseId}/${id}`,
  ]);
  return { documentId: id, scanStatus: 'quarantine' };
}

export async function previewDocument(client: DbClient, partyId: string, documentId: string) {
  const doc = await client.query<{ id: string; storage_key: string; scan_status: string }>(
    `select id, storage_key, scan_status from authority_document where id = $1`,
    [documentId],
  );
  const row = doc.rows[0];
  if (!row || row.scan_status === 'rejected') {
    throw new AppError('This file is not available.', 'not_found', 404);
  }
  if (row.storage_key.startsWith('missing/')) {
    throw new AppError('This file is not available.', 'not_found', 404);
  }
  const token = randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 90_000);
  await client.query(
    `insert into authority_preview_grant (document_id, party_id, token_hash, expires_at)
     values ($1,$2,$3,$4)`,
    [row.id, partyId, sha256(token), expires],
  );
  await client.query(
    `insert into authority_event (
       agency_id, case_id, actor_party_id, actor_kind, event_type, metadata
     )
     select agency_id, case_id, $2, 'agency', 'authority.document_previewed', '{}'::jsonb
     from authority_document where id = $1`,
    [row.id, partyId],
  );
  return { token, expiresAt: expires.toISOString() };
}

export async function openPreview(client: DbClient, partyId: string, token: string) {
  const grant = await client.query<{ document_id: string; expires_at: Date; storage_key: string }>(
    `select g.document_id, g.expires_at, d.storage_key
     from authority_preview_grant g
     join authority_document d on d.id = g.document_id
     where g.token_hash = $1 and g.party_id = $2`,
    [sha256(token), partyId],
  );
  const row = grant.rows[0];
  if (!row || row.expires_at.getTime() < Date.now()) {
    throw new AppError('This preview has expired.', 'not_found', 404);
  }
  if (row.storage_key.startsWith('missing/')) {
    throw new AppError('This file is not available.', 'not_found', 404);
  }
  return { storageKey: row.storage_key, cacheControl: 'private, no-store' };
}

export async function leaseupReport(client: DbClient, staff: StaffContext) {
  if (!mayAcknowledgePacket(staff.role)) throw new AppError('not found', 'forbidden', 403);
  const count = await client.query<{ n: string }>(
    `select count(*)::text as n from authority_housing_case
     where agency_id = $1 and status = 'leaseup_confirmed'`,
    [staff.agencyId],
  );
  const numerator = Number(count.rows[0]?.n ?? 0);
  if (numerator < 5) {
    return {
      period: 'all',
      numerator: null,
      denominator: null,
      suppressed: true,
      minimumCell: 5,
      source: 'authority_housing_case',
    };
  }
  return {
    period: 'all',
    numerator,
    denominator: numerator,
    suppressed: false,
    minimumCell: 5,
    source: 'authority_housing_case',
  };
}

export async function confirmLeaseup(
  client: DbClient,
  staff: StaffContext,
  caseId: string,
  source: string,
  requestId: string,
) {
  if (!mayAcknowledgePacket(staff.role)) throw new AppError('not found', 'forbidden', 403);
  if (!source.trim()) throw new AppError('agency source is required', 'validation_error', 400);
  const updated = await client.query(
    `update authority_housing_case
     set status = 'leaseup_confirmed', updated_at = now(), version = version + 1
     where id = $1 and agency_id = $2
     returning id`,
    [caseId, staff.agencyId],
  );
  if (!updated.rows[0]) throw new AppError('not found', 'not_found', 404);
  await recordEvent(client, {
    agencyId: staff.agencyId,
    caseId,
    actorPartyId: staff.partyId,
    actorKind: 'integration',
    eventType: 'authority.leaseup_confirmed',
    requestId,
    metadata: { source: source.trim() },
  });
  return { statusLabel: caseStatusLabel('leaseup_confirmed') };
}

export async function listTimeline(client: DbClient, staff: StaffContext, caseId: string) {
  await loadVisibleCase(client, staff, caseId);
  const { rows } = await client.query(
    `select event_type, occurred_at from authority_event
     where agency_id = $1 and case_id = $2
     order by occurred_at asc`,
    [staff.agencyId, caseId],
  );
  return {
    events: rows.map((row) => ({
      type: row.event_type,
      at: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
    })),
  };
}

export async function listMyAgencies(client: DbClient, partyId: string) {
  const { rows } = await client.query<{ id: string; display_name: string; role: string }>(
    `select t.id, t.display_name, m.role
     from authority_membership m
     join authority_tenant t on t.id = m.agency_id
     where m.staff_party_id = $1 and m.status = 'active'
     order by t.display_name`,
    [partyId],
  );
  return {
    agencies: rows.map((row) => ({
      agencyId: row.id,
      displayName: row.display_name,
      role: row.role,
    })),
  };
}

export async function listParticipantCases(client: DbClient, partyId: string) {
  const { rows } = await client.query(
    `select c.id, c.display_reference, c.status
     from authority_housing_case c
     join authority_case_share s on s.case_id = c.id
     where s.grantee_party_id = $1
       and s.accepted_at is not null
       and s.revoked_at is null
       and s.expires_at > now()`,
    [partyId],
  );
  return {
    cases: rows.map((row) => ({
      id: row.id,
      reference: row.display_reference,
      statusLabel: caseStatusLabel(String(row.status)),
    })),
  };
}

export async function listProviderLeads(client: DbClient, partyId: string) {
  const { rows } = await client.query(
    `select l.id, l.status, l.dwel_listing_id
     from authority_housing_lead l
     where l.provider_party_id = $1`,
    [partyId],
  );
  return {
    leads: rows.map((row) => ({
      id: row.id,
      listingId: row.dwel_listing_id,
      statusLabel: String(row.status) === 'contacted' ? 'Contacted' : 'Saved',
    })),
  };
}

export async function previewImport(client: DbClient, staff: StaffContext, csv: string) {
  if (staff.role !== 'agency_owner') throw new AppError('not found', 'forbidden', 403);
  const lines = csv.split(/\r?\n/).filter((line) => line.trim());
  const errors: string[] = [];
  const refs = new Set<string>();
  for (const line of lines.slice(1)) {
    const ref = line.split(',')[0]?.trim() ?? '';
    if (ref.length < 3) errors.push('reference too short');
    if (refs.has(ref)) errors.push(`duplicate ${ref}`);
    refs.add(ref);
  }
  const checksum = sha256(csv);
  await client.query(
    `insert into authority_import_batch (agency_id, mode, checksum, row_count, error_report)
     values ($1,'preview',$2,$3,$4::jsonb)`,
    [staff.agencyId, checksum, Math.max(lines.length - 1, 0), JSON.stringify(errors)],
  );
  return { mode: 'preview', rowCount: Math.max(lines.length - 1, 0), errors, applied: false };
}

export async function verifyAssistance(
  client: DbClient,
  staff: StaffContext,
  caseId: string,
  input: { indicator: string; programType: string; verificationSource: string; version: number },
) {
  if (!mayVerifyAssistance(staff.role)) throw new AppError('not found', 'forbidden', 403);
  const updated = await client.query(
    `update authority_housing_case
     set assistance_indicator = $3, program_type = $4, verification_source = $5,
         verified_at = now(), version = version + 1, updated_at = now()
     where id = $1 and agency_id = $2 and version = $6
     returning id`,
    [caseId, staff.agencyId, input.indicator, input.programType, input.verificationSource, input.version],
  );
  if (!updated.rows[0]) throw new AppError('stale case version', 'precondition_failed', 412);
  return { assistanceIndicator: input.indicator };
}
