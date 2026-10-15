/**
 * Broker portfolio — delegated Home Provider orgs via broker_provider_delegation
 * (with legacy managed_by_broker_org_id fallback).
 * Broker never sees providers outside explicit delegation.
 */
import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';
import { getObjectStore } from '../../infra/object-store/index.js';
import { assertDelegatedAccess } from './delegation.js';

export async function assertProviderDelegated(
  client: DbClient,
  brokerOrgId: string,
  providerOrgId: string,
): Promise<void> {
  await assertDelegatedAccess(client, brokerOrgId, providerOrgId);
}

export async function listManagedProviders(
  client: DbClient,
  brokerOrgId: string,
): Promise<
  Array<{
    org_id: string;
    display_name: string;
    legal_name: string;
    status: string;
    active_listings: number;
    open_applications: number;
    screenings: number;
  }>
> {
  const { rows } = await client.query<{
    org_id: string;
    display_name: string;
    legal_name: string;
    status: string;
    active_listings: string;
    open_applications: string;
    screenings: string;
  }>(
    `select
       o.id as org_id,
       o.display_name,
       o.legal_name,
       o.status,
       (select count(*)::text from listing l
         where l.org_id = o.id and l.status = 'active') as active_listings,
       (select count(*)::text from application a
         join listing l on l.id = a.listing_id
         where l.org_id = o.id
           and a.status not in ('approved','declined','withdrawn','closed')) as open_applications,
       (select count(*)::text from application a
         join listing l on l.id = a.listing_id
         where l.org_id = o.id
           and a.status in (
             'awaiting_consent','screening_authorized','screening_running',
             'screened','screening_complete','awaiting_provider_configuration'
           )) as screenings
     from org o
     where o.managed_by_broker_org_id = $1
       and o.kind = 'landlord'
     order by o.display_name asc`,
    [brokerOrgId],
  );
  return rows.map((r) => ({
    org_id: r.org_id,
    display_name: r.display_name,
    legal_name: r.legal_name,
    status: r.status,
    active_listings: Number(r.active_listings),
    open_applications: Number(r.open_applications),
    screenings: Number(r.screenings),
  }));
}

export async function getManagedProviderDetail(
  client: DbClient,
  brokerOrgId: string,
  providerOrgId: string,
): Promise<{
  org_id: string;
  display_name: string;
  legal_name: string;
  status: string;
  active_listings: number;
  open_applications: number;
  screenings: number;
}> {
  await assertProviderDelegated(client, brokerOrgId, providerOrgId);
  const all = await listManagedProviders(client, brokerOrgId);
  const row = all.find((p) => p.org_id === providerOrgId);
  if (!row) {
    throw new AppError('provider not found', 'broker_provider_not_found', 404);
  }
  return row;
}

export async function listManagedListings(
  client: DbClient,
  brokerOrgId: string,
  providerOrgId?: string | null,
): Promise<
  Array<{
    id: string;
    org_id: string;
    provider_name: string;
    status: string;
    rent_amount_cents: number;
    line1: string | null;
    city: string | null;
    state: string | null;
    bedrooms: number | null;
    bathrooms: number | null;
    applicant_count: number;
    screening_count: number;
    photo_url: string | null;
  }>
> {
  const params: unknown[] = [brokerOrgId];
  let providerFilter = '';
  if (providerOrgId) {
    await assertProviderDelegated(client, brokerOrgId, providerOrgId);
    params.push(providerOrgId);
    providerFilter = ` and o.id = $${params.length}`;
  }

  const { rows } = await client.query<{
    id: string;
    org_id: string;
    provider_name: string;
    status: string;
    rent_amount_cents: number;
    line1: string | null;
    city: string | null;
    state: string | null;
    bedrooms: string | null;
    bathrooms: string | null;
    applicant_count: string;
    screening_count: string;
    photo_url_raw: string | null;
    photo_storage_key: string | null;
  }>(
    `select
       l.id, l.org_id, o.display_name as provider_name, l.status, l.rent_amount_cents,
       a.line1, a.city, a.state,
       u.bedrooms::text, u.bathrooms::text,
       (select count(*)::text from application ap where ap.listing_id = l.id) as applicant_count,
       (select count(*)::text from application ap
         where ap.listing_id = l.id
           and ap.status in (
             'awaiting_consent','screening_authorized','screening_running',
             'screened','screening_complete','awaiting_provider_configuration'
           )) as screening_count,
       (select m.url from listing_media m where m.listing_id = l.id order by m.position asc limit 1) as photo_url_raw,
       (select m.storage_key from listing_media m where m.listing_id = l.id order by m.position asc limit 1) as photo_storage_key
     from listing l
     join org o on o.id = l.org_id
     join unit u on u.id = l.unit_id
     join property p on p.id = u.property_id
     join address a on a.id = p.address_id
     where o.managed_by_broker_org_id = $1
       and o.kind = 'landlord'
       ${providerFilter}
     order by l.created_at desc`,
    params,
  );

  const store = getObjectStore();
  const out = [];
  for (const r of rows) {
    let photoUrl = r.photo_url_raw;
    if (!photoUrl && r.photo_storage_key) {
      try {
        const signed = await store.signGetUrl(r.photo_storage_key, { expiresInSeconds: 300 });
        photoUrl = signed.url;
      } catch {
        photoUrl = null;
      }
    }
    out.push({
      id: r.id,
      org_id: r.org_id,
      provider_name: r.provider_name,
      status: r.status,
      rent_amount_cents: r.rent_amount_cents,
      line1: r.line1,
      city: r.city,
      state: r.state,
      bedrooms: r.bedrooms != null ? Number(r.bedrooms) : null,
      bathrooms: r.bathrooms != null ? Number(r.bathrooms) : null,
      applicant_count: Number(r.applicant_count),
      screening_count: Number(r.screening_count),
      photo_url: photoUrl,
    });
  }
  return out;
}

