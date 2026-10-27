/**
 * API client — same-origin (CloudFront proxies /v1 to ALB).
 * Session cookie is HttpOnly. A tab-memory session id is sent only as a legacy bearer fallback.
 */
export type ApiErrorBody = { error?: string; message?: string };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let memorySessionId: string | null = null;

export function setMemorySessionId(id: string | null): void {
  memorySessionId = id;
}

export function getMemorySessionId(): string | null {
  return memorySessionId;
}

function apiBase(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return raw?.trim() ? raw.replace(/\/$/, '') : '';
}

export type PartnerIntake = {
  id: string;
  role: 'landlord' | 'broker';
  status: 'new' | 'under_review' | 'approved' | 'rejected';
  full_name: string;
  email: string;
  phone: string;
  organization_name: string;
  market: string;
  portfolio_size: string;
  property_types: string | null;
  notes: string | null;
  org_id: string | null;
};

export type SavedListing = {
  listing_id: string;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  rent_amount_cents: number;
};

export type Listing = {
  id: string;
  rent_amount_cents: number;
  deposit_cents: number | null;
  bedrooms: number | string | null;
  bathrooms: number | string | null;
  sqft: number | null;
  property_type?: string | null;
  available_on: string | null;
  lease_term_months: number | null;
  description: string | null;
  cashback_cents?: number | null;
  media?: Array<{ url: string }> | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    raw_input: string | null;
  };
};

export type RenterProfile = {
  party_id: string;
  given_name: string | null;
  family_name: string | null;
  phone_e164: string | null;
  email: string | null;
  annual_income_cents: number | null;
  move_in_urgency: string | null;
  bedrooms_min: number | null;
  rent_max_cents: number | null;
  preferred_state: string | null;
  has_pets: boolean | null;
  household_size: number | null;
  updated_at: string;
};

