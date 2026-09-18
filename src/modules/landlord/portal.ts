import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { getObjectStore } from '../../infra/object-store/index.js';
import { emitDomainEvent } from '../audit/index.js';
import { AppError } from '../shared/errors.js';

export type ScreeningMode = 'auto_screen' | 'manual_review';

export async function getLandlordSettings(
  client: DbClient,
  orgId: string,
): Promise<{ screening_mode: ScreeningMode }> {
  const { rows } = await client.query<{ screening_mode: ScreeningMode }>(
    `select screening_mode from org where id = $1`,
    [orgId],
  );
  if (!rows[0]) throw new AppError('org not found', 'org_not_found', 404);
  return { screening_mode: rows[0].screening_mode };
}

export async function updateLandlordSettings(
  client: DbClient,
  input: { orgId: string; screeningMode: ScreeningMode; actorPartyId: string },
): Promise<{ screening_mode: ScreeningMode }> {
  const { rows } = await client.query<{ screening_mode: ScreeningMode }>(
    `update org set screening_mode = $2 where id = $1 returning screening_mode`,
    [input.orgId, input.screeningMode],
  );
  if (!rows[0]) throw new AppError('org not found', 'org_not_found', 404);
  await emitDomainEvent(client, {
    aggregateType: 'org',
    aggregateId: input.orgId,
    eventType: 'org.screening_mode_updated',
    payload: { screening_mode: input.screeningMode },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });
  return { screening_mode: rows[0].screening_mode };
}

function incomeBand(cents: number | null): string {
  if (cents == null) return 'undisclosed';
  if (cents < 4_000_000) return 'under_40k';
  if (cents < 7_500_000) return '40k_75k';
  if (cents < 12_000_000) return '75k_120k';
  if (cents < 20_000_000) return '120k_200k';
  return '200k_plus';
}

function scoreBand(score: number | null): string {
  if (score == null) return 'unscored';
  if (score >= 85) return 'strong';
  if (score >= 70) return 'good';
  if (score >= 55) return 'fair';
  return 'needs_review';
}

export type ApplicantListItem = {
  application_id: string;
  status: string;
  created_at: string;
  score_band: string;
  match_score_value: number | null;
  match_score_version: string | null;
  income_band: string;
  move_in_urgency: string | null;
  household_size: number | null;
  has_pets: boolean | null;
  screening_summary: {
    credit: string;
    criminal: string;
    eviction: string;
    identity: string;
  };
  contact: null | {
    given_name: string | null;
    family_name: string | null;
    email: string | null;
    phone_e164: string | null;
    revealed_at: string;
  };
};

function mapReportStatus(kind: string, status: string): string {
  if (status === 'pending') return 'pending';
  if (status === 'failed') return kind === 'identity' ? 'not' : 'records';
  if (status === 'complete') return kind === 'identity' ? 'verified' : 'clear';
  return 'unknown';
}

/**
 * Contact is returned only when approved AND contact_revealed_at is set.
 * Reveal is written exclusively in decideOnApplicant on explicit approve — never on GET/render.
 */
