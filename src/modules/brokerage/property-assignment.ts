import type { DbClient } from '../../db/pool.js';
import { emitDomainEvent } from '../audit/index.js';
import { listListingApplicants, updateLandlordListing } from '../landlord/index.js';
import { setListingStatus } from '../listings/index.js';
import { AppError } from '../shared/errors.js';

export type PropertyAssignment = {
  id: string;
  broker_org_id: string;
  provider_org_id: string;
  property_id: string;
  listing_id: string | null;
  status: string;
  line1: string | null;
};

async function listingProperty(
  client: DbClient,
  listingId: string,
  providerOrgId: string,
): Promise<{ propertyId: string; line1: string | null }> {
  const { rows } = await client.query<{ property_id: string; line1: string | null }>(
    `select u.property_id, coalesce(nullif(btrim(a.line1), ''), a.raw_input) as line1
     from listing l
     join unit u on u.id = l.unit_id
     join property p on p.id = u.property_id
     join address a on a.id = p.address_id
     where l.id = $1 and l.org_id = $2`,
    [listingId, providerOrgId],
  );
  const row = rows[0];
  if (!row) throw new AppError('listing not found', 'listing_not_found', 404);
  return { propertyId: row.property_id, line1: row.line1 };
}

export async function grantPropertyBrokerAssignment(
  client: DbClient,
  input: { providerOrgId: string; listingId: string; brokerOrgId: string; actorPartyId: string },
): Promise<PropertyAssignment> {
  const located = await listingProperty(client, input.listingId, input.providerOrgId);
  const { rows: broker } = await client.query<{ id: string }>(
    `select o.id
     from org o
     where o.id = $1
       and o.kind = 'brokerage'
       and o.status = 'active'
       and exists (
         select 1 from party_role pr
         where pr.org_id = o.id
           and pr.role = 'broker'
           and pr.revoked_at is null
           and pr.status = 'active'
       )`,
    [input.brokerOrgId],
  );
  if (!broker[0]) {
    throw new AppError('broker organization is not active', 'broker_not_authorized', 403);
  }
  const { rows: existing } = await client.query<{ id: string }>(
    `select id from property_broker_assignment
     where broker_org_id = $1 and property_id = $2 and status = 'active'
     limit 1`,
    [input.brokerOrgId, located.propertyId],
  );
  if (existing[0]) {
    return {
      id: existing[0].id,
      broker_org_id: input.brokerOrgId,
      provider_org_id: input.providerOrgId,
      property_id: located.propertyId,
      listing_id: input.listingId,
      status: 'active',
      line1: located.line1,
    };
  }
  const { rows } = await client.query<{ id: string }>(
    `insert into property_broker_assignment (
       broker_org_id, provider_org_id, property_id, granted_by_party_id
     ) values ($1, $2, $3, $4)
     returning id`,
    [input.brokerOrgId, input.providerOrgId, located.propertyId, input.actorPartyId],
  );
  await emitDomainEvent(client, {
    aggregateType: 'property_broker_assignment',
    aggregateId: rows[0]!.id,
    eventType: 'property_broker_assignment.granted',
    payload: {
      broker_org_id: input.brokerOrgId,
      provider_org_id: input.providerOrgId,
      property_id: located.propertyId,
      listing_id: input.listingId,
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });
  return {
    id: rows[0]!.id,
    broker_org_id: input.brokerOrgId,
    provider_org_id: input.providerOrgId,
    property_id: located.propertyId,
    listing_id: input.listingId,
    status: 'active',
    line1: located.line1,
  };
}

export async function revokePropertyBrokerAssignment(
  client: DbClient,
  input: { providerOrgId: string; assignmentId: string; actorPartyId: string },
): Promise<{ id: string; status: string }> {
  const { rows } = await client.query<{ id: string; broker_org_id: string; property_id: string }>(
    `update property_broker_assignment
     set status = 'revoked', revoked_at = now(), revoked_by_party_id = $3
     where id = $1 and provider_org_id = $2 and status = 'active'
     returning id, broker_org_id, property_id`,
    [input.assignmentId, input.providerOrgId, input.actorPartyId],
  );
  const row = rows[0];
  if (!row) throw new AppError('assignment not found', 'assignment_not_found', 404);
  await emitDomainEvent(client, {
    aggregateType: 'property_broker_assignment',
    aggregateId: row.id,
    eventType: 'property_broker_assignment.revoked',
    payload: {
      broker_org_id: row.broker_org_id,
      provider_org_id: input.providerOrgId,
      property_id: row.property_id,
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });
  return { id: row.id, status: 'revoked' };
}

async function assignedListing(
  client: DbClient,
  brokerOrgId: string,
  listingId: string,
): Promise<{ providerOrgId: string }> {
  const { rows } = await client.query<{ provider_org_id: string }>(
    `select pba.provider_org_id
     from listing l
     join unit u on u.id = l.unit_id
     join property_broker_assignment pba
       on pba.property_id = u.property_id
      and pba.provider_org_id = l.org_id
     where l.id = $1
       and pba.broker_org_id = $2
       and pba.status = 'active'
       and pba.revoked_at is null
     limit 1`,
    [listingId, brokerOrgId],
  );
  const row = rows[0];
  if (!row) throw new AppError('listing not found', 'listing_not_found', 404);
  return { providerOrgId: row.provider_org_id };
}

export async function listBrokerPropertyAssignments(
  client: DbClient,
  brokerOrgId: string,
): Promise<PropertyAssignment[]> {
  const { rows } = await client.query<{
    id: string;
    broker_org_id: string;
    provider_org_id: string;
    property_id: string;
    listing_id: string | null;
    status: string;
    line1: string | null;
  }>(
    `select pba.id, pba.broker_org_id, pba.provider_org_id, pba.property_id, pba.status,
            l.id as listing_id,
            coalesce(nullif(btrim(a.line1), ''), a.raw_input) as line1
     from property_broker_assignment pba
     join property p on p.id = pba.property_id
     join address a on a.id = p.address_id
     left join unit u on u.property_id = p.id
     left join listing l on l.unit_id = u.id and l.org_id = pba.provider_org_id
     where pba.broker_org_id = $1 and pba.status = 'active' and pba.revoked_at is null
     order by pba.created_at desc`,
    [brokerOrgId],
  );
  return rows;
}

export async function updateAssignedListing(
  client: DbClient,
  input: {
    brokerOrgId: string;
    listingId: string;
    actorPartyId: string;
    rentAmountCents?: number;
    status?: 'draft' | 'active' | 'paused' | 'rented';
  },
): Promise<{ id: string; status: string }> {
  const assigned = await assignedListing(client, input.brokerOrgId, input.listingId);
  if (input.status) {
    return setListingStatus(client, {
      listingId: input.listingId,
      orgId: assigned.providerOrgId,
      status: input.status,
      actorPartyId: input.actorPartyId,
    });
  }
  return updateLandlordListing(client, {
    listingId: input.listingId,
    orgId: assigned.providerOrgId,
    rentAmountCents: input.rentAmountCents,
    actorPartyId: input.actorPartyId,
  });
}

export async function listAssignedApplicants(
  client: DbClient,
  input: { brokerOrgId: string; listingId: string },
) {
  const assigned = await assignedListing(client, input.brokerOrgId, input.listingId);
  return listListingApplicants(client, {
    listingId: input.listingId,
    orgId: assigned.providerOrgId,
  });
}
