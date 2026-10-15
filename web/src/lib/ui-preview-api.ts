/**
 * In-memory preview adapters for local UI inspection.
 * Never forwards mutating calls to the live API while preview is active.
 */

import {
  getUiPreviewUniverse,
  previewAddNote,
  previewCreateListing,
  previewDecide,
  previewCancelInvite,
  previewInvite,
  previewPutCriteria,
  previewResendInvite,
  previewMutateListingStatus,
  previewPublicListings,
  previewSetRecommendation,
} from './ui-preview-data';
import { getUiPreviewRole, isUiPreviewActive } from './ui-preview';
import { getPreviewHpSettings, savePreviewHpSettings } from './ui-preview-settings';
import {
  getNetlifyDemoEmail,
  getNetlifyDemoRole,
  isNetlifyDemoMode,
  isNetlifyDemoSessionActive,
} from './netlify-demo';

type PreviewResult = { status: number; body: unknown } | null;

function json(status: number, body: unknown): PreviewResult {
  return { status, body };
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  if (!init?.body || typeof init.body !== 'string') return {};
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isOfflineFixtureActive(): boolean {
  return isUiPreviewActive() || isNetlifyDemoMode();
}

export function tryUiPreviewRequest(path: string, init?: RequestInit): PreviewResult {
  if (!isOfflineFixtureActive()) return null;

  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(path, 'http://preview.local');
  const p = url.pathname;
  const u = getUiPreviewUniverse();
  const body = parseBody(init);
  const netlifySession = isNetlifyDemoMode() && isNetlifyDemoSessionActive();

  // Block / never forward live side-effects
  if (p.startsWith('/v1/auth/magic-link') || p.startsWith('/v1/auth/redeem')) {
    return json(403, {
      error: isNetlifyDemoMode() ? 'netlify_demo_blocked' : 'ui_preview_blocked',
      message: isNetlifyDemoMode()
        ? 'Magic-link auth is disabled in the standalone Netlify demo. Use the demo email gate.'
        : 'Magic-link auth is disabled in local UI preview.',
    });
  }
  if (
    p.includes('stripe') ||
    p.includes('certn') ||
    p.includes('checkr') ||
    (p.includes('pay') && !p.includes('pay-consent'))
  ) {
    return json(403, {
      error: isNetlifyDemoMode() ? 'netlify_demo_blocked' : 'ui_preview_blocked',
      message: 'Payments and screening providers are disabled in offline demo mode.',
    });
  }

  if (method === 'GET' && p === '/v1/auth/me') {
    if (isNetlifyDemoMode() && !netlifySession) {
      return json(401, { error: 'auth_required', message: 'Demo session required.' });
    }
    const previewRole = netlifySession
      ? (getNetlifyDemoRole() ?? 'renter')
      : (getUiPreviewRole() ?? 'renter');
    const role =
      previewRole === 'landlord'
        ? 'LANDLORD'
        : previewRole === 'broker'
          ? 'BROKER'
          : 'APPLICANT';
    const email = netlifySession
      ? (getNetlifyDemoEmail() ?? 'demo@rbitfinancial.com')
      : 'ui-preview@localhost';
    const localPart = email.split('@')[0] ?? 'Demo';
    return json(200, {
      party_id: netlifySession ? 'netlify-demo-party' : 'ui-preview-party',
      session_id: netlifySession ? 'netlify-demo-session' : 'ui-preview-session',
      role,
      email,
      given_name: netlifySession ? 'Demo' : 'UI',
      family_name: netlifySession ? localPart : 'Preview',
      mfa_enrolled: true,
      mfa_required: false,
      renter_profile_complete: true,
      party_role: previewRole === 'landlord' ? 'landlord' : previewRole === 'broker' ? 'broker' : 'renter',
      roles: [
        { role: 'applicant', org_id: null },
        { role: 'landlord', org_id: 'ui-org-oaks' },
        { role: 'broker', org_id: 'ui-org-broker' },
      ],
    });
  }

  if (method === 'GET' && p === '/v1/listings') {
    const all = previewPublicListings();
    const limit = Number(url.searchParams.get('limit') ?? 200);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return json(200, {
      listings: all.slice(offset, offset + limit),
      pagination: { total: all.length, limit, offset },
    });
  }

  const listingGet = p.match(/^\/v1\/listings\/([^/]+)$/);
  if (method === 'GET' && listingGet) {
    const row = previewPublicListings().find((l) => l.id === listingGet[1]);
    if (!row) return json(404, { error: 'not_found', message: 'Listing not found' });
    return json(200, { listing: row });
  }

  if (method === 'GET' && p === '/v1/landlord/listings') {
    return json(200, { listings: u.listings });
  }

  if (method === 'POST' && p === '/v1/landlord/listings') {
    const created = previewCreateListing({
      address_raw: String(body.address_raw ?? 'New preview home'),
      rent_amount_cents: Number(body.rent_amount_cents ?? 180_000),
      deposit_cents: body.deposit_cents as number | undefined,
      bedrooms: body.bedrooms as number | undefined,
      bathrooms: body.bathrooms as number | undefined,
      description: body.description as string | undefined,
      status: body.status as string | undefined,
    });
    return json(201, { listing: created });
  }

  const statusMatch = p.match(/^\/v1\/landlord\/listings\/([^/]+)\/status$/);
  if (method === 'POST' && statusMatch) {
    const updated = previewMutateListingStatus(statusMatch[1], String(body.status ?? 'active'));
    if (!updated) return json(404, { error: 'not_found' });
    return json(200, { id: updated.id, status: updated.status });
  }

  const putListing = p.match(/^\/v1\/landlord\/listings\/([0-9a-f-]{36}|ui-lst-[^/]+)$/i);
  if (method === 'PUT' && putListing) {
    const row = u.listings.find((l) => l.id === putListing[1]);
    if (!row) return json(404, { error: 'not_found' });
    if (typeof body.rent_amount_cents === 'number') row.rent_amount_cents = body.rent_amount_cents;
    if (typeof body.deposit_cents === 'number') row.deposit_cents = body.deposit_cents;
    if (typeof body.bedrooms === 'number') row.bedrooms = body.bedrooms;
    if (typeof body.bathrooms === 'number') row.bathrooms = body.bathrooms;
    if (typeof body.description === 'string') row.description = body.description;
    if (typeof body.status === 'string') row.status = body.status;
    return json(200, { listing: row });
  }

  const appsMatch = p.match(/^\/v1\/landlord\/listings\/([^/]+)\/applicants$/);
  if (method === 'GET' && appsMatch) {
    const hp = getPreviewHpSettings();
    const apps = u.applicants
      .filter((a) => a.listing_id === appsMatch[1])
      .map((a) => {
        const approved = a.status === 'approved';
        return {
          ...a,
          // Full contact only after approval. Pseudonym stays for queue display.
          contact: approved
            ? a.contact
            : a.contact
              ? {
                  given_name: a.contact.given_name,
                  family_name: a.contact.family_name
                    ? a.contact.family_name.slice(0, 1)
                    : null,
                  email: null,
                  phone_e164: null,
                }
              : null,
        };
      });
    return json(200, {
      listing_id: appsMatch[1],
      screening_mode: hp.screening_mode,
      applicants: apps,
    });
  }

  const photoMatch = p.match(/^\/v1\/landlord\/listings\/([^/]+)\/photos$/);
  if (method === 'POST' && photoMatch) {
    const row = u.listings.find((l) => l.id === photoMatch[1]);
    if (!row) return json(404, { error: 'not_found' });
    const ct = String(body.content_type ?? 'image/jpeg');
    const dataUrl = `data:${ct};base64,${String(body.file_base64 ?? '').slice(0, 80)}…`;
    row.photo_url = dataUrl;
    return json(200, { url: dataUrl, photo_url: dataUrl });
  }

  const decideMatch = p.match(
    /^\/v1\/landlord\/listings\/([^/]+)\/applicants\/([^/]+)\/decision$/,
  );
  if (method === 'POST' && decideMatch) {
    try {
      const result = previewDecide(
        decideMatch[1],
        decideMatch[2],
        String(body.decision ?? 'pass'),
        {
          reason_codes: Array.isArray(body.reason_codes)
            ? (body.reason_codes as string[])
            : undefined,
          missing_info_categories: Array.isArray(body.missing_info_categories)
            ? (body.missing_info_categories as string[])
            : undefined,
          note: body.note != null ? String(body.note) : undefined,
        },
      );
      if (!result) return json(404, { error: 'not_found' });
      return json(200, result);
    } catch (err) {
      return json(400, {
        error: 'validation_error',
        message: err instanceof Error ? err.message : 'decision_failed',
      });
    }
  }

  const criteriaMatch = p.match(/^\/v1\/landlord\/listings\/([^/]+)\/criteria$/);
  if (method === 'GET' && criteriaMatch) {
    return json(200, {
      listing_id: criteriaMatch[1],
      criteria: u.criteria[criteriaMatch[1]] ?? null,
    });
  }
  if (method === 'PUT' && criteriaMatch) {
    const criteria = previewPutCriteria(criteriaMatch[1], {
      jurisdiction: (body.jurisdiction as string | null | undefined) ?? null,
      rules: (body.rules as Record<string, unknown>) ?? {},
    });
    return json(200, { listing_id: criteriaMatch[1], criteria });
  }

  const applicantDetail = p.match(/^\/v1\/landlord\/applicants\/([^/]+)$/);
  if (method === 'GET' && applicantDetail) {
    const app = u.applicants.find((a) => a.application_id === applicantDetail[1]);
    if (!app) return json(404, { error: 'not_found' });
    const listing = u.listings.find((l) => l.id === app.listing_id);
    return json(200, {
      application_id: app.application_id,
      listing_id: app.listing_id,
      org_id: app.org_id ?? 'ui-org-oaks',
      status: app.status,
      created_at: app.created_at,
      display_name: app.renter_label ?? 'Applicant',
      profile: {
        move_in_urgency: 'within_30_days',
        household_size: app.household_size,
        has_pets: app.has_pets,
        preferred_state: listing?.state ?? 'TX',
        income_band: app.income_band,
        annual_income_cents: null,
      },
      intake_snapshot: null,
      criteria_version_id: u.criteria[app.listing_id]?.id ?? null,
      prequal_evaluation: {
        appears_to_meet: app.income_band === '3x+' || app.income_band === '2.5x',
        checks: [
          {
            key: 'income',
            label: 'Income-to-rent',
            result: app.income_band === '3x+' ? 'meets' : 'unknown',
            detail: `Self-reported band: ${app.income_band}`,
            self_reported: true,
          },
          {
            key: 'pets',
            label: 'Pets',
            result: app.has_pets ? 'does_not_meet' : 'meets',
            detail: app.has_pets ? 'Has pets' : 'No pets',
            self_reported: true,
          },
        ],
        evaluated_at: new Date().toISOString(),
      },
      screening_summary: app.screening_summary,
      missing_info_requests: u.missing_info[app.application_id] ?? [],
      broker_notes: u.notes[app.application_id] ?? [],
      broker_recommendation: u.recommendations[app.application_id] ?? null,
      broker_recommendation_at: null,
      activity: u.activity
        .filter((e) => e.href?.includes(app.application_id) || e.kind === 'applicant')
        .slice(0, 10)
        .map((e) => ({
          event_type: e.text,
          payload: {},
          occurred_at: new Date().toISOString(),
          actor_party_id: null,
        })),
      timestamps: {
        info_requested_at: null,
        move_forward_at: null,
        passed_at: null,
        contact_revealed_at: app.status === 'approved' ? app.created_at : null,
      },
      match_score_value: null,
      match_score_version: null,
      contact: app.status === 'approved' ? app.contact : null,
    });
  }

  if (method === 'GET' && p === '/v1/landlord/activity') {
    const category = url.searchParams.get('category');
    const items = u.activity
      .filter((e) => !category || category === 'all' || e.kind === category || e.text.toLowerCase().includes(category.toLowerCase()))
      .map((e) => ({
        event_type: e.text,
        aggregate_type: e.kind,
        aggregate_id: e.id,
        listing_id: e.href?.includes('/listings/') ? e.href.split('/').pop() ?? null : null,
        application_id: e.href?.includes('/applicants/')
          ? e.href.split('/').pop() ?? null
          : null,
        occurred_at: new Date().toISOString(),
        actor_party_id: null,
        payload: {},
      }));
    return json(200, { items, limit: 50, offset: 0 });
  }

  const leaseApp = p.match(
    /^\/v1\/landlord\/listings\/([^/]+)\/applicants\/([^/]+)\/lease$/,
  );
  if (method === 'POST' && leaseApp) {
    const doc = {
      id: `lease-${Date.now()}`,
      listing_id: leaseApp[1],
      application_id: leaseApp[2],
      original_filename: String(body.original_filename ?? 'lease.pdf'),
      content_type: String(body.content_type ?? 'application/pdf'),
      created_at: new Date().toISOString(),
      workflow_status: 'uploaded',
    };
    u.leases.unshift(doc);
    return json(201, doc);
  }
  const makeAvail = p.match(
    /^\/v1\/landlord\/listings\/([^/]+)\/applicants\/([^/]+)\/leases\/([^/]+)\/make-available$/,
  );
  if (method === 'POST' && makeAvail) {
    const doc = u.leases.find((l) => l.id === makeAvail[3]);
    if (!doc) return json(404, { error: 'not_found' });
    (doc as { workflow_status?: string }).workflow_status = 'available_to_renter';
    return json(200, doc);
  }
  if (method === 'GET' && /^\/v1\/renter\/applications\/[^/]+\/leases$/.test(p)) {
    const appId = p.split('/')[4];
    const leases = u.leases.filter(
      (l) =>
        l.application_id === appId &&
        ['available_to_renter', 'acknowledged', 'executed_copy_uploaded', 'complete'].includes(
          (l as { workflow_status?: string }).workflow_status ?? '',
        ),
    );
    return json(200, { application_id: appId, leases });
  }
  if (method === 'POST' && /^\/v1\/renter\/applications\/[^/]+\/leases\/[^/]+\/acknowledge$/.test(p)) {
    const docId = p.split('/')[6];
    const doc = u.leases.find((l) => l.id === docId);
    if (!doc) return json(404, { error: 'not_found' });
    (doc as { workflow_status?: string }).workflow_status = 'acknowledged';
    return json(200, doc);
  }
  if (method === 'GET' && /^\/v1\/renter\/applications\/[^/]+\/leases\/[^/]+\/download-url$/.test(p)) {
    return json(200, {
      url: 'https://example.com/preview-lease.pdf',
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    });
  }
  if (method === 'POST' && /^\/v1\/landlord\/broker-invitations\/[^/]+\/accept$/.test(p)) {
    const id = p.split('/')[4];
    const inv = u.invitations.find((i) => i.id === id);
    if (inv) (inv as { status: string }).status = 'accepted';
    return json(200, {
      invitation: inv ?? { id, status: 'accepted' },
      delegation: { id: `del-${Date.now()}`, status: 'accepted' },
    });
  }
  if (method === 'GET' && p === '/v1/landlord/broker-invitations') {
    return json(200, {
      invitations: u.invitations.filter((i) =>
        ['pending', 'delivered'].includes((i as { status?: string }).status ?? 'pending'),
      ),
    });
  }
  if (method === 'POST' && /^\/v1\/broker\/delegations\/[^/]+\/revoke$/.test(p)) {
    return json(200, {
      delegation: { provider_org_id: p.split('/')[4], status: 'revoked' },
    });
  }
  if (method === 'POST' && p === '/v1/attribution/visit') {
    return json(200, {
      visitor_key: String(body.visitor_key ?? `vk_preview_${Date.now()}`),
      partner_org_id: null,
      campaign_id: null,
    });
  }
  if (method === 'GET' && leaseApp) {
    const leases = u.leases.filter(
      (l) => l.listing_id === leaseApp[1] && l.application_id === leaseApp[2],
    );
    return json(200, {
      listing_id: leaseApp[1],
      application_id: leaseApp[2],
      leases,
    });
  }

  const leasesList = p.match(/^\/v1\/landlord\/listings\/([^/]+)\/leases$/);
  if (method === 'GET' && leasesList) {
    const leases = u.leases.filter((l) => l.listing_id === leasesList[1]);
    return json(200, {
      listing_id: leasesList[1],
      application_id: null,
      leases,
    });
  }

  if (method === 'GET' && p === '/v1/renter/saved') {
    const saved = u.saved.map((listingId) => {
      const listing = u.listings.find((l) => l.id === listingId);
      return {
        listing_id: listingId,
        created_at: new Date().toISOString(),
        status: listing?.status ?? 'active',
        rent_amount_cents: listing?.rent_amount_cents ?? 0,
        address_line1: listing?.line1 ?? null,
        city: listing?.city ?? null,
        state: listing?.state ?? null,
      };
    });
    return json(200, { saved });
  }
  if (method === 'POST' && p === '/v1/renter/saved') {
    const listingId = String(body.listing_id ?? '');
    if (!u.saved.includes(listingId)) u.saved.push(listingId);
    return json(201, { listing_id: listingId, created_at: new Date().toISOString() });
  }
  if (method === 'DELETE' && p === '/v1/renter/saved') {
    const listingId = String(body.listing_id ?? '');
    u.saved = u.saved.filter((id) => id !== listingId);
    return json(200, { removed: true });
  }

  if (method === 'GET' && p === '/v1/renter/support-cases') {
    return json(200, { cases: u.support_cases });
  }
  if (method === 'POST' && p === '/v1/renter/support-cases') {
    const created = {
      id: `sup-${Date.now()}`,
      category: String(body.category ?? 'account'),
      subject: String(body.subject ?? ''),
      description: String(body.description ?? ''),
      status: 'open',
      related_listing_id: (body.related_listing_id as string) ?? null,
      related_application_id: (body.related_application_id as string) ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    u.support_cases.unshift(created);
    return json(201, created);
  }

  if (method === 'GET' && p === '/v1/renter/screening-center') {
    return json(200, {
      applications: u.applicants.slice(0, 5).map((a) => ({
        application_id: a.application_id,
        listing_id: a.listing_id,
        status: a.status,
        reports:
          a.status === 'screening_complete' || a.status === 'approved'
            ? [
                {
                  report_kind: 'credit',
                  status: a.screening_summary.credit,
                  issued_at: a.created_at,
                },
                {
                  report_kind: 'identity',
                  status: a.screening_summary.identity,
                  issued_at: a.created_at,
                },
              ]
            : [],
      })),
      ny_submissions: [],
      cashback: u.cashback,
    });
  }

  if (method === 'GET' && p === '/v1/renter/cashback') {
    return json(200, {
      offer_version_note:
        '[PLACEHOLDER] display_v1 cashback is a display offer only — funding pending business decision.',
      eligibility: u.cashback,
    });
  }

  const missingInfo = p.match(
    /^\/v1\/renter\/applications\/([^/]+)\/missing-info-response$/,
  );
  if (method === 'POST' && missingInfo) {
    const app = u.applicants.find((a) => a.application_id === missingInfo[1]);
    if (!app) return json(404, { error: 'not_found' });
    const open = (u.missing_info[app.application_id] ?? []).find((r) => r.status === 'open');
    if (!open) return json(404, { error: 'missing_info_not_found' });
    open.status = 'responded';
    open.renter_response = String(body.response ?? '');
    open.responded_at = new Date().toISOString();
    app.status = 'awaiting_landlord_interest';
    return json(200, { request_id: open.id, status: 'responded' });
  }

  if (method === 'POST' && p === '/v1/broker/invitations') {
    try {
      return json(201, previewInvite(
        String(body.contact_email ?? body.email ?? 'invitee@example.com'),
        body.business_name != null ? String(body.business_name) : undefined,
        body.note != null ? String(body.note) : undefined,
      ));
    } catch (err) {
      return json(400, { error: err instanceof Error ? err.message : 'invite_failed' });
    }
  }

  if (method === 'GET' && p === '/v1/landlord/settings') {
    const hp = getPreviewHpSettings();
    return json(200, { screening_mode: hp.screening_mode, organization: hp.organization });
  }
  if (method === 'PUT' && p === '/v1/landlord/settings') {
    const current = getPreviewHpSettings();
    const mode =
      body.screening_mode === 'auto_screen' || body.screening_mode === 'manual_review'
        ? body.screening_mode
        : current.screening_mode;
    const next = savePreviewHpSettings({ ...current, screening_mode: mode });
    u.activity.unshift({
      id: `act-${Date.now()}`,
      kind: 'settings',
      text: `Screening preference → ${next.screening_mode}`,
      when: 'just now',
      href: '/settings',
    });
    return json(200, { screening_mode: next.screening_mode });
  }

  if (method === 'GET' && p === '/v1/broker/portfolio') {
    return json(200, {
      managed_providers: 2,
      listings: u.listings.length,
      open_applicants: u.applicants.filter((a) => !['approved', 'declined'].includes(a.status))
        .length,
      screenings: u.applicants.filter((a) =>
        ['awaiting_consent', 'screening_running', 'screening_complete'].includes(a.status),
      ).length,
      needs_attention: [
        {
          id: 'ui-app-awaiting-consent',
          kind: 'screening',
          label: 'Sam P. awaiting consent',
          href: '/broker/applicants',
        },
        {
          id: 'ui-app-complete',
          kind: 'review',
          label: 'Casey B. ready to review',
          href: '/broker/applicants',
        },
      ],
    });
  }

  if (method === 'GET' && p === '/v1/broker/providers') {
    return json(200, {
      providers: [
        {
          org_id: 'ui-org-oaks',
          display_name: 'Preview Oaks LLC',
          legal_name: 'Preview Oaks LLC',
          status: 'active',
          active_listings: u.listings.filter((l) => l.status === 'active').length,
          open_applications: 4,
          screenings: 3,
        },
        {
          org_id: 'ui-org-invited',
          display_name: 'Invited Provider (pending)',
          legal_name: 'Invited Provider LLC',
          status: 'invited',
          active_listings: 0,
          open_applications: 0,
          screenings: 0,
        },
      ],
    });
  }

  const providerDetail = p.match(/^\/v1\/broker\/providers\/([^/]+)$/);
  if (method === 'GET' && providerDetail) {
    return json(200, {
      provider: {
        org_id: providerDetail[1],
        display_name: 'Preview Oaks LLC',
        legal_name: 'Preview Oaks LLC',
        status: 'active',
        active_listings: 2,
        open_applications: 4,
        screenings: 3,
      },
      listings: u.listings,
      applicants: u.applicants,
    });
  }

  if (method === 'GET' && p === '/v1/broker/portfolio/listings') {
    return json(200, {
      listings: u.listings.map((l) => ({
        ...l,
        org_id: 'ui-org-oaks',
        provider_name: 'Preview Oaks LLC',
        screening_count: u.applicants.filter(
          (a) =>
            a.listing_id === l.id &&
            ['awaiting_consent', 'screening_running', 'screening_complete'].includes(a.status),
        ).length,
      })),
    });
  }

  if (method === 'GET' && p === '/v1/broker/portfolio/applicants') {
    return json(200, { applicants: u.applicants });
  }

  const brokerApp = p.match(/^\/v1\/broker\/applications\/([^/]+)$/);
  if (method === 'GET' && brokerApp) {
    const app = u.applicants.find((a) => a.application_id === brokerApp[1]);
    if (!app) return json(404, { error: 'not_found' });
    return json(200, {
      ...app,
      can_request_screening: ['interested', 'submitted'].includes(app.status),
      notes: u.notes[app.application_id] ?? [],
      recommendation: u.recommendations[app.application_id] ?? null,
      recommendation_at: null,
    });
  }

  const brokerNote = p.match(/^\/v1\/broker\/applications\/([^/]+)\/notes$/);
  if (method === 'POST' && brokerNote) {
    return json(200, previewAddNote(brokerNote[1], String(body.note ?? '')));
  }

  const brokerRec = p.match(/^\/v1\/broker\/applications\/([^/]+)\/recommendation$/);
  if (method === 'POST' && brokerRec) {
    return json(
      200,
      previewSetRecommendation(
        brokerRec[1],
        (body.recommendation as 'approve' | 'decline' | null) ?? null,
      ),
    );
  }

  const brokerScreen = p.match(/^\/v1\/broker\/applications\/([^/]+)\/request-screening$/);
  if (method === 'POST' && brokerScreen) {
    const app = u.applicants.find((a) => a.application_id === brokerScreen[1]);
    if (!app) return json(404, { error: 'not_found' });
    app.status = 'awaiting_consent';
    app.screening_status = 'awaiting_consent';
    return json(200, { application_id: app.application_id, status: app.status });
  }

  if (method === 'GET' && p === '/v1/renter/applications') {
    return json(200, {
      applications: u.applicants.slice(0, 5).map((a) => ({
        application_id: a.application_id,
        listing_id: a.listing_id,
        status: a.status,
        created_at: a.created_at,
        listing: {
          id: a.listing_id,
          line1: a.listing_label,
          city: 'Austin',
          state: 'TX',
          rent_amount_cents: 185_000,
        },
      })),
    });
  }

  const screeningElig = p.match(/^\/v1\/applications\/([^/]+)\/screening-eligibility$/);
  if (method === 'GET' && screeningElig) {
    const paidElsewhere = u.applicants.some(
      (a) =>
        a.application_id !== screeningElig[1] &&
        [
          'screening_authorized',
          'screening_running',
          'screening_complete',
          'approved',
          'declined',
        ].includes(a.status),
    );
    return json(200, {
      application_id: screeningElig[1],
      reusable: paidElsewhere,
      fee_cents: paidElsewhere ? 0 : 2900,
      fee_cents_if_new: 2900,
      reason: paidElsewhere ? 'prior_paid_screening' : 'none',
      expires_at: null,
      message: paidElsewhere
        ? 'An eligible prior screening can be reused. You still must authorize this Home Provider. No additional fee.'
        : 'A screening fee applies for your first eligible report.',
    });
  }

  const payConsent = p.match(/^\/v1\/applications\/([^/]+)\/pay-consent$/);
  if (method === 'POST' && payConsent) {
    const app = u.applicants.find((a) => a.application_id === payConsent[1]);
    if (!app) return json(404, { error: 'not_found', message: 'Application not found' });
    const alreadyPaid = u.applicants.some(
      (a) =>
        a.application_id !== app.application_id &&
        ['screening_authorized', 'screening_running', 'screening_complete', 'approved', 'declined'].includes(
          a.status,
        ),
    );
    app.status = 'screening_authorized';
    app.screening_status = 'authorized';
    return json(200, {
      status: app.status,
      fee_cents: alreadyPaid ? 0 : 2900,
      reused_existing_report: alreadyPaid,
      preview: true,
      message: alreadyPaid
        ? 'Authorization recorded. Existing screening reused — no additional charge (preview).'
        : 'Authorization and screening fee recorded (preview — no live charge).',
    });
  }

  if (method === 'POST' && p === '/v1/renter/account/deletion-request') {
    const id = `del-${Date.now()}`;
    (u as { deletion?: { id: string; status: string; created_at: string } }).deletion = {
      id,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    return json(201, {
      request_id: id,
      status: 'pending',
      message:
        'Deletion request received (preview). Retained records are not wiped. No external write.',
    });
  }
  if (method === 'GET' && p === '/v1/renter/account/deletion-request') {
    const del = (u as { deletion?: { id: string; status: string; created_at: string } }).deletion;
    return json(200, { request: del ?? null });
  }

  if (method === 'GET' && (p === '/v1/renter/profile' || p === '/v1/renter/intake')) {
    return json(200, {
      given_name: 'UI',
      family_name: 'Preview',
      email: 'ui-preview@localhost',
      phone_e164: '+15125550000',
      household_size: 1,
      has_pets: false,
      income_band: '3x+',
      move_in_window: '30_days',
    });
  }

  if (method === 'PUT' && (p === '/v1/renter/profile' || p === '/v1/renter/intake')) {
    return json(200, { ok: true, ...body });
  }

  if (method === 'POST' && p === '/v1/broker/invite') {
    try {
      return json(200, {
        invitation: previewInvite(
          String(body.email ?? 'invitee@example.com'),
          body.business_name != null ? String(body.business_name) : undefined,
          body.note != null ? String(body.note) : undefined,
        ),
      });
    } catch (err) {
      return json(400, { error: err instanceof Error ? err.message : 'invite_failed' });
    }
  }

  if (method === 'POST' && /^\/v1\/broker\/invitations\/[^/]+\/cancel$/.test(p)) {
    const id = p.split('/')[4]!;
    try {
      const invitation = previewCancelInvite(id);
      if (!invitation) return json(404, { error: 'not_found' });
      return json(200, { invitation });
    } catch (err) {
      return json(400, { error: err instanceof Error ? err.message : 'cancel_failed' });
    }
  }

  if (method === 'POST' && /^\/v1\/broker\/invitations\/[^/]+\/resend$/.test(p)) {
    const id = p.split('/')[4]!;
    try {
      const invitation = previewResendInvite(id);
      if (!invitation) return json(404, { error: 'not_found' });
      return json(200, { invitation });
    } catch (err) {
      return json(400, { error: err instanceof Error ? err.message : 'resend_failed' });
    }
  }

  if (method === 'GET' && p === '/v1/broker/invitations') {
    return json(200, { invitations: u.invitations });
  }

  if (method === 'GET' && p === '/health/live') {
    return json(200, { status: 'healthy', preview: true });
  }

  // Unknown reads → empty-ish safe response; mutations blocked
  if (method === 'GET') {
    return json(200, { preview: true, unavailable: true, path: p });
  }

  return json(403, {
    error: 'ui_preview_blocked',
    message: `Preview adapter has no handler for ${method} ${p}. Live mutation blocked.`,
  });
}
