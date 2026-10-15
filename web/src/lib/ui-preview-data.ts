/**
 * In-memory fictional dataset for local UI inspection.
 * Mutations stay in-memory only — never hit payment, screening, email, or DB.
 */

import { interimCashbackCents } from './cashback';
import { LISTING_FIXTURES } from './listing-fixtures';

const PHOTO =
  'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=80';

export type PreviewListingRow = {
  id: string;
  status: string;
  rent_amount_cents: number;
  deposit_cents: number;
  city: string | null;
  state: string | null;
  line1: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  applicant_count: number;
  photo_url: string | null;
  description?: string;
  days_vacant?: number;
};

export type PreviewApplicant = {
  application_id: string;
  listing_id: string;
  status: string;
  created_at: string;
  score_band: string;
  income_band: string;
  household_size: number | null;
  has_pets: boolean | null;
  contact: {
    given_name: string | null;
    family_name: string | null;
    email: string | null;
    phone_e164: string | null;
  };
  screening_summary: {
    credit: string;
    criminal: string;
    eviction: string;
    identity: string;
  };
  renter_label?: string;
  listing_label?: string;
  provider_name?: string;
  org_id?: string;
  screening_status?: string;
};

export type PreviewCriteria = {
  id: string;
  listing_id: string;
  org_id: string;
  version: number;
  jurisdiction: string | null;
  rules: {
    min_income_to_rent_ratio?: number;
    move_in_window_days?: number;
    pets_allowed?: boolean;
    max_occupants?: number;
    lease_term_months?: number | number[];
    require_complete_profile?: boolean;
  };
  effective_at: string;
  created_by_party_id: string | null;
  superseded_at: string | null;
};

export type PreviewSupportCase = {
  id: string;
  category: string;
  subject: string;
  description: string;
  status: string;
  related_listing_id: string | null;
  related_application_id: string | null;
  created_at: string;
  updated_at: string;
};

type Universe = {
  listings: PreviewListingRow[];
  applicants: PreviewApplicant[];
  activity: Array<{
    id: string;
    text: string;
    when: string;
    kind: string;
    href?: string;
  }>;
  invitations: Array<PreviewInvitation>;
  account_status: 'active' | 'past_due' | 'suspended';
  notes: Record<string, Array<{ note: string; at: string; actor_party_id: string | null }>>;
  recommendations: Record<string, 'approve' | 'decline' | null>;
  criteria: Record<string, PreviewCriteria>;
  saved: string[];
  support_cases: PreviewSupportCase[];
  missing_info: Record<
    string,
    Array<{
      id: string;
      categories: string[];
      message: string | null;
      status: string;
      renter_response: string | null;
      created_at: string;
      responded_at: string | null;
    }>
  >;
  leases: Array<{
    id: string;
    listing_id: string;
    application_id: string | null;
    original_filename: string;
    content_type: string;
    created_at: string;
    workflow_status?: string;
  }>;
  cashback: Array<{
    id: string;
    application_id: string;
    listing_id: string;
    status: string;
    amount_cents: number | null;
    offer_version: string;
    rate_bps: number;
    rent_basis_cents: number | null;
    ineligible_reason: string | null;
    created_at: string;
    updated_at: string;
  }>;
};

export type PreviewInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'expired'
  | 'revoked'
  | 'delivery_failed';

export type PreviewInvitation = {
  id: string;
  email: string;
  business_name: string;
  note?: string;
  status: PreviewInvitationStatus;
  sent_at: string;
  expires_at: string;
  provider_org_id?: string;
};

