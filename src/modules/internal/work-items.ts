/**
 * Control Center WorkItem projections over real Dwel tables.
 * No invented cash-back / listing APIs.
 */

import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';
import { listSelfExecutionReviews } from '../admin/ops.js';

export type WorkItemState =
  | 'new'
  | 'needs_review'
  | 'waiting'
  | 'ready'
  | 'blocked'
  | 'done';

export type WorkItem = {
  id: string;
  product: 'dwel';
  sourceId: string;
  kind: string;
  displayName: string | null;
  summary: string | null;
  state: WorkItemState;
  sourceStatus: string;
  createdAt: string;
  updatedAt: string;
  requiresAttention: boolean;
  version: string;
  regionLabel: string | null;
  metaLabel: string | null;
};

function iso(value: Date | string | null | undefined): string {
  if (value == null) return new Date(0).toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

export function mapApplicationStatusToWorkState(status: string): WorkItemState {
  switch (status) {
    case 'draft':
      return 'new';
    case 'awaiting_consent':
    case 'submitted':
      return 'needs_review';
    case 'awaiting_landlord_interest':
    case 'prescreen':
    case 'screening_authorized':
    case 'screening_running':
      return 'waiting';
    case 'screened':
    case 'decisioned':
      return 'ready';
    case 'prescreen_failed':
      return 'blocked';
    case 'approved':
    case 'declined':
    case 'withdrawn':
    case 'closed':
      return 'done';
    default:
      return 'needs_review';
  }
}

function applicationRequiresAttention(status: string): boolean {
  return [
    'draft',
    'awaiting_consent',
    'submitted',
    'awaiting_landlord_interest',
    'prescreen_failed',
  ].includes(status);
}

function mapSelfExecutionStatusToWorkState(status: string): WorkItemState {
  switch (status) {
    case 'pending':
      return 'needs_review';
    case 'verified':
      return 'done';
    case 'rejected':
      return 'blocked';
    default:
      return 'needs_review';
  }
}

type ApplicationListRow = {
  id: string;
  status: string;
  created_at: Date;
  submitted_at: Date | null;
  screened_at: Date | null;
  closed_at: Date | null;
  entry_point: string;
  source_channel: string | null;
  listing_id: string | null;
  org_id: string;
  given_name: string | null;
  family_name: string | null;
  email: string | null;
  preferred_state: string | null;
  badge_state: string | null;
  listing_city: string | null;
  listing_state: string | null;
  org_display_name: string | null;
  email_ref: string | null;
};

function displayNameFromRow(row: ApplicationListRow): string | null {
  const name = [row.given_name, row.family_name].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (row.email?.trim()) return row.email.trim();
  if (row.email_ref?.trim()) return row.email_ref.trim();
  return null;
}

function regionFromRow(row: ApplicationListRow): string | null {
  const listingRegion = [row.listing_city, row.listing_state].filter(Boolean).join(', ');
  if (listingRegion) return listingRegion;
  return row.preferred_state ?? null;
}

function updatedAtFromRow(row: ApplicationListRow): Date {
  const candidates = [row.closed_at, row.screened_at, row.submitted_at, row.created_at].filter(
    (d): d is Date => d != null,
  );
  return candidates.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
}

function toApplicationWorkItem(row: ApplicationListRow): WorkItem {
  const sourceStatus = row.status;
  const updated = updatedAtFromRow(row);
  const regionLabel = regionFromRow(row);
  const summaryParts = [
    regionLabel,
    row.entry_point,
    row.source_channel,
    row.badge_state ? `badge:${row.badge_state}` : null,
  ].filter(Boolean);

  return {
    id: `dwel:${row.id}`,
    product: 'dwel',
    sourceId: row.id,
    kind: 'application',
    displayName: displayNameFromRow(row),
    summary: summaryParts.join(' · ') || null,
    state: mapApplicationStatusToWorkState(sourceStatus),
    sourceStatus,
    createdAt: iso(row.created_at),
    updatedAt: iso(updated),
    requiresAttention: applicationRequiresAttention(sourceStatus),
    version: iso(updated),
    regionLabel,
    metaLabel: row.org_display_name ?? null,
  };
}

const APPLICATION_LIST_FROM = `
  from application a
  join renter_profile rp on rp.id = a.renter_profile_id
  join org o on o.id = a.org_id
  left join listing l on l.id = a.listing_id
  left join unit u on u.id = coalesce(a.unit_id, l.unit_id)
  left join property p on p.id = u.property_id
  left join address addr on addr.id = p.address_id
`;

const APPLICATION_LIST_SELECT = `
  select
    a.id,
    a.status,
    a.created_at,
    a.submitted_at,
    a.screened_at,
    a.closed_at,
    a.entry_point,
    a.source_channel,
    a.listing_id,
    a.org_id,
    rp.given_name,
    rp.family_name,
    rp.email,
    rp.preferred_state,
    rp.badge_state,
    addr.city as listing_city,
    addr.state as listing_state,
    o.display_name as org_display_name,
    (select e.vendor_subject_id from external_identity_ref e
     where e.party_id = a.party_id and e.vendor = 'email'
     order by e.first_seen_at desc limit 1) as email_ref
  ${APPLICATION_LIST_FROM}
`;

export async function listApplicationWorkItems(
  client: DbClient,
  input: { limit?: number; cursor?: string | null; q?: string | null },
): Promise<{ items: WorkItem[]; nextCursor: string | null; sourceHealth: 'ok' }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const params: unknown[] = [];
  let where = 'true';

  if (input.cursor?.trim()) {
    params.push(input.cursor.trim());
    where += ` and a.created_at < $${params.length}::timestamptz`;
  }

  if (input.q?.trim()) {
    params.push(`%${input.q.trim().toLowerCase()}%`);
    const i = params.length;
    where += ` and (
      a.id::text ilike $${i}
      or lower(coalesce(rp.given_name, '')) like $${i}
      or lower(coalesce(rp.family_name, '')) like $${i}
      or lower(coalesce(rp.email, '')) like $${i}
      or lower(coalesce(o.display_name, '')) like $${i}
      or lower(coalesce(addr.city, '')) like $${i}
      or lower(coalesce(addr.state, '')) like $${i}
      or exists (
        select 1 from external_identity_ref e
        where e.party_id = a.party_id
          and e.vendor = 'email'
          and lower(e.vendor_subject_id) like $${i}
      )
    )`;
  }

  params.push(limit);
  const { rows } = await client.query<ApplicationListRow>(
    `${APPLICATION_LIST_SELECT}
     where ${where}
     order by a.created_at desc
     limit $${params.length}`,
    params,
  );

  const items = rows.map(toApplicationWorkItem);
  const nextCursor =
    items.length === limit ? iso(rows[rows.length - 1]!.created_at) : null;

  return { items, nextCursor, sourceHealth: 'ok' };
}

