/**
 * Read-only Control Center directory surfaces for brokers and listings.
 * Staff listing CRUD is intentionally out of scope.
 */

import type { DbClient } from '../../db/pool.js';

export type CcBroker = {
  sourceBrokerId: string;
  displayName: string | null;
  legalName: string | null;
  licenseState: string;
  licenseNumber: string | null;
  licenseVerifiedAt: string | null;
  licenseExpiresAt: string | null;
  status: string;
  supervisingBrokerOrgId: string | null;
  delegatedHomeProviders: Array<{
    orgId: string;
    displayName: string | null;
    status: string | null;
  }>;
  invitations: Array<{
    id: string;
    contactEmail: string;
    businessName: string | null;
    status: string;
    createdAt: string;
    acceptedAt: string | null;
  }>;
  permissionsNote: string;
  readOnly: true;
  allowed_actions: string[];
};

export type CcListing = {
  sourceListingId: string;
  status: string;
  origin: string;
  rentAmountCents: number;
  orgId: string;
  landlordDisplayName: string | null;
  brokerOrgId: string | null;
  brokerDisplayName: string | null;
  regionLabel: string | null;
  reviewState: string;
  publishedAt: string | null;
  updatedAt: string;
  readOnly: true;
  allowed_actions: string[];
};

export async function listBrokers(
  client: DbClient,
  opts?: { limit?: number; q?: string | null },
): Promise<{ items: CcBroker[]; sourceHealth: 'ok' }> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
  const { rows } = await client.query<{
    org_id: string;
    display_name: string | null;
    legal_name: string | null;
    license_state: string;
    license_number: string | null;
    license_verified_at: Date | string | null;
    license_expires_at: Date | string | null;
    status: string;
    managed_by_broker_org_id: string | null;
  }>(
    `select b.org_id, o.display_name, o.legal_name, b.license_state, b.license_number,
            b.license_verified_at, b.license_expires_at, b.status,
            o.managed_by_broker_org_id
     from broker_profile b
     join org o on o.id = b.org_id
     order by o.display_name nulls last, b.org_id
     limit $1`,
    [limit],
  );

  const items: CcBroker[] = [];
  for (const row of rows) {
    if (opts?.q?.trim()) {
      const q = opts.q.trim().toLowerCase();
      const hay = `${row.display_name ?? ''} ${row.legal_name ?? ''} ${row.license_number ?? ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }

    const providers = await client.query<{
      id: string;
      display_name: string | null;
      status: string | null;
    }>(
      `select id, display_name, status from org
       where managed_by_broker_org_id = $1
       order by display_name nulls last
       limit 50`,
      [row.org_id],
    );

    const invites = await client.query<{
      id: string;
      contact_email: string;
      business_name: string | null;
      status: string;
      created_at: Date | string;
      accepted_at: Date | string | null;
    }>(
      `select id, contact_email, business_name, status, created_at, accepted_at
       from broker_provider_invitation
       where broker_org_id = $1
       order by created_at desc
       limit 20`,
      [row.org_id],
    );

    items.push({
      sourceBrokerId: row.org_id,
      displayName: row.display_name,
      legalName: row.legal_name,
      licenseState: row.license_state,
      licenseNumber: row.license_number,
      licenseVerifiedAt: row.license_verified_at
        ? new Date(row.license_verified_at).toISOString()
        : null,
      licenseExpiresAt: row.license_expires_at
        ? String(row.license_expires_at).slice(0, 10)
        : null,
      status: row.status,
      supervisingBrokerOrgId: row.managed_by_broker_org_id,
      delegatedHomeProviders: providers.rows.map((p) => ({
        orgId: p.id,
        displayName: p.display_name,
        status: p.status,
      })),
      invitations: invites.rows.map((i) => ({
        id: i.id,
        contactEmail: i.contact_email,
        businessName: i.business_name,
        status: i.status,
        createdAt: new Date(i.created_at).toISOString(),
        acceptedAt: i.accepted_at ? new Date(i.accepted_at).toISOString() : null,
      })),
      permissionsNote:
        'Broker commission workflow is not enabled. Control Center surface is read-only.',
      readOnly: true,
      allowed_actions: [],
    });
  }

  return { items, sourceHealth: 'ok' };
}

export async function listListings(
  client: DbClient,
  opts?: { limit?: number; q?: string | null; status?: string | null },
): Promise<{ items: CcListing[]; sourceHealth: 'ok' }> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
  const status = opts?.status?.trim() || null;
  const { rows } = await client.query<{
    id: string;
    status: string;
    origin: string;
    rent_amount_cents: number;
    org_id: string;
    landlord_name: string | null;
    broker_org_id: string | null;
    broker_name: string | null;
    city: string | null;
    state: string | null;
    published_at: Date | string | null;
    last_confirmed_at: Date | string;
  }>(
    `select l.id, l.status, l.origin, l.rent_amount_cents, l.org_id,
            o.display_name as landlord_name,
            o.managed_by_broker_org_id as broker_org_id,
            bo.display_name as broker_name,
            a.city, a.state,
            l.published_at, l.last_confirmed_at
     from listing l
     join org o on o.id = l.org_id
     left join org bo on bo.id = o.managed_by_broker_org_id
     left join unit u on u.id = l.unit_id
     left join property p on p.id = u.property_id
     left join address a on a.id = p.address_id
     where ($1::text is null or l.status = $1)
     order by l.last_confirmed_at desc
     limit $2`,
    [status, limit],
  );

  const items: CcListing[] = [];
  for (const row of rows) {
    const region = [row.city, row.state].filter(Boolean).join(', ') || null;
    if (opts?.q?.trim()) {
      const q = opts.q.trim().toLowerCase();
      const hay = `${row.landlord_name ?? ''} ${row.broker_name ?? ''} ${region ?? ''} ${row.id}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    items.push({
      sourceListingId: row.id,
      status: row.status,
      origin: row.origin,
      rentAmountCents: row.rent_amount_cents,
      orgId: row.org_id,
      landlordDisplayName: row.landlord_name,
      brokerOrgId: row.broker_org_id,
      brokerDisplayName: row.broker_name,
      regionLabel: region,
      reviewState: row.status,
      publishedAt: row.published_at
        ? new Date(row.published_at).toISOString()
        : null,
      updatedAt: new Date(row.last_confirmed_at).toISOString(),
      readOnly: true,
      // Listing approve/decline is not exposed on Dwel /internal/v1 staff surface.
      allowed_actions: [],
    });
  }

  return { items, sourceHealth: 'ok' };
}