function seed(): Universe {
  const base = LISTING_FIXTURES.slice(0, 6);
  const listings: PreviewListingRow[] = [
    {
      id: 'ui-lst-draft',
      status: 'draft',
      rent_amount_cents: 175_000,
      deposit_cents: 87500,
      city: 'Austin',
      state: 'TX',
      line1: '12 Draft Lane',
      bedrooms: 1,
      bathrooms: 1,
      applicant_count: 0,
      photo_url: PHOTO,
      description: 'Draft listing — not visible to renters.',
      days_vacant: 0,
    },
    {
      id: 'ui-lst-active',
      status: 'active',
      rent_amount_cents: 185_000,
      deposit_cents: 92500,
      city: 'Austin',
      state: 'TX',
      line1: base[0]?.address_line ?? '100 Congress Ave',
      bedrooms: 1,
      bathrooms: 1,
      applicant_count: 4,
      photo_url: base[0]?.photos[0] ?? PHOTO,
      days_vacant: 12,
    },
    {
      id: 'ui-lst-paused',
      status: 'paused',
      rent_amount_cents: 210_000,
      deposit_cents: 105_000,
      city: 'Austin',
      state: 'TX',
      line1: '4500 S Lamar Blvd',
      bedrooms: 2,
      bathrooms: 2,
      applicant_count: 1,
      photo_url: PHOTO,
      days_vacant: 30,
    },
    {
      id: 'ui-lst-closed',
      status: 'rented',
      rent_amount_cents: 240_000,
      deposit_cents: 120_000,
      city: 'Dallas',
      state: 'TX',
      line1: '88 Closed Court',
      bedrooms: 2,
      bathrooms: 2,
      applicant_count: 0,
      photo_url: PHOTO,
      days_vacant: 0,
    },
  ];

  const applicants: PreviewApplicant[] = [
    {
      application_id: 'ui-app-interested',
      listing_id: 'ui-lst-active',
      status: 'interested',
      created_at: '2026-10-01T12:00:00Z',
      score_band: 'B',
      income_band: '3x+',
      household_size: 1,
      has_pets: false,
      contact: {
        given_name: 'Ava',
        family_name: 'Nguyen',
        email: 'ava.preview@example.com',
        phone_e164: '+15125550101',
      },
      screening_summary: {
        credit: 'not_requested',
        criminal: 'not_requested',
        eviction: 'not_requested',
        identity: 'not_requested',
      },
      renter_label: 'Ava N.',
      listing_label: '100 Congress Ave',
      provider_name: 'Preview Oaks LLC',
      org_id: 'ui-org-oaks',
      screening_status: 'not_started',
    },
    {
      application_id: 'ui-app-waiting',
      listing_id: 'ui-lst-active',
      status: 'submitted',
      created_at: '2026-10-02T12:00:00Z',
      score_band: 'A',
      income_band: '3x+',
      household_size: 2,
      has_pets: true,
      contact: {
        given_name: 'Jordan',
        family_name: 'Lee',
        email: 'jordan.preview@example.com',
        phone_e164: '+15125550102',
      },
      screening_summary: {
        credit: 'not_requested',
        criminal: 'not_requested',
        eviction: 'not_requested',
        identity: 'not_requested',
      },
      renter_label: 'Jordan L.',
      listing_label: '100 Congress Ave',
      provider_name: 'Preview Oaks LLC',
      org_id: 'ui-org-oaks',
      screening_status: 'not_started',
    },
    {
      application_id: 'ui-app-awaiting-consent',
      listing_id: 'ui-lst-active',
      status: 'awaiting_consent',
      created_at: '2026-10-03T12:00:00Z',
      score_band: 'B',
      income_band: '2.5x',
      household_size: 1,
      has_pets: false,
      contact: {
        given_name: 'Sam',
        family_name: 'Patel',
        email: 'sam.preview@example.com',
        phone_e164: '+15125550103',
      },
      screening_summary: {
        credit: 'pending_consent',
        criminal: 'pending_consent',
        eviction: 'pending_consent',
        identity: 'pending_consent',
      },
      renter_label: 'Sam P.',
      listing_label: '100 Congress Ave',
      provider_name: 'Preview Oaks LLC',
      org_id: 'ui-org-oaks',
      screening_status: 'awaiting_consent',
    },
    {
      application_id: 'ui-app-in-progress',
      listing_id: 'ui-lst-active',
      status: 'screening_running',
      created_at: '2026-10-04T12:00:00Z',
      score_band: 'A',
      income_band: '3x+',
      household_size: 1,
      has_pets: false,
      contact: {
        given_name: 'Riley',
        family_name: 'Chen',
        email: 'riley.preview@example.com',
        phone_e164: '+15125550104',
      },
      screening_summary: {
        credit: 'in_progress',
        criminal: 'in_progress',
        eviction: 'pending',
        identity: 'clear',
      },
      renter_label: 'Riley C.',
      listing_label: '100 Congress Ave',
      provider_name: 'Preview Oaks LLC',
      org_id: 'ui-org-oaks',
      screening_status: 'in_progress',
    },
    {
      application_id: 'ui-app-complete',
      listing_id: 'ui-lst-paused',
      status: 'screening_complete',
      created_at: '2026-09-20T12:00:00Z',
      score_band: 'A',
      income_band: '3x+',
      household_size: 2,
      has_pets: false,
      contact: {
        given_name: 'Casey',
        family_name: 'Brooks',
        email: 'casey.preview@example.com',
        phone_e164: '+15125550105',
      },
      screening_summary: {
        credit: 'clear',
        criminal: 'clear',
        eviction: 'clear',
        identity: 'clear',
      },
      renter_label: 'Casey B.',
      listing_label: '4500 S Lamar Blvd',
      provider_name: 'Preview Oaks LLC',
      org_id: 'ui-org-oaks',
      screening_status: 'complete',
    },
    {
      application_id: 'ui-app-approved',
      listing_id: 'ui-lst-closed',
      status: 'approved',
      created_at: '2026-09-01T12:00:00Z',
      score_band: 'A',
      income_band: '3x+',
      household_size: 1,
      has_pets: false,
      contact: {
        given_name: 'Morgan',
        family_name: 'Diaz',
        email: 'morgan.preview@example.com',
        phone_e164: '+15125550106',
      },
      screening_summary: {
        credit: 'clear',
        criminal: 'clear',
        eviction: 'clear',
        identity: 'clear',
      },
      renter_label: 'Morgan D.',
      listing_label: '88 Closed Court',
      provider_name: 'Preview Oaks LLC',
      org_id: 'ui-org-oaks',
      screening_status: 'complete',
    },
    {
      application_id: 'ui-app-declined',
      listing_id: 'ui-lst-active',
      status: 'declined',
      created_at: '2026-09-15T12:00:00Z',
      score_band: 'C',
      income_band: '2x',
      household_size: 3,
      has_pets: true,
      contact: {
        given_name: 'Taylor',
        family_name: 'Kim',
        email: 'taylor.preview@example.com',
        phone_e164: '+15125550107',
      },
      screening_summary: {
        credit: 'review',
        criminal: 'clear',
        eviction: 'clear',
        identity: 'clear',
      },
      renter_label: 'Taylor K.',
      listing_label: '100 Congress Ave',
      provider_name: 'Preview Oaks LLC',
      org_id: 'ui-org-oaks',
      screening_status: 'complete',
    },
    {
      application_id: 'ui-app-error',
      listing_id: 'ui-lst-active',
      status: 'screening_error',
      created_at: '2026-10-05T12:00:00Z',
      score_band: 'B',
      income_band: '3x+',
      household_size: 1,
      has_pets: false,
      contact: {
        given_name: 'Quinn',
        family_name: 'Ortiz',
        email: 'quinn.preview@example.com',
        phone_e164: '+15125550108',
      },
      screening_summary: {
        credit: 'error',
        criminal: 'unavailable',
        eviction: 'unavailable',
        identity: 'clear',
      },
      renter_label: 'Quinn O.',
      listing_label: '100 Congress Ave',
      provider_name: 'Preview Oaks LLC',
      org_id: 'ui-org-oaks',
      screening_status: 'error',
    },
  ];

  return {
    listings,
    applicants,
    activity: [
      {
        id: 'act-1',
        kind: 'listing',
        text: 'Paused Southridge listing for renovations',
        when: '2h ago',
        href: '/landlord/listings/ui-lst-paused',
      },
      {
        id: 'act-2',
        kind: 'applicant',
        text: 'Requested screening for Sam Patel',
        when: '5h ago',
        href: '/landlord/applicants/ui-app-awaiting-consent',
      },
      {
        id: 'act-3',
        kind: 'screening',
        text: 'Screening complete for Casey Brooks',
        when: '1d ago',
        href: '/landlord/applicants/ui-app-complete',
      },
      {
        id: 'act-4',
        kind: 'broker',
        text: 'Broker recommended approve for Casey Brooks',
        when: '1d ago',
        href: '/landlord/applicants/ui-app-complete',
      },
      {
        id: 'act-5',
        kind: 'settings',
        text: 'Account settings updated (screening mode)',
        when: '3d ago',
        href: '/settings',
      },
    ],
    invitations: [
      {
        id: 'inv-pending',
        email: 'new.provider@example.com',
        business_name: 'Sunset Villas LLC',
        note: 'Looking forward to partnering on your Austin portfolio.',
        status: 'pending',
        sent_at: '2026-10-04T10:00:00Z',
        expires_at: '2026-10-18T10:00:00Z',
      },
      {
        id: 'inv-accepted',
        email: 'oaks@example.com',
        business_name: 'Preview Oaks LLC',
        status: 'accepted',
        sent_at: '2026-09-01T10:00:00Z',
        expires_at: '2026-09-15T10:00:00Z',
        provider_org_id: 'ui-org-oaks',
      },
      {
        id: 'inv-revoked',
        email: 'old.provider@example.com',
        business_name: 'Legacy Rentals Co.',
        status: 'revoked',
        sent_at: '2026-08-01T10:00:00Z',
        expires_at: '2026-08-15T10:00:00Z',
      },
      {
        id: 'inv-expired',
        email: 'expired@example.com',
        business_name: 'Hill Country Homes',
        status: 'expired',
        sent_at: '2026-07-01T10:00:00Z',
        expires_at: '2026-07-15T10:00:00Z',
      },
      {
        id: 'inv-failed',
        email: 'bounce@invalid.test',
        business_name: 'Bad Mailbox Inc.',
        status: 'delivery_failed',
        sent_at: '2026-09-20T10:00:00Z',
        expires_at: '2026-10-04T10:00:00Z',
      },
    ],
    account_status: 'active',
    notes: {
      'ui-app-complete': [
        {
          note: 'Strong income documentation. Recommend approve.',
          at: '2026-09-21T15:00:00Z',
          actor_party_id: 'ui-broker',
        },
      ],
    },
    recommendations: {
      'ui-app-complete': 'approve',
    },
    criteria: {
      'ui-lst-active': {
        id: 'crit-active',
        listing_id: 'ui-lst-active',
        org_id: 'ui-org-oaks',
        version: 1,
        jurisdiction: 'TX',
        rules: {
          min_income_to_rent_ratio: 3,
          move_in_window_days: 60,
          pets_allowed: false,
          max_occupants: 4,
          lease_term_months: 12,
          require_complete_profile: true,
        },
        effective_at: '2026-09-01T00:00:00Z',
        created_by_party_id: 'ui-landlord',
        superseded_at: null,
      },
    },
    saved: ['ui-lst-active'],
    support_cases: [],
    missing_info: {},
    leases: [],
    cashback: [],
  };
}

