import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';

const NOTE_EVENT = 'broker_note_added';
const REC_EVENT = 'broker_recommendation_set';

export type BrokerRecommendation = 'approve' | 'decline' | null;

async function assertManagedApplication(
  client: DbClient,
  brokerOrgId: string,
  applicationId: string,
): Promise<{
  application_id: string;
  listing_id: string;
  org_id: string;
  status: string;
  listing_label: string;
  provider_name: string;
}> {
  const { rows } = await client.query<{
    application_id: string;
    listing_id: string;
    org_id: string;
    status: string;
    listing_label: string;
    provider_name: string;
  }>(
    `select ap.id as application_id,
            ap.listing_id,
            ap.org_id,
            ap.status,
            coalesce(addr.line1, 'Listing') as listing_label,
            coalesce(o.display_name, o.legal_name, 'Provider') as provider_name
     from application ap
     join listing l on l.id = ap.listing_id
     join org o on o.id = l.org_id
     join unit u on u.id = l.unit_id
     join property p on p.id = u.property_id
     join address addr on addr.id = p.address_id
     where ap.id = $1
       and o.managed_by_broker_org_id = $2
       and o.kind = 'landlord'`,
    [applicationId, brokerOrgId],
  );
  const row = rows[0];
  if (!row) {
    throw new AppError('application not found in managed portfolio', 'application_not_found', 404);
  }
  return row;
}

/**
 * Request screening for a managed applicant.
 * Preview-safe: status transition only — never calls Certn/Stripe/SES.
 */
export async function brokerRequestScreening(
  client: DbClient,
  input: {
    brokerOrgId: string;
    applicationId: string;
    actorPartyId: string;
    preview?: boolean;
  },
): Promise<{ application_id: string; status: string }> {
  const app = await assertManagedApplication(client, input.brokerOrgId, input.applicationId);
  const allowed = new Set(['draft', 'awaiting_landlord_interest', 'submitted', 'prescreen']);
  if (!allowed.has(app.status) && app.status !== 'awaiting_consent') {
    throw new AppError(
      `Cannot request screening from status ${app.status}`,
      'invalid_application_status',
      409,
    );
  }

  await client.query(
    `update application set status = 'awaiting_consent' where id = $1`,
    [app.application_id],
  );

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: app.application_id,
    eventType: 'broker_requested_screening',
    payload: {
      listing_id: app.listing_id,
      org_id: app.org_id,
      broker_org_id: input.brokerOrgId,
      preview: Boolean(input.preview),
      external_side_effects: false,
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });

  return { application_id: app.application_id, status: 'awaiting_consent' };
}

export async function brokerAddNote(
  client: DbClient,
  input: {
    brokerOrgId: string;
    applicationId: string;
    actorPartyId: string;
    note: string;
    preview?: boolean;
  },
): Promise<{ application_id: string; note: string }> {
  const note = input.note.trim();
  if (!note) throw new AppError('note required', 'validation_error', 400);
  if (note.length > 2000) throw new AppError('note too long', 'validation_error', 400);

  const app = await assertManagedApplication(client, input.brokerOrgId, input.applicationId);

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: app.application_id,
    eventType: NOTE_EVENT,
    payload: {
      note,
      listing_id: app.listing_id,
      org_id: app.org_id,
      broker_org_id: input.brokerOrgId,
      preview: Boolean(input.preview),
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });

  return { application_id: app.application_id, note };
}

export async function brokerSetRecommendation(
  client: DbClient,
  input: {
    brokerOrgId: string;
    applicationId: string;
    actorPartyId: string;
    recommendation: BrokerRecommendation;
    preview?: boolean;
  },
): Promise<{ application_id: string; recommendation: BrokerRecommendation }> {
  const app = await assertManagedApplication(client, input.brokerOrgId, input.applicationId);

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: app.application_id,
    eventType: REC_EVENT,
    payload: {
      recommendation: input.recommendation,
      listing_id: app.listing_id,
      org_id: app.org_id,
      broker_org_id: input.brokerOrgId,
      preview: Boolean(input.preview),
      // Explicit: brokers recommend only — never final decision
      final_decision: false,
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });

  return { application_id: app.application_id, recommendation: input.recommendation };
}

export async function getBrokerApplicationDetail(
  client: DbClient,
  brokerOrgId: string,
  applicationId: string,
): Promise<{
  application_id: string;
  listing_id: string;
  org_id: string;
  status: string;
  listing_label: string;
  provider_name: string;
  renter_label: string;
  screening_status: string;
  can_request_screening: boolean;
  notes: Array<{ note: string; at: string; actor_party_id: string | null }>;
  recommendation: BrokerRecommendation;
  recommendation_at: string | null;
}> {
  const app = await assertManagedApplication(client, brokerOrgId, applicationId);

  const { rows: renterRows } = await client.query<{
    given_name: string | null;
    family_name: string | null;
  }>(
    `select rp.given_name, rp.family_name
     from application ap
     left join renter_profile rp on rp.id = ap.renter_profile_id
     where ap.id = $1`,
    [applicationId],
  );
  const rn = renterRows[0];
  const renter_label =
    [rn?.given_name, rn?.family_name?.slice(0, 1)].filter(Boolean).join(' ').trim() || 'Renter';

  const screeningStatuses = new Set([
    'awaiting_consent',
    'screening_authorized',
    'screening_running',
    'screened',
    'screening_complete',
    'awaiting_provider_configuration',
  ]);

  const { rows: events } = await client.query<{
    event_type: string;
    payload: { note?: string; recommendation?: BrokerRecommendation };
    occurred_at: Date;
    actor_party_id: string | null;
  }>(
    `select event_type, payload, occurred_at, actor_party_id
     from domain_event
     where aggregate_type = 'application'
       and aggregate_id = $1
       and event_type in ($2, $3)
     order by seq asc`,
    [applicationId, NOTE_EVENT, REC_EVENT],
  );

  const notes = events
    .filter((e) => e.event_type === NOTE_EVENT && e.payload?.note)
    .map((e) => ({
      note: String(e.payload.note),
      at: e.occurred_at.toISOString(),
      actor_party_id: e.actor_party_id,
    }));

  let recommendation: BrokerRecommendation = null;
  let recommendation_at: string | null = null;
  for (const e of events) {
    if (e.event_type === REC_EVENT) {
      recommendation = (e.payload?.recommendation ?? null) as BrokerRecommendation;
      recommendation_at = e.occurred_at.toISOString();
    }
  }

  const can_request_screening = ['draft', 'awaiting_landlord_interest', 'submitted', 'prescreen'].includes(
    app.status,
  );

  return {
    application_id: app.application_id,
    listing_id: app.listing_id,
    org_id: app.org_id,
    status: app.status,
    listing_label: app.listing_label,
    provider_name: app.provider_name,
    renter_label,
    screening_status: screeningStatuses.has(app.status) ? app.status : 'none',
    can_request_screening,
    notes,
    recommendation,
    recommendation_at,
  };
}