export async function listListingApplicants(
  client: DbClient,
  input: { listingId: string; orgId: string },
): Promise<ApplicantListItem[]> {
  const { rows } = await client.query<{
    id: string;
    status: string;
    created_at: Date;
    contact_revealed_at: Date | null;
    move_in_urgency: string | null;
    household_size: number | null;
    has_pets: boolean | null;
    annual_income_cents: number | null;
    given_name: string | null;
    family_name: string | null;
    email: string | null;
    phone_e164: string | null;
    latest_score: string | null;
    match_score_value: number | null;
    match_score_version: string | null;
  }>(
    `select a.id, a.status, a.created_at, a.contact_revealed_at,
            a.match_score_value, a.match_score_version,
            rp.move_in_urgency, rp.household_size, rp.has_pets, rp.annual_income_cents,
            rp.given_name, rp.family_name, rp.email, rp.phone_e164,
            pf.latest_score::text
     from application a
     join renter_profile rp on rp.id = a.renter_profile_id
     left join party_features pf on pf.party_id = a.party_id
     where a.listing_id = $1 and a.org_id = $2
     order by a.created_at desc`,
    [input.listingId, input.orgId],
  );

  const appIds = rows.map((r) => r.id);
  const summaryByApp = new Map<string, ApplicantListItem['screening_summary']>();
  for (const id of appIds) {
    summaryByApp.set(id, {
      credit: 'unknown',
      criminal: 'unknown',
      eviction: 'unknown',
      identity: 'unknown',
    });
  }
  if (appIds.length) {
    const { rows: reports } = await client.query<{
      application_id: string;
      report_kind: string;
      status: string;
    }>(
      `select distinct on (so.application_id, sr.report_kind)
              so.application_id::text as application_id,
              sr.report_kind,
              sr.status
       from screening_order so
       join screening_report sr on sr.screening_order_id = so.id
       where so.application_id = any($1::uuid[])
       order by so.application_id, sr.report_kind, so.created_at desc, sr.issued_at desc nulls last`,
      [appIds],
    );
    for (const r of reports) {
      const sum = summaryByApp.get(r.application_id);
      if (!sum) continue;
      const mapped = mapReportStatus(r.report_kind, r.status);
      if (r.report_kind === 'credit') sum.credit = mapped;
      else if (r.report_kind === 'criminal') sum.criminal = mapped;
      else if (r.report_kind === 'risk_insight') sum.eviction = mapped;
      else if (r.report_kind === 'identity') sum.identity = mapped;
    }
  }

  return rows.map((r) => {
    const revealed = Boolean(r.contact_revealed_at);
    const approved = r.status === 'approved' || r.status === 'decisioned';
    const showContact = revealed && approved;
    return {
      application_id: r.id,
      status: r.status,
      created_at: r.created_at.toISOString(),
      score_band: scoreBand(r.latest_score != null ? Number(r.latest_score) : null),
      match_score_value: r.match_score_value,
      match_score_version: r.match_score_version,
      income_band: incomeBand(r.annual_income_cents),
      move_in_urgency: r.move_in_urgency,
      household_size: r.household_size,
      has_pets: r.has_pets,
      screening_summary: summaryByApp.get(r.id)!,
      contact: showContact
        ? {
            given_name: r.given_name,
            family_name: r.family_name,
            email: r.email,
            phone_e164: r.phone_e164,
            revealed_at: r.contact_revealed_at!.toISOString(),
          }
        : null,
    };
  });
}

export async function decideOnApplicant(
  client: DbClient,
  input: {
    listingId: string;
    applicationId: string;
    orgId: string;
    actorPartyId: string;
    decision: 'approve' | 'decline' | 'request_screening' | 'pass' | 'request_more_info';
    note?: string | null;
  },
): Promise<{ application_id: string; status: string; contact_revealed_at: string | null }> {
  const { rows } = await client.query<{
    id: string;
    status: string;
    party_id: string;
    contact_revealed_at: Date | null;
  }>(
    `select id, status, party_id, contact_revealed_at
     from application
     where id = $1 and listing_id = $2 and org_id = $3
     for update`,
    [input.applicationId, input.listingId, input.orgId],
  );
  const app = rows[0];
  if (!app) throw new AppError('application not found', 'application_not_found', 404);

  // Idempotent: same terminal decision twice is OK
  if (input.decision === 'approve' && app.status === 'approved' && app.contact_revealed_at) {
    return {
      application_id: app.id,
      status: app.status,
      contact_revealed_at: app.contact_revealed_at.toISOString(),
    };
  }
  if (input.decision === 'decline' && app.status === 'declined') {
    return { application_id: app.id, status: app.status, contact_revealed_at: null };
  }

  let nextStatus = app.status;
  let revealedAt: Date | null = app.contact_revealed_at;
  let decisionRow: 'approved' | 'declined' | 'interested' | 'withdrawn' | null = null;

  if (input.decision === 'approve') {
    // P0: approval (and contact reveal) only after screening finishes with real results.
    const ready = app.status === 'screening_complete' || app.status === 'screened';
    if (!ready) {
      throw new AppError(
        'Screening must complete before you can approve and reveal contact info.',
        'screening_required',
        409,
      );
    }
    const { rows: reports } = await client.query<{ status: string }>(
      `select sr.status
       from screening_order so
       join screening_report sr on sr.screening_order_id = so.id
       where so.application_id = $1
         and sr.status in ('complete', 'failed')
       limit 1`,
      [app.id],
    );
    if (!reports[0]) {
      throw new AppError(
        'Screening results are not available yet. Approve unlocks once at least one check reports.',
        'screening_results_pending',
        409,
      );
    }
    nextStatus = 'approved';
    // Contact reveal is an explicit side-effect of approve — not of page load.
    revealedAt = new Date();
    decisionRow = 'approved';
  } else if (input.decision === 'decline') {
    nextStatus = 'declined';
    decisionRow = 'declined';
  } else if (input.decision === 'pass') {
    nextStatus = 'landlord_passed';
  } else if (input.decision === 'request_screening') {
    nextStatus = 'awaiting_consent';
  } else if (input.decision === 'request_more_info') {
    // interim_v1 — no messaging system; stamp note on domain event only
    nextStatus = app.status;
  }

  await client.query(
    `update application
     set status = $2,
         contact_revealed_at = coalesce($3, contact_revealed_at)
     where id = $1`,
    [app.id, nextStatus, revealedAt],
  );

  if (decisionRow) {
    await client.query(
      `update landlord_decision set superseded_at = now()
       where application_id = $1 and superseded_at is null`,
      [app.id],
    );
    await client.query(
      `insert into landlord_decision (
         application_id, listing_id, org_id, decided_by_party_id, decision, contact_revealed_at
       ) values ($1,$2,$3,$4,$5,$6)`,
      [
        app.id,
        input.listingId,
        input.orgId,
        input.actorPartyId,
        decisionRow,
        decisionRow === 'approved' ? revealedAt : null,
      ],
    );
  }

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: app.id,
    eventType:
      input.decision === 'approve'
        ? 'applicant_approved'
        : input.decision === 'decline'
          ? 'applicant_declined'
          : `applicant_${input.decision}`,
    payload: {
      listing_id: input.listingId,
      decision: input.decision,
      note: input.note ?? null,
      contact_revealed: Boolean(revealedAt && input.decision === 'approve'),
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });

  return {
    application_id: app.id,
    status: nextStatus,
    contact_revealed_at:
      input.decision === 'approve' && revealedAt ? revealedAt.toISOString() : null,
  };
}