let universe: Universe = seed();

export function resetUiPreviewUniverse(): void {
  universe = seed();
}

export function getUiPreviewUniverse(): Universe {
  return universe;
}

export function previewPublicListings() {
  return LISTING_FIXTURES.map((l) => ({
    id: l.id,
    rent_amount_cents: l.rent_cents,
    deposit_cents: l.deposit_cents ?? Math.round(l.rent_cents / 2),
    bedrooms: l.beds,
    bathrooms: l.baths,
    sqft: l.sqft ?? null,
    property_type: l.property_type ?? 'apartment',
    available_on: l.available_on,
    lease_term_months: l.lease_months,
    description: l.description,
    cashback_cents: interimCashbackCents(l.rent_cents),
    cashback_interim_v1: true,
    media: l.photos.map((url) => ({ url })),
    address: {
      line1: l.address_line,
      line2: null as string | null,
      city: l.city,
      state: l.state,
      postal_code: l.postal_code,
      raw_input: `${l.address_line}, ${l.city}, ${l.state}`,
    },
  }));
}

export function previewMutateListingStatus(id: string, status: string) {
  const row = universe.listings.find((l) => l.id === id);
  if (!row) return null;
  row.status = status;
  universe.activity.unshift({
    id: `act-${Date.now()}`,
    kind: 'listing',
    text: `Listing ${row.line1 ?? id} → ${status}`,
    when: 'just now',
  });
  return row;
}

