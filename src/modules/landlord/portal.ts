import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/pool.js';
import { getObjectStore } from '../../infra/object-store/index.js';
import {
  assertHpTransitionAllowed,
  normalizeHpDecision,
  type HpDecision,
} from '../applications/index.js';
import { emitDomainEvent } from '../audit/index.js';
import { ensureCashbackOfferedOnApprove } from '../cashback/index.js';
import { createNotification } from '../notifications/index.js';
import { AppError } from '../shared/errors.js';

export type ScreeningMode = 'auto_screen' | 'manual_review';

export const PASS_REASON_CODES = [
  'income_below',
  'move_in_mismatch',
  'pet_policy',
  'occupancy_exceeded',
  'lease_term',
  'incomplete_profile',
  'unit_unavailable',
] as const;

export type PassReasonCode = (typeof PASS_REASON_CODES)[number];

export const MISSING_INFO_CATEGORIES = [
  'move_in',
  'income',
  'occupants',
  'pets',
  'lease_term',
  'incomplete_profile',
] as const;

export type MissingInfoCategory = (typeof MISSING_INFO_CATEGORIES)[number];

const PASS_REASON_SET = new Set<string>(PASS_REASON_CODES);
const MISSING_INFO_SET = new Set<string>(MISSING_INFO_CATEGORIES);

export function validatePassReasonCodes(codes: string[] | undefined): string[] {
  if (!codes?.length) {
    throw new AppError(
      'reason_codes required for pass (non-empty whitelist)',
      'validation_error',
      400,
    );
  }
  const invalid = codes.filter((c) => !PASS_REASON_SET.has(c));
  if (invalid.length) {
    throw new AppError(
      `invalid pass reason_codes: ${invalid.join(', ')}`,
      'validation_error',
      400,
    );
  }
  return [...new Set(codes)];
}

export function validateMissingInfoCategories(categories: string[] | undefined): string[] {
  if (!categories?.length) {
    throw new AppError(
      'missing_info_categories required',
      'validation_error',
      400,
    );
  }
  const invalid = categories.filter((c) => !MISSING_INFO_SET.has(c));
  if (invalid.length) {
    throw new AppError(
      `invalid missing_info_categories: ${invalid.join(', ')}`,
      'validation_error',
      400,
    );
  }
  return [...new Set(categories)];
}