export async function getApplicationWorkItemDetail(
  client: DbClient,
  applicationId: string,
): Promise<{
  item: WorkItem;
  application: Record<string, unknown>;
  renterProfile: Record<string, unknown> | null;
  intakeLive: Record<string, unknown> | null;
  intakeSnapshot: unknown;
}> {
  const { rows } = await client.query<ApplicationListRow & {
    party_id: string;
    renter_profile_id: string;
    unit_id: string | null;
    landlord_interest_id: string | null;
    screening_authorized_at: Date | null;
    expires_at: Date | null;
    device_id: string | null;
    intake_snapshot: unknown;
    contact_revealed_at: Date | null;
    match_score_value: number | null;
    phone_e164: string | null;
    rent_max_cents: number | null;
    household_size: number | null;
    has_pets: boolean | null;
    annual_income_cents: number | null;
    move_in_urgency: string | null;
  }>(
    `select
       a.id,
       a.status,
       a.created_at,
       a.submitted_at,
       a.screened_at,
       a.closed_at,
       a.entry_point,
       a.source_channel,
       a.listing_id,
       a.org_id,
       a.party_id,
       a.renter_profile_id,
       a.unit_id,
       a.landlord_interest_id,
       a.screening_authorized_at,
       a.expires_at,
       a.device_id,
       a.intake_snapshot,
       a.contact_revealed_at,
       a.match_score_value,
       rp.given_name,
       rp.family_name,
       rp.email,
       rp.phone_e164,
       rp.preferred_state,
       rp.badge_state,
       rp.rent_max_cents,
       rp.household_size,
       rp.has_pets,
       rp.annual_income_cents,
       rp.move_in_urgency,
       addr.city as listing_city,
       addr.state as listing_state,
       o.display_name as org_display_name,
       (select e.vendor_subject_id from external_identity_ref e
        where e.party_id = a.party_id and e.vendor = 'email'
        order by e.first_seen_at desc limit 1) as email_ref
     ${APPLICATION_LIST_FROM}
     where a.id = $1`,
    [applicationId],
  );

  const row = rows[0];
  if (!row) throw new AppError('application not found', 'not_found', 404);

  const { rows: intakeRows } = await client.query(
    `select * from renter_application_intake where party_id = $1`,
    [row.party_id],
  );

  return {
    item: toApplicationWorkItem(row),
    application: {
      id: row.id,
      party_id: row.party_id,
      renter_profile_id: row.renter_profile_id,
      listing_id: row.listing_id,
      unit_id: row.unit_id,
      org_id: row.org_id,
      entry_point: row.entry_point,
      landlord_interest_id: row.landlord_interest_id,
      status: row.status,
      submitted_at: row.submitted_at ? iso(row.submitted_at) : null,
      screening_authorized_at: row.screening_authorized_at
        ? iso(row.screening_authorized_at)
        : null,
      screened_at: row.screened_at ? iso(row.screened_at) : null,
      closed_at: row.closed_at ? iso(row.closed_at) : null,
      expires_at: row.expires_at ? iso(row.expires_at) : null,
      source_channel: row.source_channel,
      device_id: row.device_id,
      contact_revealed_at: row.contact_revealed_at ? iso(row.contact_revealed_at) : null,
      match_score_value: row.match_score_value,
      created_at: iso(row.created_at),
    },
    renterProfile: {
      given_name: row.given_name,
      family_name: row.family_name,
      email: row.email,
      phone_e164: row.phone_e164,
      preferred_state: row.preferred_state,
      badge_state: row.badge_state,
      rent_max_cents: row.rent_max_cents,
      household_size: row.household_size,
      has_pets: row.has_pets,
      annual_income_cents: row.annual_income_cents,
      move_in_urgency: row.move_in_urgency,
    },
    intakeLive: (intakeRows[0] as Record<string, unknown> | undefined) ?? null,
    intakeSnapshot: row.intake_snapshot ?? null,
  };
}