export async function listManagedApplicants(
  client: DbClient,
  brokerOrgId: string,
  providerOrgId?: string | null,
): Promise<
  Array<{
    application_id: string;
    listing_id: string;
    org_id: string;
    provider_name: string;
    listing_label: string;
    status: string;
    created_at: string;
    renter_label: string;
    screening_status: string;
  }>
> {
  const params: unknown[] = [brokerOrgId];
  let providerFilter = '';
  if (providerOrgId) {
    await assertProviderDelegated(client, brokerOrgId, providerOrgId);
    params.push(providerOrgId);
    providerFilter = ` and o.id = $${params.length}`;
  }

  const { rows } = await client.query<{
    application_id: string;
    listing_id: string;
    org_id: string;
    provider_name: string;
    listing_label: string;
    status: string;
    created_at: Date;
    given_name: string | null;
    family_name: string | null;
  }>(
    `select
       ap.id as application_id,
       ap.listing_id,
       o.id as org_id,
       o.display_name as provider_name,
       coalesce(addr.line1, addr.city, ap.listing_id::text) as listing_label,
       ap.status,
       ap.created_at,
       rp.given_name,
       rp.family_name
     from application ap
     join listing l on l.id = ap.listing_id
     join org o on o.id = l.org_id
     join unit u on u.id = l.unit_id
     join property p on p.id = u.property_id
     join address addr on addr.id = p.address_id
     left join renter_profile rp on rp.id = ap.renter_profile_id
     where o.managed_by_broker_org_id = $1
       and o.kind = 'landlord'
       ${providerFilter}
     order by ap.created_at desc
     limit 200`,
    params,
  );

  return rows.map((r) => {
    const name = [r.given_name, r.family_name?.slice(0, 1)].filter(Boolean).join(' ').trim();
    const screeningStatuses = new Set([
      'awaiting_consent',
      'screening_authorized',
      'screening_running',
      'screened',
      'screening_complete',
      'awaiting_provider_configuration',
    ]);
    return {
      application_id: r.application_id,
      listing_id: r.listing_id,
      org_id: r.org_id,
      provider_name: r.provider_name,
      listing_label: r.listing_label,
      status: r.status,
      created_at: r.created_at.toISOString(),
      renter_label: name || 'Renter',
      screening_status: screeningStatuses.has(r.status) ? r.status : 'none',
    };
  });
}

export async function getBrokerPortfolioOverview(
  client: DbClient,
  brokerOrgId: string,
): Promise<{
  managed_providers: number;
  listings: number;
  open_applicants: number;
  screenings: number;
  needs_attention: Array<{
    id: string;
    kind: string;
    label: string;
    href: string;
  }>;
}> {
  const providers = await listManagedProviders(client, brokerOrgId);
  const listings = await listManagedListings(client, brokerOrgId);
  const applicants = await listManagedApplicants(client, brokerOrgId);

  const openApplicants = applicants.filter(
    (a) => !['approved', 'declined', 'withdrawn', 'closed'].includes(a.status),
  ).length;
  const screenings = applicants.filter((a) => a.screening_status !== 'none').length;

  const needs_attention: Array<{ id: string; kind: string; label: string; href: string }> = [];
  for (const a of applicants) {
    if (a.status === 'awaiting_landlord_interest' || a.status === 'draft') {
      needs_attention.push({
        id: a.application_id,
        kind: 'request_screening',
        label: `${a.renter_label} waiting for screening request · ${a.listing_label}`,
        href: `/broker/applicants`,
      });
    } else if (a.status === 'screened' || a.status === 'screening_complete') {
      needs_attention.push({
        id: a.application_id,
        kind: 'ready_for_review',
        label: `Screening complete / ready for review · ${a.renter_label}`,
        href: `/broker/applicants`,
      });
    } else if (a.status === 'screening_authorized') {
      needs_attention.push({
        id: a.application_id,
        kind: 'submit_screening',
        label: `Consent recorded — screening not submitted · ${a.listing_label}`,
        href: `/broker/applicants`,
      });
    }
  }

  return {
    managed_providers: providers.length,
    listings: listings.filter((l) => l.status === 'active').length,
    open_applicants: openApplicants,
    screenings,
    needs_attention: needs_attention.slice(0, 20),
  };
}