export async function updateLandlordListing(
  client: DbClient,
  input: {
    listingId: string;
    orgId: string;
    rentAmountCents?: number;
    depositCents?: number | null;
    bedrooms?: number | null;
    bathrooms?: number | null;
    sqft?: number | null;
    description?: string | null;
    petsAllowed?: boolean | null;
    amenities?: string[];
    availableOn?: string | null;
    status?: 'draft' | 'active' | 'paused' | 'rented';
  },
): Promise<{ id: string; status: string }> {
  const { rows: existing } = await client.query<{ id: string; unit_id: string; status: string }>(
    `select id, unit_id, status from listing where id = $1 and org_id = $2`,
    [input.listingId, input.orgId],
  );
  if (!existing[0]) throw new AppError('listing not found', 'listing_not_found', 404);

  if (input.rentAmountCents != null || input.depositCents !== undefined || input.petsAllowed !== undefined || input.amenities || input.availableOn !== undefined || input.description !== undefined || input.status) {
    await client.query(
      `update listing set
         rent_amount_cents = coalesce($3, rent_amount_cents),
         deposit_cents = coalesce($4, deposit_cents),
         pets_allowed = coalesce($5, pets_allowed),
         amenities = coalesce($6, amenities),
         available_on = coalesce($7::date, available_on),
         status = coalesce($8, status),
         published_at = case
           when coalesce($8, status) = 'active' then coalesce(published_at, now())
           else published_at
         end
       where id = $1 and org_id = $2`,
      [
        input.listingId,
        input.orgId,
        input.rentAmountCents ?? null,
        input.depositCents ?? null,
        input.petsAllowed ?? null,
        input.amenities ?? null,
        input.availableOn ?? null,
        input.status ?? null,
      ],
    );
  }

  if (input.bedrooms != null || input.bathrooms != null || input.sqft != null) {
    await client.query(
      `update unit set
         bedrooms = coalesce($2, bedrooms),
         bathrooms = coalesce($3, bathrooms),
         sqft = coalesce($4, sqft)
       where id = $1`,
      [existing[0].unit_id, input.bedrooms ?? null, input.bathrooms ?? null, input.sqft ?? null],
    );
  }

  if (input.description !== undefined) {
    await client.query(
      `update source_listing sl
       set description = $2
       from listing l
       where l.id = $1 and l.primary_source_listing_id = sl.id`,
      [input.listingId, input.description],
    );
  }

  const { rows } = await client.query<{ id: string; status: string }>(
    `select id, status from listing where id = $1`,
    [input.listingId],
  );
  return rows[0]!;
}