async function request<T>(
  path: string,
  init: RequestInit & { accessToken?: string; sessionId?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (init.accessToken) {
    headers.set('Authorization', `Bearer ${init.accessToken}`);
  } else if (init.sessionId || memorySessionId) {
    headers.set('Authorization', `Bearer ${init.sessionId ?? memorySessionId}`);
  }

  const { accessToken: _a, sessionId: _s, ...rest } = init;
  void _a;
  void _s;

  const res = await fetch(`${apiBase()}${path}`, {
    ...rest,
    headers,
    credentials: 'include',
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }
  if (!res.ok) {
    const err = (body ?? {}) as ApiErrorBody;
    throw new ApiError(
      res.status,
      err.error ?? 'request_failed',
      err.message ?? `Request failed (${res.status})`,
    );
  }
  return body as T;
}

export const api = {
  listListings: (limit = 20, offset = 0) =>
    request<{ listings: Listing[]; pagination: { total: number; limit: number; offset: number } }>(
      `/v1/listings?limit=${limit}&offset=${offset}`,
    ),
  getListing: (id: string) => request<{ listing: Listing }>(`/v1/listings/${id}`),
  savedListings: () => request<{ saved: SavedListing[] }>('/v1/renter/saved'),
  myPartnerIntake: (role: 'landlord' | 'broker') =>
    request<{ intake: PartnerIntake | null }>(`/v1/partner-intakes/${role}`),
  submitPartnerIntake: (
    role: 'landlord' | 'broker',
    body: {
      full_name: string;
      email: string;
      phone: string;
      organization_name: string;
      market: string;
      portfolio_size: string;
      property_types?: string;
      notes?: string;
    },
  ) =>
    request<{ intake: PartnerIntake }>(`/v1/partner-intakes/${role}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminPartnerIntakes: (status = '') =>
    request<{ items: PartnerIntake[] }>(
      `/v1/admin/partner-intakes${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    ),
  adminDecidePartnerIntake: (id: string, decision: 'under_review' | 'approved' | 'rejected') =>
    request<{ intake: PartnerIntake }>(`/v1/admin/partner-intakes/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
  createApplication: (listingId: string) =>
    request<{
      application_id: string;
      listing_id: string;
      status: string;
      access_token: string;
      access_token_expires_at: string;
    }>('/v1/applications', {
      method: 'POST',
      body: JSON.stringify({ listing_id: listingId }),
    }),
  expressInterest: (listingId: string) =>
    request<{
      application_id: string;
      listing_id: string;
      status: string;
      access_token: string;
      access_token_expires_at: string;
      reused?: boolean;
      match_score_value?: number;
      match_score_version?: string;
    }>('/v1/renter/interest', {
      method: 'POST',
      body: JSON.stringify({ listing_id: listingId }),
    }),
  getRenterIntake: () =>
    request<{
      intake: Record<string, unknown> | null;
      complete: boolean;
      profile: RenterProfile | null;
    }>('/v1/renter/intake'),
  upsertRenterIntake: (body: Record<string, unknown>) =>
    request<{ intake: Record<string, unknown> }>('/v1/renter/intake', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getApplicationDetails: (applicationId: string) =>
    request<{
      application_id: string;
      listing_id: string | null;
      status: string;
      snapshot: unknown;
      live_intake: Record<string, unknown> | null;
      snapshot_is_frozen: boolean;
    }>(`/v1/renter/applications/${applicationId}/details`),
  getApplication: (id: string, accessToken: string) =>
    request<{
      application_id: string;
      status: string;
      screening: { status: string | null; order_id: string | null };
    }>(`/v1/applications/${id}`, { accessToken }),
  listMyApplications: () =>
    request<{
      applications: Array<{
        application_id: string;
        status: string;
        listing_id: string | null;
        created_at: string;
        listing: {
          line1: string | null;
          city: string | null;
          state: string | null;
          rent_amount_cents: number | null;
        } | null;
      }>;
    }>('/v1/renter/applications'),
  payAndConsent: (
    id: string,
    body: { agreed: true; ny_path2?: boolean; payment_intent_id?: string },
    accessToken?: string,
  ) =>
    request<{
      application_id: string;
      consent_id: string;
      fee_cents: number;
      status: string;
    }>(`/v1/applications/${id}/pay-consent`, {
      method: 'POST',
      accessToken,
      body: JSON.stringify(body),
    }),
  stripePaymentConfig: () =>
    request<{
      mode: 'disabled' | 'test' | 'live';
      sandbox: boolean;
      publishable_key: string | null;
    }>('/v1/payments/stripe/config'),
  createSandboxPaymentIntent: (body: {
    purpose: 'applicant_screening_fee' | 'ny_path2_screening';
    application_id?: string;
  }) =>
    request<{
      payment_intent_id: string;
      client_secret: string;
      amount_cents: number;
      sandbox: true;
      mode: 'test';
    }>('/v1/payments/stripe/payment-intent', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** @deprecated Free consent is rejected (402). Use payAndConsent. */
  recordConsent: (id: string, accessToken: string) =>
    request<{ application_id: string; disclosure_version: string; consent_id: string }>(
      `/v1/applications/${id}/consent`,
      { method: 'POST', accessToken, body: '{}' },
    ),
  submitScreening: (
    id: string,
    accessToken: string,
    body?: { stated_monthly_income_cents?: number },
  ) =>
    request<{ application_id: string; status: string; screening_order_id: string }>(
      `/v1/applications/${id}/submit-screening`,
      { method: 'POST', accessToken, body: JSON.stringify(body ?? {}) },
    ),
  getRenterProfile: () => request<{ profile: RenterProfile }>('/v1/renter/profile'),
  upsertRenterProfile: (body: Record<string, unknown>) =>
    request<{ profile: RenterProfile }>('/v1/renter/profile', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  screeningFee: (state?: string) =>
    request<{
      fee: {
        amount_cents: number;
        state: string | null;
        default_cents: number;
        capped: boolean;
        note: string | null;
      };
    }>(`/v1/config/screening-fee${state ? `?state=${encodeURIComponent(state)}` : ''}`),
  consentCopy: () =>
    request<{ consent: { key: string; text: string; is_placeholder: boolean } }>(
      '/v1/config/consent-copy',
    ),
  screeningChoice: () =>
    request<{
      state: string | null;
      report: {
        id: string;
        report_source: string;
        completed_at: string;
        fresh: boolean;
        compliance_tag: string | null;
      } | null;
      path2_fee: { amount_cents: number };
      path2_tag: string;
    }>('/v1/renter/screening-choice'),
  uploadNyReport: (body: {
    completed_at: string;
    original_filename?: string;
    content_type?: string;
    storage_key?: string;
  }) =>
    request<{ report: { id: string; report_source: string; fresh: boolean } }>(
      '/v1/renter/screening-reports',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  purchaseNyPath2: (paymentIntentId?: string) =>
    request<{ fee_cents: number; tag: string; report: { id: string } }>(
      '/v1/renter/screening-path2',
      {
        method: 'POST',
        body: JSON.stringify({ agreed: true, payment_intent_id: paymentIntentId }),
      },
    ),
  magicLink: (email: string, purpose: 'sign_in' | 'landlord_sign_in' | 'broker_sign_in') =>
    request<{ ok: true; message: string; redeem_token?: string }>('/v1/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email, purpose }),
    }),
  emailCode: (
    email: string,
    purpose: 'sign_in' | 'landlord_sign_in' | 'broker_sign_in',
    rememberDevice = false,
  ) =>
    request<{
      ok: true;
      message: string;
      delivered: boolean;
      retryAfterSeconds: number;
      expiresInSeconds: number;
      debug_code?: string;
    }>('/v1/auth/email-code', {
      method: 'POST',
      body: JSON.stringify({ email, purpose, rememberDevice }),
    }),
  verifyEmailCode: (
    email: string,
    code: string,
    purpose: 'sign_in' | 'landlord_sign_in' | 'broker_sign_in',
    rememberDevice = false,
  ) =>
    request<{ ok: true; authenticated: true; session_id: string; party_id: string }>(
      '/v1/auth/email-code/verify',
      {
        method: 'POST',
        body: JSON.stringify({ email, code, purpose, rememberDevice }),
      },
    ),
  redeem: (token: string, purpose: 'sign_in' | 'landlord_sign_in' | 'broker_sign_in') =>
    request<{ session_id: string; party_id: string }>('/v1/auth/redeem', {
      method: 'POST',
      body: JSON.stringify({ token, purpose }),
    }),
  me: () =>
    request<{
      party_id: string;
      session_id: string;
      roles: Array<{ role: string; org_id: string | null }>;
      landlord_org_id: string | null;
      broker_org_id: string | null;
    }>('/v1/auth/me'),
  logout: () => request<{ ok: true }>('/v1/auth/logout', { method: 'POST', body: '{}' }),
  landlordListings: () =>
    request<{
      listings: Array<{
        id: string;
        status: string;
        rent_amount_cents: number;
        deposit_cents: number | null;
        pets_allowed: boolean | null;
        amenities: string[];
        available_on: string | null;
        bedrooms: number | null;
        bathrooms: number | null;
        sqft: number | null;
        property_type: string | null;
        line1: string | null;
        city: string | null;
        state: string | null;
        applicant_count: number;
        days_vacant: number;
        photo_url: string | null;
      }>;
    }>('/v1/landlord/listings'),
  landlordCreateListing: (body: Record<string, unknown>) =>
    request<{ listing_id: string; status: string }>('/v1/landlord/listings', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  landlordUpdateListing: (id: string, body: Record<string, unknown>) =>
    request<{ id: string; status: string }>(`/v1/landlord/listings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  landlordSetStatus: (id: string, status: 'active' | 'paused' | 'draft' | 'rented') =>
    request<{ id: string; status: string }>(`/v1/landlord/listings/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
  landlordUploadPhoto: (id: string, body: { content_type: string; filename?: string; file_base64: string }) =>
    request<{ url: string; storage_key: string }>(`/v1/landlord/listings/${id}/photos`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  landlordSettings: () =>
    request<{ screening_mode: 'auto_screen' | 'manual_review' }>('/v1/landlord/settings'),
  landlordUpdateSettings: (screening_mode: 'auto_screen' | 'manual_review') =>
    request<{ screening_mode: 'auto_screen' | 'manual_review' }>('/v1/landlord/settings', {
      method: 'PUT',
      body: JSON.stringify({ screening_mode }),
    }),
  landlordApplicants: (listingId: string) =>
    request<{
      listing_id: string;
      screening_mode: 'auto_screen' | 'manual_review';
      applicants: Array<{
        application_id: string;
        status: string;
        created_at: string;
        score_band: string;
        income_band: string;
        move_in_urgency: string | null;
        household_size: number | null;
        has_pets: boolean | null;
        match_score_value?: number | null;
        match_score_version?: string | null;
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
      }>;
    }>(`/v1/landlord/listings/${listingId}/applicants`),
  landlordDecide: (
    listingId: string,
    applicationId: string,
    body: { decision: string; note?: string },
  ) =>
    request<{ application_id: string; status: string; contact_revealed_at: string | null }>(
      `/v1/landlord/listings/${listingId}/applicants/${applicationId}/decision`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  landlordSelfExecution: () =>
    request<{
      submission: null | {
        id: string;
        status: string;
        license_type: string;
        license_state: string;
        compliance_tag: string;
        created_at: string;
        reviewer_notes: string | null;
      };
      compliance_tag: string;
      admin_banner: string | null;
    }>('/v1/landlord/settings/self-execution'),
  landlordSubmitSelfExecution: (body: Record<string, unknown>) =>
    request<{ id: string; status: string; compliance_tag: string }>(
      '/v1/landlord/settings/self-execution',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  brokerOverview: () =>
    request<{
      broker_org_id: string;
      balance_cents: number;
      broker_payouts_enabled: boolean;
      funding: { available: boolean; reason: string };
      lead_purchase: { available: boolean; reason: string };
      payouts: { available: boolean; reason: string };
      connect: { status: string; account_id: string | null };
    }>('/v1/broker/overview'),
  brokerPerformance: (windowDays: 30 | 60 | 90) =>
    request<{
      leads_offered: number;
      leads_accepted: number;
      acceptance_rate: number;
      placements_closed: number;
      close_rate: number;
      median_response_seconds: number | null;
      leakage_rate: number;
      dispute_count: number;
      ev_per_lead: number;
      window_days: number;
      rank_in_submarket: number | null;
      best_performing_submarket: string | null;
      trend: Record<string, unknown>;
    }>(`/v1/broker/performance?window_days=${windowDays}`),
  brokerLeads: (params: {
    page?: number;
    status?: string;
    from?: string;
    to?: string;
  }) => {
    const q = new URLSearchParams();
    if (params.page) q.set('page', String(params.page));
    if (params.status) q.set('status', params.status);
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    const qs = q.toString();
    return request<{
      items: Array<{
        lead_id: string;
        rs_tier: string;
        fee_amount_cents: number;
        offered_at: string;
        status: string;
        placement_status: string | null;
        resolution: string;
      }>;
      total: number;
      page: number;
      page_size: number;
    }>(`/v1/broker/leads${qs ? `?${qs}` : ''}`);
  },
  brokerSubmarkets: (windowDays: 30 | 60 | 90) =>
    request<{
      window_days: number;
      submarkets: Array<{
        submarket_id: string;
        name: string;
        leads_offered: number;
        leads_accepted: number;
        placements_closed: number;
        close_rate: number | null;
        median_response_seconds: number | null;
      }>;
    }>(`/v1/broker/submarkets?window_days=${windowDays}`),
  connectAccount: () =>
    request<{
      account_id: string | null;
      status: string;
      charges_enabled: boolean;
      payouts_enabled: boolean;
      details_submitted: boolean;
      broker_payouts_enabled: boolean;
    }>('/v1/stripe/connect/account'),
  connectCreateAccount: () =>
    request<{
      account_id: string | null;
      status: string;
      charges_enabled: boolean;
      payouts_enabled: boolean;
      details_submitted: boolean;
      broker_payouts_enabled: boolean;
    }>('/v1/stripe/connect/account', { method: 'POST', body: '{}' }),
  connectOnboardingLink: () =>
    request<{ url: string; account_id: string }>('/v1/stripe/connect/onboarding-link', {
      method: 'POST',
      body: '{}',
    }),
  connectDashboardLink: () =>
    request<{ url: string; account_id: string }>('/v1/stripe/connect/dashboard-link'),

  adminUsers: (q = '') =>
    request<{ items: unknown[]; total: number }>(
      `/v1/admin/users?q=${encodeURIComponent(q)}&limit=50`,
    ),
  adminAssignRole: (body: { party_id: string; role: string; org_id?: string | null }) =>
    request<unknown>('/v1/admin/users/roles', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminOrgs: (q = '') =>
    request<{ items: Array<Record<string, unknown>>; total: number }>(
      `/v1/admin/orgs?q=${encodeURIComponent(q)}&limit=50`,
    ),
  adminOrgFlags: (orgId: string, broker_payouts_enabled: boolean) =>
    request<unknown>(`/v1/admin/orgs/${orgId}/flags`, {
      method: 'PUT',
      body: JSON.stringify({ broker_payouts_enabled }),
    }),
  adminConsent: () =>
    request<{
      key: string;
      text: string;
      version?: string | null;
      change_log?: unknown[];
    }>('/v1/admin/config/consent'),
  adminPutConsent: (text: string) =>
    request<unknown>('/v1/admin/config/consent', {
      method: 'PUT',
      body: JSON.stringify({ text }),
    }),
  adminCertn: () => request<Record<string, unknown>>('/v1/admin/integrations/certn'),
  adminSelfExecution: (status = 'pending') =>
    request<{ items: Array<Record<string, unknown>>; total: number }>(
      `/v1/admin/reviews/self-execution?status=${encodeURIComponent(status)}`,
    ),
  adminDecideSelfExecution: (
    id: string,
    body: { decision: 'verify' | 'reject'; notes?: string },
  ) =>
    request<unknown>(`/v1/admin/reviews/self-execution/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminFlags: () =>
    request<{ flags: Array<Record<string, unknown>>; note?: string }>(
      '/v1/admin/config/flags',
    ),
  adminSetFlag: (name: string, enabled: boolean) =>
    request<unknown>(`/v1/admin/config/flags/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  adminAudit: (params: Record<string, string>) => {
    const q = new URLSearchParams(params);
    return request<{ items: Array<Record<string, unknown>>; total: number }>(
      `/v1/admin/audit?${q.toString()}`,
    );
  },
  adminAuditCsvUrl: (params: Record<string, string>) => {
    const q = new URLSearchParams({ ...params, format: 'csv' });
    return `/v1/admin/audit?${q.toString()}`;
  },
};