/** Intake snapshot fields only — frozen `intake_snapshot` plus live dossier columns when present. */
export async function getApplicationIntakeSnapshot(
  client: DbClient,
  applicationId: string,
): Promise<{
  applicationId: string;
  status: string;
  snapshot: unknown;
  snapshotIsFrozen: boolean;
  liveIntake: Record<string, unknown> | null;
}> {
  const { rows } = await client.query<{
    id: string;
    status: string;
    party_id: string;
    intake_snapshot: unknown;
  }>(
    `select id, status, party_id, intake_snapshot from application where id = $1`,
    [applicationId],
  );
  const row = rows[0];
  if (!row) throw new AppError('application not found', 'not_found', 404);

  const { rows: intakeRows } = await client.query(
    `select
       party_id,
       current_address_line1,
       current_address_city,
       current_address_state,
       current_address_postal,
       current_address_move_in,
       employer_name,
       job_title,
       employer_phone,
       employment_length_months,
       monthly_gross_income_cents,
       occupants,
       pets,
       emergency_contact,
       vehicle,
       completed_at,
       updated_at
     from renter_application_intake
     where party_id = $1`,
    [row.party_id],
  );

  return {
    applicationId: row.id,
    status: row.status,
    snapshot: row.intake_snapshot ?? null,
    snapshotIsFrozen: row.intake_snapshot != null,
    liveIntake: (intakeRows[0] as Record<string, unknown> | undefined) ?? null,
  };
}

export async function listPartnerReviewWorkItems(
  client: DbClient,
  input: { status?: string | null; limit?: number; offset?: number },
): Promise<{ items: WorkItem[]; total: number; sourceHealth: 'ok' }> {
  const result = await listSelfExecutionReviews(client, {
    status: input.status ?? 'pending',
    limit: input.limit,
    offset: input.offset,
  });

  const items: WorkItem[] = (result.items as Array<Record<string, unknown>>).map((row) => {
    const sourceStatus = String(row.status ?? 'pending');
    const createdAt = iso(row.created_at as Date | string);
    const updatedAt = row.reviewed_at ? iso(row.reviewed_at as Date | string) : createdAt;
    const licenseState = row.license_state ? String(row.license_state) : null;
    const displayName =
      (row.business_entity_name ? String(row.business_entity_name) : null) ??
      (row.license_number ? `License ${String(row.license_number)}` : null);

    return {
      id: `dwel:partner-review:${row.id}`,
      product: 'dwel',
      sourceId: String(row.id),
      kind: 'partner_review',
      displayName,
      summary: [
        licenseState,
        row.license_type ? String(row.license_type) : null,
        'self-execution',
      ]
        .filter(Boolean)
        .join(' · '),
      state: mapSelfExecutionStatusToWorkState(sourceStatus),
      sourceStatus,
      createdAt,
      updatedAt,
      requiresAttention: sourceStatus === 'pending',
      version: updatedAt,
      regionLabel: licenseState,
      metaLabel: row.compliance_tag ? String(row.compliance_tag) : 'interim_v1',
    };
  });

  return { items, total: result.total, sourceHealth: 'ok' };
}

export async function pingDb(client: DbClient): Promise<void> {
  await client.query('select 1');
}