export function previewDecide(
  listingId: string,
  applicationId: string,
  decision: string,
  opts?: { reason_codes?: string[]; missing_info_categories?: string[]; note?: string },
) {
  const app = universe.applicants.find(
    (a) => a.application_id === applicationId && a.listing_id === listingId,
  );
  if (!app) return null;
  const normalized =
    decision === 'move_forward' ? 'request_screening' : decision;
  if (normalized === 'approve') {
    app.status = 'approved';
    universe.cashback.unshift({
      id: `cb-${Date.now()}`,
      application_id: applicationId,
      listing_id: listingId,
      status: 'offered',
      amount_cents: null,
      offer_version: 'display_v1',
      rate_bps: 2000,
      rent_basis_cents: null,
      ineligible_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  } else if (normalized === 'decline') app.status = 'declined';
  else if (normalized === 'request_screening') {
    app.status = 'awaiting_consent';
    app.screening_status = 'awaiting_consent';
  } else if (normalized === 'pass') {
    if (!opts?.reason_codes?.length) {
      throw new Error('reason_codes required for pass');
    }
    app.status = 'landlord_passed';
  } else if (normalized === 'request_more_info') {
    if (!opts?.missing_info_categories?.length) {
      throw new Error('missing_info_categories required');
    }
    app.status = 'info_requested';
    const list = universe.missing_info[applicationId] ?? [];
    list.unshift({
      id: `mir-${Date.now()}`,
      categories: opts.missing_info_categories,
      message: opts.note ?? null,
      status: 'open',
      renter_response: null,
      created_at: new Date().toISOString(),
      responded_at: null,
    });
    universe.missing_info[applicationId] = list;
  }
  universe.activity.unshift({
    id: `act-${Date.now()}`,
    kind: 'applicant',
    text: `Decision ${decision} on ${app.renter_label ?? applicationId}`,
    when: 'just now',
    href: `/landlord/applicants/${applicationId}`,
  });
  return { application_id: applicationId, status: app.status };
}

export function previewPutCriteria(
  listingId: string,
  body: { jurisdiction?: string | null; rules: PreviewCriteria['rules'] },
): PreviewCriteria {
  const next: PreviewCriteria = {
    id: `crit-${Date.now()}`,
    listing_id: listingId,
    org_id: 'ui-org-oaks',
    version: (universe.criteria[listingId]?.version ?? 0) + 1,
    jurisdiction: body.jurisdiction ?? null,
    rules: body.rules,
    effective_at: new Date().toISOString(),
    created_by_party_id: 'ui-landlord',
    superseded_at: null,
  };
  universe.criteria[listingId] = next;
  return next;
}

export function previewAddNote(applicationId: string, note: string) {
  const list = universe.notes[applicationId] ?? [];
  list.unshift({ note, at: new Date().toISOString(), actor_party_id: 'ui-broker' });
  universe.notes[applicationId] = list;
  return { application_id: applicationId, note };
}

export function previewSetRecommendation(
  applicationId: string,
  recommendation: 'approve' | 'decline' | null,
) {
  universe.recommendations[applicationId] = recommendation;
  return { application_id: applicationId, recommendation };
}

export function previewCreateListing(body: {
  address_raw: string;
  rent_amount_cents: number;
  deposit_cents?: number;
  bedrooms?: number;
  bathrooms?: number;
  description?: string;
  status?: string;
}) {
  const id = `ui-lst-${Date.now()}`;
  const row: PreviewListingRow = {
    id,
    status: body.status ?? 'draft',
    rent_amount_cents: body.rent_amount_cents,
    deposit_cents: body.deposit_cents ?? Math.round(body.rent_amount_cents / 2),
    city: 'Austin',
    state: 'TX',
    line1: body.address_raw.split(',')[0]?.trim() || body.address_raw,
    bedrooms: body.bedrooms ?? null,
    bathrooms: body.bathrooms ?? null,
    applicant_count: 0,
    photo_url: PHOTO,
    description: body.description,
    days_vacant: 0,
  };
  universe.listings.unshift(row);
  universe.activity.unshift({
    id: `act-${Date.now()}`,
    kind: 'listing',
    text: `Created listing ${row.line1}`,
    when: 'just now',
  });
  return row;
}

function defaultExpiresAt(from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + 14);
  return d.toISOString();
}

export function previewInvite(email: string, businessName?: string, note?: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const duplicate = universe.invitations.find(
    (inv) =>
      inv.email.toLowerCase() === normalizedEmail &&
      (inv.status === 'pending' || inv.status === 'accepted'),
  );
  if (duplicate) {
    throw new Error(
      duplicate.status === 'accepted'
        ? 'This Home Provider is already connected to your network.'
        : 'A pending invitation already exists for this email.',
    );
  }

  const sentAt = new Date().toISOString();
  const inv: PreviewInvitation = {
    id: `inv-${Date.now()}`,
    email: email.trim(),
    business_name: businessName?.trim() || email.trim().split('@')[0] || 'Home Provider',
    note: note?.trim() || undefined,
    status: 'pending',
    sent_at: sentAt,
    expires_at: defaultExpiresAt(new Date(sentAt)),
  };
  universe.invitations.unshift(inv);
  universe.activity.unshift({
    id: `act-${Date.now()}`,
    kind: 'broker',
    text: `Invitation sent to ${inv.business_name}`,
    when: 'just now',
    href: '/broker/invitations',
  });
  return inv;
}

export function previewCancelInvite(id: string) {
  const inv = universe.invitations.find((i) => i.id === id);
  if (!inv) return null;
  if (inv.status !== 'pending' && inv.status !== 'delivery_failed') {
    throw new Error('Only pending invitations can be cancelled.');
  }
  inv.status = 'revoked';
  return inv;
}

export function previewResendInvite(id: string) {
  const inv = universe.invitations.find((i) => i.id === id);
  if (!inv) return null;
  if (!['pending', 'expired', 'delivery_failed'].includes(inv.status)) {
    throw new Error('This invitation cannot be resent.');
  }
  inv.status = 'pending';
  inv.sent_at = new Date().toISOString();
  inv.expires_at = defaultExpiresAt();
  return inv;
}

export function previewAcceptInvite(id: string, providerOrgId = 'ui-org-new') {
  const inv = universe.invitations.find((i) => i.id === id);
  if (!inv) return null;
  if (inv.status !== 'pending') {
    throw new Error('Only pending invitations can be accepted.');
  }
  inv.status = 'accepted';
  inv.provider_org_id = providerOrgId;
  return inv;
}
