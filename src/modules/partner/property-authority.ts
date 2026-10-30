import type { DbClient } from '../../db/pool.js';
import { appendAdminAction, emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';

export type PropertyAuthorityRecord = {
  id: string;
  org_id: string;
  property_id: string;
  authority_kind: 'owner' | 'manager';
  statement: string;
  status: 'pending' | 'verified' | 'rejected';
  reviewer_note: string | null;
};

export async function submitPropertyAuthority(
  client: DbClient,
  input: {
    orgId: string;
    listingId: string;
    partyId: string;
    authorityKind: 'owner' | 'manager';
    statement: string;
  },
): Promise<PropertyAuthorityRecord> {
  const { rows: located } = await client.query<{ property_id: string }>(
    `select u.property_id
     from listing l
     join unit u on u.id = l.unit_id
     where l.id = $1 and l.org_id = $2`,
    [input.listingId, input.orgId],
  );
  const propertyId = located[0]?.property_id;
  if (!propertyId) throw new AppError('listing not found', 'listing_not_found', 404);

  const { rows: open } = await client.query<PropertyAuthorityRecord>(
    `select id, org_id, property_id, authority_kind, statement, status, reviewer_note
     from property_authority
     where org_id = $1 and property_id = $2 and status in ('pending', 'verified')
     limit 1`,
    [input.orgId, propertyId],
  );
  if (open[0]) return open[0];

  const { rows } = await client.query<PropertyAuthorityRecord>(
    `insert into property_authority (
       org_id, property_id, submitted_by_party_id, authority_kind, statement
     ) values ($1, $2, $3, $4, $5)
     returning id, org_id, property_id, authority_kind, statement, status, reviewer_note`,
    [input.orgId, propertyId, input.partyId, input.authorityKind, input.statement],
  );
  const created = rows[0]!;
  await emitDomainEvent(client, {
    aggregateType: 'property_authority',
    aggregateId: created.id,
    eventType: 'property_authority.submitted',
    payload: {
      org_id: input.orgId,
      property_id: propertyId,
      listing_id: input.listingId,
      authority_kind: input.authorityKind,
    },
    actorPartyId: input.partyId,
    actorKind: 'user',
  });
  return created;
}

export type PendingPropertyAuthority = PropertyAuthorityRecord & {
  organization_name: string;
  line1: string | null;
};

export async function listPendingPropertyAuthorities(
  client: DbClient,
): Promise<PendingPropertyAuthority[]> {
  const { rows } = await client.query<PendingPropertyAuthority>(
    `select pa.id, pa.org_id, pa.property_id, pa.authority_kind, pa.statement, pa.status, pa.reviewer_note,
            o.display_name as organization_name,
            a.line1
     from property_authority pa
     join org o on o.id = pa.org_id
     join property p on p.id = pa.property_id
     join address a on a.id = p.address_id
     where pa.status = 'pending'
     order by pa.created_at asc`,
  );
  return rows;
}

export async function reviewPropertyAuthority(
  client: DbClient,
  input: {
    authorityId: string;
    decision: 'verified' | 'rejected';
    actorPartyId: string;
    note?: string | null;
  },
): Promise<PropertyAuthorityRecord> {
  const { rows: current } = await client.query<{ id: string; status: string }>(
    `select id, status from property_authority where id = $1 for update`,
    [input.authorityId],
  );
  if (!current[0]) throw new AppError('property authority not found', 'not_found', 404);
  if (current[0].status === input.decision) {
    const { rows: same } = await client.query<PropertyAuthorityRecord>(
      `select id, org_id, property_id, authority_kind, statement, status, reviewer_note
       from property_authority where id = $1`,
      [input.authorityId],
    );
    return same[0]!;
  }
  if (current[0].status === 'verified' && input.decision !== 'verified') {
    throw new AppError('verified property authority cannot be reopened here', 'invalid_transition', 409);
  }
  const { rows } = await client.query<PropertyAuthorityRecord>(
    `update property_authority
     set status = $2,
         reviewer_note = $3,
         reviewed_by_party_id = $4,
         reviewed_at = now(),
         updated_at = now()
     where id = $1
     returning id, org_id, property_id, authority_kind, statement, status, reviewer_note`,
    [input.authorityId, input.decision, input.note ?? null, input.actorPartyId],
  );
  const record = rows[0]!;
  await emitDomainEvent(client, {
    aggregateType: 'property_authority',
    aggregateId: record.id,
    eventType: 'property_authority.reviewed',
    payload: { status: record.status, org_id: record.org_id, property_id: record.property_id },
    actorPartyId: input.actorPartyId,
    actorKind: 'admin',
  });
  await appendAdminAction(client, {
    actorPartyId: input.actorPartyId,
    action: 'property_authority.review',
    targetType: 'property_authority',
    targetId: record.id,
    beforeState: { status: current[0].status },
    afterState: { status: record.status, note: input.note ?? null },
    reasonCode: input.decision,
  });
  return record;
}

export async function readApplicationReviewState(
  client: DbClient,
  applicationId: string,
): Promise<{
  application_id: string;
  status: string;
  record_kind: string;
  listing_line1: string | null;
}> {
  const { rows } = await client.query<{
    id: string;
    status: string;
    record_kind: string;
    listing_line1: string | null;
  }>(
    `select id, status, record_kind,
            intake_snapshot #>> '{listing,line1}' as listing_line1
     from application
     where id = $1`,
    [applicationId],
  );
  const row = rows[0];
  if (!row) throw new AppError('application not found', 'not_found', 404);
  return {
    application_id: row.id,
    status: row.status,
    record_kind: row.record_kind,
    listing_line1: row.listing_line1,
  };
}