function displayNameInitial(
  given: string | null,
  family: string | null,
): string {
  const first = given?.trim() || '';
  const initial = family?.trim()?.slice(0, 1) || '';
  const label = [first, initial ? `${initial}.` : ''].filter(Boolean).join(' ').trim();
  return label || 'Applicant';
}

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
  /** City + state only — never street/line1 for queue privacy. */
  current_location: string | null;
  preferred_lease_term_months: number | null;
  display_name: string;
  criteria_match: boolean | null;
  prequal_evaluation: unknown | null;
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
    prequal_evaluation: { appears_to_meet?: boolean } | null;
    preferred_lease_term_months: number | null;
    intake_city: string | null;
    intake_state: string | null;
  }>(
    `select a.id, a.status, a.created_at, a.contact_revealed_at,
            a.match_score_value, a.match_score_version, a.prequal_evaluation,
            coalesce(
              a.preferred_lease_term_months,
              rp.preferred_lease_term_months,
              rai.preferred_lease_term_months
            ) as preferred_lease_term_months,
            rai.current_address_city as intake_city,
            rai.current_address_state as intake_state,
            rp.move_in_urgency, rp.household_size, rp.has_pets, rp.annual_income_cents,
            rp.given_name, rp.family_name, rp.email, rp.phone_e164,
            pf.latest_score::text
     from application a
     join renter_profile rp on rp.id = a.renter_profile_id
     left join renter_application_intake rai on rai.party_id = a.party_id
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

  const postMoveForward = new Set([
    'awaiting_consent',
    'screening_authorized',
    'screening_running',
    'screening_in_progress',
    'awaiting_provider_configuration',
    'screened',
    'screening_complete',
    'approved',
    'declined',
  ]);

  return rows.map((r) => {
    const revealed = Boolean(r.contact_revealed_at);
    const approved = r.status === 'approved' || r.status === 'decisioned';
    const showContact = revealed && approved;
    const appears =
      r.prequal_evaluation && typeof r.prequal_evaluation === 'object'
        ? Boolean((r.prequal_evaluation as { appears_to_meet?: boolean }).appears_to_meet)
        : null;
    const locParts = [r.intake_city, r.intake_state].filter(Boolean);
    const unknownSummary = {
      credit: 'unknown',
      criminal: 'unknown',
      eviction: 'unknown',
      identity: 'unknown',
    };
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
      current_location: locParts.length ? locParts.join(', ') : null,
      preferred_lease_term_months: r.preferred_lease_term_months,
      display_name: displayNameInitial(r.given_name, r.family_name),
      criteria_match: appears,
      prequal_evaluation: r.prequal_evaluation,
      // Screening details only after Move Forward; prequal queue stays unknown.
      screening_summary: postMoveForward.has(r.status)
        ? summaryByApp.get(r.id)!
        : unknownSummary,
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
    decision: HpDecision;
    note?: string | null;
    reason_codes?: string[];
    missing_info_categories?: string[];
  },
): Promise<{ application_id: string; status: string; contact_revealed_at: string | null }> {
  const decision = normalizeHpDecision(input.decision);

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
  if (decision === 'approve' && app.status === 'approved' && app.contact_revealed_at) {
    return {
      application_id: app.id,
      status: app.status,
      contact_revealed_at: app.contact_revealed_at.toISOString(),
    };
  }
  if (decision === 'decline' && app.status === 'declined') {
    return { application_id: app.id, status: app.status, contact_revealed_at: null };
  }
  if (decision === 'pass' && app.status === 'landlord_passed') {
    return { application_id: app.id, status: app.status, contact_revealed_at: null };
  }
  if (decision === 'request_screening' && app.status === 'awaiting_consent') {
    return {
      application_id: app.id,
      status: app.status,
      contact_revealed_at: app.contact_revealed_at?.toISOString() ?? null,
    };
  }
  if (decision === 'request_more_info' && app.status === 'info_requested') {
    return {
      application_id: app.id,
      status: app.status,
      contact_revealed_at: app.contact_revealed_at?.toISOString() ?? null,
    };
  }

  assertHpTransitionAllowed({ fromStatus: app.status, decision });

  let nextStatus = app.status;
  let revealedAt: Date | null = app.contact_revealed_at;
  let decisionRow:
    | 'approved'
    | 'declined'
    | 'interested'
    | 'withdrawn'
    | 'passed'
    | 'move_forward'
    | 'info_requested'
    | null = null;
  let reasonCodes: string[] = [];
  let missingCategories: string[] = [];

  if (decision === 'approve') {
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
  } else if (decision === 'decline') {
    nextStatus = 'declined';
    decisionRow = 'declined';
  } else if (decision === 'pass') {
    reasonCodes = validatePassReasonCodes(input.reason_codes);
    nextStatus = 'landlord_passed';
    decisionRow = 'passed';
  } else if (decision === 'request_screening') {
    nextStatus = 'awaiting_consent';
    decisionRow = 'move_forward';
  } else if (decision === 'request_more_info') {
    missingCategories = validateMissingInfoCategories(input.missing_info_categories);
    nextStatus = 'info_requested';
    decisionRow = 'info_requested';
  }

  if (decision === 'pass') {
    await client.query(
      `update application
       set status = $2,
           passed_at = coalesce(passed_at, now()),
           contact_revealed_at = coalesce($3, contact_revealed_at)
       where id = $1`,
      [app.id, nextStatus, revealedAt],
    );
  } else if (decision === 'request_screening') {
    await client.query(
      `update application
       set status = $2,
           move_forward_at = coalesce(move_forward_at, now()),
           contact_revealed_at = coalesce($3, contact_revealed_at)
       where id = $1`,
      [app.id, nextStatus, revealedAt],
    );
  } else if (decision === 'request_more_info') {
    await client.query(
      `update application
       set status = $2,
           info_requested_at = coalesce(info_requested_at, now()),
           contact_revealed_at = coalesce($3, contact_revealed_at)
       where id = $1`,
      [app.id, nextStatus, revealedAt],
    );
  } else {
    await client.query(
      `update application
       set status = $2,
           contact_revealed_at = coalesce($3, contact_revealed_at)
       where id = $1`,
      [app.id, nextStatus, revealedAt],
    );
  }

  if (decision === 'request_more_info') {
    // Counsel-safe category request — not freeform sensitive data ask
    const message =
      input.note != null && input.note.trim()
        ? input.note.trim().slice(0, 500)
        : null;
    await client.query(
      `insert into missing_info_request (
         application_id, listing_id, org_id, categories, message,
         requested_by_party_id, status
       ) values ($1,$2,$3,$4::text[],$5,$6,'open')`,
      [
        app.id,
        input.listingId,
        input.orgId,
        missingCategories,
        message,
        input.actorPartyId,
      ],
    );
  }

  if (decisionRow) {
    await client.query(
      `update landlord_decision set superseded_at = now()
       where application_id = $1 and superseded_at is null`,
      [app.id],
    );
    await client.query(
      `insert into landlord_decision (
         application_id, listing_id, org_id, decided_by_party_id,
         decision, reason_codes, contact_revealed_at
       ) values ($1,$2,$3,$4,$5,$6::text[],$7)`,
      [
        app.id,
        input.listingId,
        input.orgId,
        input.actorPartyId,
        decisionRow,
        reasonCodes,
        decisionRow === 'approved' ? revealedAt : null,
      ],
    );
  }

  if (decision === 'approve') {
    await ensureCashbackOfferedOnApprove(client, {
      applicationId: app.id,
      listingId: input.listingId,
      partyId: app.party_id,
      orgId: input.orgId,
      actorPartyId: input.actorPartyId,
    });
  }

  const eventType =
    decision === 'approve'
      ? 'applicant_approved'
      : decision === 'decline'
        ? 'applicant_declined'
        : decision === 'request_screening'
          ? 'applicant_move_forward'
          : decision === 'pass'
            ? 'applicant_passed'
            : decision === 'request_more_info'
              ? 'applicant_info_requested'
              : `applicant_${decision}`;

  await emitDomainEvent(client, {
    aggregateType: 'application',
    aggregateId: app.id,
    eventType,
    payload: {
      listing_id: input.listingId,
      decision,
      note: input.note ?? null,
      reason_codes: reasonCodes,
      missing_info_categories: missingCategories,
      contact_revealed: Boolean(revealedAt && decision === 'approve'),
      screening_path: decision === 'request_screening',
    },
    actorPartyId: input.actorPartyId,
    actorKind: 'user',
  });

  // In-platform notifications to renter
  if (decision === 'pass') {
    await createNotification(client, {
      recipientPartyId: app.party_id,
      channel: 'in_platform',
      eventType: 'applicant_passed',
      templateKey: 'applicant_passed',
      payload: {
        application_id: app.id,
        listing_id: input.listingId,
        reason_codes: reasonCodes,
        // [PLACEHOLDER] Pass notice copy — counsel must approve renter-facing language
        legal_copy: '[PLACEHOLDER] The home provider passed on your application for now.',
      },
    });
  } else if (decision === 'request_screening') {
    await createNotification(client, {
      recipientPartyId: app.party_id,
      channel: 'in_platform',
      eventType: 'applicant_move_forward',
      templateKey: 'applicant_move_forward_screening',
      payload: {
        application_id: app.id,
        listing_id: input.listingId,
        screening_path: true,
        // [PLACEHOLDER] Move-forward / screening consent path copy
        legal_copy:
          '[PLACEHOLDER] The home provider wants to move forward — screening authorization may be required.',
      },
    });
  } else if (decision === 'request_more_info') {
    await createNotification(client, {
      recipientPartyId: app.party_id,
      channel: 'in_platform',
      eventType: 'applicant_info_requested',
      templateKey: 'applicant_info_requested',
      payload: {
        application_id: app.id,
        listing_id: input.listingId,
        categories: missingCategories,
        // [PLACEHOLDER] Missing-info request — category-only, counsel-safe
        legal_copy:
          '[PLACEHOLDER] Additional permitted information was requested for your application.',
      },
    });
  } else if (decision === 'approve') {
    await createNotification(client, {
      recipientPartyId: app.party_id,
      channel: 'in_platform',
      eventType: 'applicant_approved',
      templateKey: 'applicant_approved',
      payload: {
        application_id: app.id,
        listing_id: input.listingId,
        legal_copy: '[PLACEHOLDER] Your application was approved.',
      },
    });
  } else if (decision === 'decline') {
    await createNotification(client, {
      recipientPartyId: app.party_id,
      channel: 'in_platform',
      eventType: 'applicant_declined',
      templateKey: 'applicant_declined',
      payload: {
        application_id: app.id,
        listing_id: input.listingId,
        legal_copy: '[PLACEHOLDER] Your application was declined.',
      },
    });
  }

  return {
    application_id: app.id,
    status: nextStatus,
    contact_revealed_at:
      decision === 'approve' && revealedAt ? revealedAt.toISOString() : null,
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

export async function getApplicantDetail(
  client: DbClient,
  input: { applicationId: string; orgId: string },
): Promise<Record<string, unknown>> {
  const { rows } = await client.query<{
    id: string;
    listing_id: string;
    org_id: string;
    party_id: string;
    status: string;
    created_at: Date;
    contact_revealed_at: Date | null;
    criteria_version_id: string | null;
    prequal_evaluation: unknown;
    intake_snapshot: unknown;
    info_requested_at: Date | null;
    move_forward_at: Date | null;
    passed_at: Date | null;
    match_score_value: number | null;
    match_score_version: string | null;
    given_name: string | null;
    family_name: string | null;
    email: string | null;
    phone_e164: string | null;
    annual_income_cents: number | null;
    move_in_urgency: string | null;
    household_size: number | null;
    has_pets: boolean | null;
    preferred_state: string | null;
  }>(
    `select a.id, a.listing_id, a.org_id, a.party_id, a.status, a.created_at,
            a.contact_revealed_at, a.criteria_version_id, a.prequal_evaluation,
            a.intake_snapshot, a.info_requested_at, a.move_forward_at, a.passed_at,
            a.match_score_value, a.match_score_version,
            rp.given_name, rp.family_name, rp.email, rp.phone_e164,
            rp.annual_income_cents, rp.move_in_urgency, rp.household_size,
            rp.has_pets, rp.preferred_state
     from application a
     join renter_profile rp on rp.id = a.renter_profile_id
     where a.id = $1 and a.org_id = $2`,
    [input.applicationId, input.orgId],
  );
  const app = rows[0];
  if (!app) throw new AppError('application not found', 'application_not_found', 404);

  const revealed = Boolean(app.contact_revealed_at);
  const approved = app.status === 'approved' || app.status === 'decisioned';
  const showContact = revealed && approved;

  const { rows: reports } = await client.query<{
    report_kind: string;
    status: string;
  }>(
    `select distinct on (sr.report_kind)
            sr.report_kind, sr.status
     from screening_order so
     join screening_report sr on sr.screening_order_id = so.id
     where so.application_id = $1
     order by sr.report_kind, so.created_at desc, sr.issued_at desc nulls last`,
    [app.id],
  );
  const screening_summary = {
    credit: 'unknown',
    criminal: 'unknown',
    eviction: 'unknown',
    identity: 'unknown',
  };
  for (const r of reports) {
    const mapped = mapReportStatus(r.report_kind, r.status);
    if (r.report_kind === 'credit') screening_summary.credit = mapped;
    else if (r.report_kind === 'criminal') screening_summary.criminal = mapped;
    else if (r.report_kind === 'risk_insight') screening_summary.eviction = mapped;
    else if (r.report_kind === 'identity') screening_summary.identity = mapped;
  }

  const { rows: missing } = await client.query<{
    id: string;
    categories: string[];
    message: string | null;
    status: string;
    renter_response: string | null;
    created_at: Date;
    responded_at: Date | null;
  }>(
    `select id, categories, message, status, renter_response, created_at, responded_at
     from missing_info_request
     where application_id = $1
     order by created_at desc`,
    [app.id],
  );

  const { rows: events } = await client.query<{
    event_type: string;
    payload: Record<string, unknown>;
    occurred_at: Date;
    actor_party_id: string | null;
  }>(
    `select event_type, payload, occurred_at, actor_party_id
     from domain_event
     where aggregate_type = 'application' and aggregate_id = $1
     order by seq desc
     limit 50`,
    [app.id],
  );

  const brokerNotes = events
    .filter((e) => e.event_type === 'broker_note_added' && e.payload?.note)
    .map((e) => ({
      note: String(e.payload.note),
      at: e.occurred_at.toISOString(),
      actor_party_id: e.actor_party_id,
    }));
  let brokerRecommendation: string | null = null;
  let brokerRecommendationAt: string | null = null;
  for (const e of [...events].reverse()) {
    if (e.event_type === 'broker_recommendation_set') {
      brokerRecommendation =
        e.payload?.recommendation != null ? String(e.payload.recommendation) : null;
      brokerRecommendationAt = e.occurred_at.toISOString();
    }
  }

  return {
    application_id: app.id,
    listing_id: app.listing_id,
    org_id: app.org_id,
    status: app.status,
    created_at: app.created_at.toISOString(),
    display_name: displayNameInitial(app.given_name, app.family_name),
    profile: {
      move_in_urgency: app.move_in_urgency,
      household_size: app.household_size,
      has_pets: app.has_pets,
      preferred_state: app.preferred_state,
      income_band: incomeBand(app.annual_income_cents),
      annual_income_cents: showContact ? app.annual_income_cents : null,
    },
    intake_snapshot: app.intake_snapshot,
    criteria_version_id: app.criteria_version_id,
    prequal_evaluation: app.prequal_evaluation,
    screening_summary,
    missing_info_requests: missing.map((m) => ({
      id: m.id,
      categories: m.categories,
      message: m.message,
      status: m.status,
      renter_response: m.renter_response,
      created_at: m.created_at.toISOString(),
      responded_at: m.responded_at?.toISOString() ?? null,
    })),
    broker_notes: brokerNotes,
    broker_recommendation: brokerRecommendation,
    broker_recommendation_at: brokerRecommendationAt,
    activity: events.map((e) => ({
      event_type: e.event_type,
      payload: e.payload,
      occurred_at: e.occurred_at.toISOString(),
      actor_party_id: e.actor_party_id,
    })),
    timestamps: {
      info_requested_at: app.info_requested_at?.toISOString() ?? null,
      move_forward_at: app.move_forward_at?.toISOString() ?? null,
      passed_at: app.passed_at?.toISOString() ?? null,
      contact_revealed_at: showContact ? app.contact_revealed_at!.toISOString() : null,
    },
    match_score_value: app.match_score_value,
    match_score_version: app.match_score_version,
    contact: showContact
      ? {
          given_name: app.given_name,
          family_name: app.family_name,
          email: app.email,
          phone_e164: app.phone_e164,
          revealed_at: app.contact_revealed_at!.toISOString(),
        }
      : null,
  };
}

export async function listOrgActivity(
  client: DbClient,
  input: { orgId: string; limit?: number; offset?: number; category?: string | null },
): Promise<{
  items: Array<{
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    listing_id: string | null;
    application_id: string | null;
    occurred_at: string;
    actor_party_id: string | null;
    payload: Record<string, unknown>;
  }>;
  limit: number;
  offset: number;
}> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const category = input.category?.trim() || null;

  const { rows } = await client.query<{
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    listing_id: string | null;
    application_id: string | null;
    occurred_at: Date;
    actor_party_id: string | null;
    payload: Record<string, unknown>;
  }>(
    `select de.event_type, de.aggregate_type, de.aggregate_id::text as aggregate_id,
            coalesce(
              de.payload->>'listing_id',
              a.listing_id::text,
              l.id::text
            ) as listing_id,
            case
              when de.aggregate_type = 'application' then de.aggregate_id::text
              else de.payload->>'application_id'
            end as application_id,
            de.occurred_at, de.actor_party_id, de.payload
     from domain_event de
     left join application a
       on de.aggregate_type = 'application' and de.aggregate_id = a.id and a.org_id = $1
     left join listing l
       on de.aggregate_type = 'listing' and de.aggregate_id = l.id and l.org_id = $1
     where (
             a.id is not null
             or l.id is not null
             or (de.payload->>'org_id')::uuid = $1
           )
       and ($2::text is null or de.event_type ilike '%' || $2 || '%')
     order by de.seq desc
     limit $3 offset $4`,
    [input.orgId, category, limit, offset],
  );

  return {
    items: rows.map((r) => ({
      event_type: r.event_type,
      aggregate_type: r.aggregate_type,
      aggregate_id: r.aggregate_id,
      listing_id: r.listing_id,
      application_id: r.application_id,
      occurred_at: r.occurred_at.toISOString(),
      actor_party_id: r.actor_party_id,
      payload: r.payload,
    })),
    limit,
    offset,
  };
}