export async function uploadListingPhoto(
  client: DbClient,
  input: {
    listingId: string;
    orgId: string;
    body: Buffer;
    contentType: string;
    filename?: string;
  },
): Promise<{ url: string; storage_key: string }> {
  const { rows } = await client.query<{ id: string }>(
    `select id from listing where id = $1 and org_id = $2`,
    [input.listingId, input.orgId],
  );
  if (!rows[0]) throw new AppError('listing not found', 'listing_not_found', 404);
  if (!input.contentType.startsWith('image/')) {
    throw new AppError('only image uploads allowed', 'validation_error', 400);
  }

  const key = `listings/${input.orgId}/${input.listingId}/${randomUUID()}`;
  const store = getObjectStore();
  await store.put({ key, body: input.body, contentType: input.contentType });
  const signed = await store.signGetUrl(key, { expiresInSeconds: 300 });

  const { rows: pos } = await client.query<{ n: string }>(
    `select coalesce(max(position), -1)::text as n from listing_media where listing_id = $1`,
    [input.listingId],
  );
  const position = Number(pos[0]?.n ?? -1) + 1;
  await client.query(
    `insert into listing_media (listing_id, org_id, position, url, storage_key, content_type)
     values ($1,$2,$3,$4,$5,$6)`,
    [input.listingId, input.orgId, position, signed.url, key, input.contentType],
  );

  return { url: signed.url, storage_key: key };
}

export async function submitSelfExecution(
  client: DbClient,
  input: {
    orgId: string;
    partyId: string;
    licenseState: string;
    licenseType: 'licensed_broker' | 'licensed_pm' | 'owner_occupant';
    licenseNumber?: string | null;
    businessEntityName?: string | null;
    storageKey?: string | null;
    originalFilename?: string | null;
    contentType?: string | null;
  },
): Promise<{ id: string; status: string; compliance_tag: string }> {
  const pending = await client.query<{ id: string }>(
    `select id from landlord_self_execution
     where org_id = $1 and status = 'pending'
     limit 1`,
    [input.orgId],
  );
  if (pending.rows[0]) {
    throw new AppError('pending submission already exists', 'self_execution_pending', 409);
  }

  if (input.licenseType !== 'owner_occupant' && !input.licenseNumber?.trim()) {
    throw new AppError('license_number required', 'validation_error', 400);
  }

  const { rows } = await client.query<{ id: string; status: string; compliance_tag: string }>(
    `insert into landlord_self_execution (
       org_id, submitted_by_party_id, license_state, license_type,
       license_number, business_entity_name, storage_key, original_filename, content_type,
       compliance_tag
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'interim_v1')
     returning id, status, compliance_tag`,
    [
      input.orgId,
      input.partyId,
      input.licenseState.toUpperCase(),
      input.licenseType,
      input.licenseType === 'owner_occupant' ? null : input.licenseNumber ?? null,
      input.businessEntityName ?? null,
      input.storageKey ?? null,
      input.originalFilename ?? null,
      input.contentType ?? null,
    ],
  );
  return rows[0]!;
}

export async function getSelfExecutionStatus(
  client: DbClient,
  orgId: string,
): Promise<{
  submission: null | {
    id: string;
    status: string;
    license_type: string;
    license_state: string;
    compliance_tag: string;
    created_at: string;
    reviewer_notes: string | null;
  };
}> {
  const { rows } = await client.query<{
    id: string;
    status: string;
    license_type: string;
    license_state: string;
    compliance_tag: string;
    created_at: Date;
    reviewer_notes: string | null;
  }>(
    `select id, status, license_type, license_state, compliance_tag, created_at, reviewer_notes
     from landlord_self_execution
     where org_id = $1
     order by created_at desc
     limit 1`,
    [orgId],
  );
  const row = rows[0];
  if (!row) return { submission: null };
  return {
    submission: {
      id: row.id,
      status: row.status,
      license_type: row.license_type,
      license_state: row.license_state,
      compliance_tag: row.compliance_tag,
      created_at: row.created_at.toISOString(),
      reviewer_notes: row.reviewer_notes,
    },
  };
}
