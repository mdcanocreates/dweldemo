import type { MeResponse, MagicLinkPurpose, PartyRole } from '../types';
import { getPartyRole } from '../lib/user-flow-store';
import { isUiPreviewActive } from '../lib/ui-preview';
import { tryUiPreviewRequest } from '../lib/ui-preview-api';

const SESSION_KEY = 'dwel.session_token';

export function getSessionToken(): string | null {
  if (isUiPreviewActive()) return 'ui-preview-session';
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function mapAuthError(status: number, code?: string, fallback?: string): string {
  if (status === 400 || code === 'validation_error') {
    return 'Enter a valid email address.';
  }
  if (status === 403 || code === 'auth_email_not_allowlisted') {
    return 'This email address is not allowed to receive sign-in links in this environment.';
  }
  if (status === 503 || code === 'auth_email_allowlist_missing') {
    return 'Sign-in email is not configured for this environment. Contact support.';
  }
  if (status === 429) {
    return 'Too many sign-in requests. Try again in a few minutes.';
  }
  if (status === 0) {
    return "Dwel couldn't reach the sign-in service.";
  }
  if (status === 502 || code === 'magic_link_email_failed' || status >= 500) {
    return "We couldn't send the sign-in email. Please try again.";
  }
  return fallback || 'Could not start sign-in. Please try again.';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Local UI inspection: serve in-memory adapters; never hit live protected APIs.
  if (isUiPreviewActive()) {
    const preview = tryUiPreviewRequest(path, init);
    if (preview) {
      if (preview.status >= 400) {
        const errBody = preview.body as { message?: string; error?: string };
        throw new ApiError(
          errBody.message ?? errBody.error ?? 'Preview request blocked',
          preview.status,
          errBody.error,
        );
      }
      return preview.body as T;
    }
  }

  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getSessionToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: 'include' });
  } catch (err) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug('[Dwel Auth]', {
        requestURL: path,
        status: 0,
        error: err instanceof Error ? err.message : 'network_error',
      });
    }
    throw new ApiError("Dwel couldn't reach the sign-in service.", 0, 'network_error');
  }

  if (!res.ok) {
    let message = 'Request failed';
    let code: string | undefined;
    let rawBody: unknown;
    try {
      rawBody = await res.json();
      const body = rawBody as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
      code = body.error;
    } catch {
      try {
        rawBody = await res.text();
      } catch {
        /* ignore */
      }
    }

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug('[Dwel Auth]', {
        requestURL: path,
        method: init?.method ?? 'GET',
        status: res.status,
        code,
        responseBody: rawBody,
      });
    }

    const isAuthPath = path.includes('/auth/');
    throw new ApiError(
      isAuthPath ? mapAuthError(res.status, code, message) : message,
      res.status,
      code,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  magicLink: (email: string, purpose: MagicLinkPurpose = 'sign_in') =>
    request<{ ok: true; message: string; redeem_token?: string }>('/v1/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify({
        email,
        purpose:
          purpose === 'admin_sign_in'
            ? 'sign_in'
            : purpose === 'broker_sign_in'
              ? 'broker_sign_in'
              : purpose,
      }),
    }),

  redeem: (
    token: string,
    purpose: MagicLinkPurpose = 'sign_in',
    opts?: { visitor_key?: string | null },
  ) =>
    request<{ session_id: string; party_id: string }>('/v1/auth/redeem', {
      method: 'POST',
      body: JSON.stringify({
        token,
        purpose:
          purpose === 'admin_sign_in'
            ? 'sign_in'
            : purpose === 'broker_sign_in'
              ? 'broker_sign_in'
              : purpose,
        ...(opts?.visitor_key ? { visitor_key: opts.visitor_key } : {}),
      }),
    }),

  attributionVisit: (body: {
    partner_code?: string | null;
    campaign_code?: string | null;
    visitor_key?: string | null;
    landing_path?: string | null;
    http_referrer?: string | null;
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    utm_content?: string | null;
  }) =>
    request<{
      visitor_key: string;
      partner_org_id: string | null;
      campaign_id: string | null;
    }>('/v1/attribution/visit', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  me: async (): Promise<MeResponse | null> => {
    try {
      const raw = await request<{
        party_id: string;
        session_id: string;
        roles?: Array<{ role: string; org_id: string | null }>;
        email?: string | null;
        given_name?: string | null;
        family_name?: string | null;
        phone_e164?: string | null;
        renter_profile_complete?: boolean;
        mfa_enrolled?: boolean;
        mfa_required?: boolean;
        role?: string;
      }>('/v1/auth/me');
      const roles = raw.roles ?? [];
      const partyRole = getPartyRole() as PartyRole | null;
      let role: MeResponse['role'] = 'APPLICANT';
      if (roles.some((r) => r.role === 'rbit_admin' || r.role === 'rbit_super_admin')) {
        role = 'ADMIN';
      } else if (roles.some((r) => r.role === 'landlord') || partyRole === 'landlord') {
        role = 'LANDLORD';
      } else if (
        roles.some((r) => r.role === 'broker' || r.role === 'broker_admin') ||
        partyRole === 'broker'
      ) {
        role = 'BROKER';
      } else if (
        raw.role === 'LANDLORD' ||
        raw.role === 'ADMIN' ||
        raw.role === 'APPLICANT' ||
        raw.role === 'BROKER'
      ) {
        role = raw.role;
      } else if (partyRole === 'renter') {
        role = 'APPLICANT';
      }
      // MFA backend is incomplete — never invent a required gate from role alone.
      const mfaFeatureOn = import.meta.env.VITE_MFA_ENROLLMENT_ENABLED === 'true';
      const mfaRequired = mfaFeatureOn && Boolean(raw.mfa_required);
      return {
        party_id: raw.party_id,
        session_id: raw.session_id,
        role,
        email: raw.email ?? null,
        given_name: raw.given_name ?? null,
        family_name: raw.family_name ?? null,
        phone_e164: raw.phone_e164 ?? null,
        renter_profile_complete: Boolean(raw.renter_profile_complete),
        party_role: partyRole,
        roles,
        mfa_enrolled: raw.mfa_enrolled ?? true,
        mfa_required: mfaRequired,
      };
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
      throw err;
    }
  },

  logout: () => request<{ ok: true }>('/v1/auth/logout', { method: 'POST', body: '{}' }),

  internalPreviewAccess: () =>
    request<{
      allowed: boolean;
      email?: string;
      roles: Array<'renter' | 'landlord' | 'broker'>;
      preview?: {
        enabled: boolean;
        role: 'renter' | 'landlord' | 'broker' | null;
        preview_org_id?: string | null;
        preview_party_id?: string | null;
      };
      error?: string;
      message?: string;
    }>('/v1/internal/preview'),

  internalPreviewSetRole: (role: 'renter' | 'landlord' | 'broker' | null) =>
    request<{
      allowed: boolean;
      email?: string;
      roles: Array<'renter' | 'landlord' | 'broker'>;
      preview: {
        enabled: boolean;
        role: 'renter' | 'landlord' | 'broker' | null;
        preview_org_id?: string | null;
        preview_party_id?: string | null;
      };
      error?: string;
      message?: string;
    }>('/v1/internal/preview', {
      method: 'POST',
      body: JSON.stringify({ role }),
    }),

  mfaEnroll: (_method: 'totp' | 'passkey') =>
    Promise.resolve({
      method: 'totp' as const,
      secret: 'PENDING_BACKEND',
      otpauth_url: null as string | null,
    }),

  mfaVerify: (_code: string) => Promise.resolve({ ok: true } as const),

  getBrokerTerms: () =>
    request<{
      terms_version: string;
      accepted: boolean;
      acceptance: unknown;
      provisional: boolean;
      notice?: string;
    }>('/v1/broker/terms'),

  acceptBrokerTerms: (body: {
    terms_version: string;
    compensation_cap_ack: true;
    non_circumvention_ack: true;
    licensing_ack: true;
    platform_role_ack: true;
  }) =>
    request<{ accepted: true; acceptance: unknown; provisional: boolean }>('/v1/broker/terms', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  upsertRenterProfile: (body: {
    given_name: string;
    family_name: string;
    phone: string;
    email: string;
    annual_income_cents: number;
    move_in_urgency:
      | 'immediate'
      | 'within_30_days'
      | 'within_60_days'
      | 'within_90_days'
      | 'flexible';
    bedrooms_min: number;
    rent_max_cents: number;
    state: string;
    has_pets: boolean;
    household_size: number;
  }) =>
    request<{ profile: unknown }>('/v1/renter/profile', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getRenterProfile: async (): Promise<{
    profile: {
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
    } | null;
  }> => {
    try {
      return await request('/v1/renter/profile');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return { profile: null };
      throw err;
    }
  },

  upsertRenterIntake: (body: Record<string, unknown>) =>
    request<{ intake: unknown }>('/v1/renter/intake', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  expressInterest: (listingId: string) =>
    request<{
      application_id: string;
      listing_id: string;
      status: string;
      access_token: string;
      reused: boolean;
    }>('/v1/renter/interest', {
      method: 'POST',
      body: JSON.stringify({ listing_id: listingId }),
    }),

  screeningEligibility: (applicationId: string) =>
    request<{
      application_id: string;
      reusable: boolean;
      fee_cents: number;
      fee_cents_if_new: number;
      reason: string;
      message: string;
      expires_at: string | null;
    }>(`/v1/applications/${applicationId}/screening-eligibility`),

  getCheckrScreening: (applicationId: string) =>
    request<{
      screening_id?: string;
      application_id: string;
      status: string;
      application_url?: string | null;
      environment?: string;
      package_slug?: string;
      checkr_order_id?: string | null;
      checkr_report_id?: string | null;
      overall_result?: string | null;
      products?: Record<
        string,
        {
          status: string | null;
          result: string | null;
          consider_reasons: Array<{ category: string | null; label: string | null }>;
        }
      >;
      review_required?: boolean;
      checkr_enabled?: boolean;
      updated_at?: string;
      completed_at?: string | null;
    }>(`/v1/applications/${applicationId}/checkr-screening`),

  initiateCheckrScreening: (
    applicationId: string,
    body?: { package?: 'starter' | 'essential' | 'complete' },
  ) =>
    request<{
      screening_id: string;
      application_id: string;
      status: string;
      checkr_order_id: string | null;
      application_url: string | null;
      environment: string;
      duplicate: boolean;
    }>(`/v1/applications/${applicationId}/checkr-screening/initiate`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),

  checkrReportPdfUrl: (applicationId: string) =>
    `/v1/applications/${applicationId}/checkr-screening/pdf`,

  requestAccountDeletion: (body: { confirm: true; reason?: string }) =>
    request<{ request_id: string; status: string; message: string }>(
      '/v1/renter/account/deletion-request',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  getAccountDeletionStatus: () =>
    request<{ request: null | { id: string; status: string; created_at: string } }>(
      '/v1/renter/account/deletion-request',
    ),

  listMyApplications: () =>
    request<{
      applications: Array<{
        application_id: string;
        status: string;
        listing_id: string | null;
        created_at: string;
        move_forward_at?: string | null;
        passed_at?: string | null;
        info_requested_at?: string | null;
        screening_authorized_at?: string | null;
        screened_at?: string | null;
        closed_at?: string | null;
        contact_revealed_at?: string | null;
        progress?: {
          status?: string;
          status_label?: string;
          current_stage: string;
          current_label: string;
          next_action_owner?: 'renter' | 'home_provider' | 'system' | 'none';
          primary_action?: {
            key: string;
            label: string;
            href_hint: string | null;
          } | null;
          outstanding_steps?: Array<{
            key: string;
            label: string;
            owner: 'renter' | 'home_provider' | 'system' | 'none';
          }>;
          action_required: string | null;
          last_update_at: string | null;
          next_step: string | null;
          is_terminal?: boolean;
          stages: Array<{
            key: string;
            label: string;
            status: 'complete' | 'current' | 'upcoming' | 'skipped' | 'blocked';
            completed_at: string | null;
            explanation: string;
            action_required: string | null;
          }>;
        };
        listing: {
          line1: string | null;
          city: string | null;
          state: string | null;
          rent_amount_cents: number | null;
        } | null;
      }>;
    }>('/v1/renter/applications'),

  landlordListings: () =>
    request<{
      listings: Array<{
        id: string;
        status: string;
        rent_amount_cents: number;
        city: string | null;
        state: string | null;
        line1: string | null;
        bedrooms: number | null;
        bathrooms?: number | null;
        applicant_count: number | string;
        photo_url?: string | null;
        days_vacant?: number;
      }>;
    }>('/v1/landlord/listings'),

  brokerPortfolio: () =>
    request<{
      managed_providers: number;
      listings: number;
      open_applicants: number;
      screenings: number;
      needs_attention: Array<{ id: string; kind: string; label: string; href: string }>;
    }>('/v1/broker/portfolio'),

  brokerProviders: () =>
    request<{
      providers: Array<{
        org_id: string;
        display_name: string;
        legal_name: string;
        status: string;
        active_listings: number;
        open_applications: number;
        screenings: number;
      }>;
    }>('/v1/broker/providers'),

  brokerProviderDetail: (providerOrgId: string) =>
    request<{
      provider: {
        org_id: string;
        display_name: string;
        legal_name: string;
        status: string;
        active_listings: number;
        open_applications: number;
        screenings: number;
      };
      listings: Array<Record<string, unknown>>;
      applicants: Array<Record<string, unknown>>;
    }>(`/v1/broker/providers/${providerOrgId}`),

  brokerPortfolioListings: (providerOrgId?: string) =>
    request<{
      listings: Array<{
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
      }>;
    }>(
      providerOrgId
        ? `/v1/broker/portfolio/listings?provider_org_id=${encodeURIComponent(providerOrgId)}`
        : '/v1/broker/portfolio/listings',
    ),

  brokerPortfolioApplicants: (providerOrgId?: string) =>
    request<{
      applicants: Array<{
        application_id: string;
        listing_id: string;
        org_id: string;
        provider_name: string;
        listing_label: string;
        status: string;
        created_at: string;
        renter_label: string;
        screening_status: string;
      }>;
    }>(
      providerOrgId
        ? `/v1/broker/portfolio/applicants?provider_org_id=${encodeURIComponent(providerOrgId)}`
        : '/v1/broker/portfolio/applicants',
    ),

  brokerApplicationDetail: (applicationId: string) =>
    request<{
      application_id: string;
      listing_id: string;
      org_id: string;
      status: string;
      listing_label: string;
      provider_name: string;
      renter_label: string;
      screening_status: string;
      can_request_screening: boolean;
      notes: Array<{ note: string; at: string; actor_party_id: string | null }>;
      recommendation: 'approve' | 'decline' | null;
      recommendation_at: string | null;
    }>(`/v1/broker/applications/${applicationId}`),

  brokerRequestScreening: (applicationId: string) =>
    request<{ application_id: string; status: string }>(
      `/v1/broker/applications/${applicationId}/request-screening`,
      { method: 'POST', body: '{}' },
    ),

  brokerAddNote: (applicationId: string, note: string) =>
    request<{ application_id: string; note: string }>(
      `/v1/broker/applications/${applicationId}/notes`,
      { method: 'POST', body: JSON.stringify({ note }) },
    ),

  brokerSetRecommendation: (
    applicationId: string,
    recommendation: 'approve' | 'decline' | null,
  ) =>
    request<{ application_id: string; recommendation: 'approve' | 'decline' | null }>(
      `/v1/broker/applications/${applicationId}/recommendation`,
      { method: 'POST', body: JSON.stringify({ recommendation }) },
    ),

  landlordApplicants: (listingId: string) =>
    request<{
      listing_id: string;
      screening_mode: string;
      applicants: Array<{
        application_id: string;
        status: string;
        created_at: string;
        score_band: string;
        income_band: string;
        household_size: number | null;
        has_pets: boolean | null;
        move_in_urgency?: string | null;
        display_name?: string | null;
        criteria_match?: boolean | null;
        contact: null | {
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
      }>;
    }>(`/v1/landlord/listings/${listingId}/applicants`),

  landlordDecide: (
    listingId: string,
    applicationId: string,
    decision:
      | 'approve'
      | 'decline'
      | 'request_screening'
      | 'pass'
      | 'request_more_info'
      | 'move_forward',
    opts?: {
      note?: string;
      reason_codes?: string[];
      missing_info_categories?: string[];
      required_document_types?: string[];
      expected_status?: string;
      idempotency_key?: string;
    },
  ) =>
    request<{ application_id: string; status: string; contact_revealed_at?: string | null }>(
      `/v1/landlord/listings/${listingId}/applicants/${applicationId}/decision`,
      {
        method: 'POST',
        body: JSON.stringify({
          decision,
          note: opts?.note,
          reason_codes: opts?.reason_codes,
          missing_info_categories: opts?.missing_info_categories,
          required_document_types: opts?.required_document_types,
          expected_status: opts?.expected_status,
          idempotency_key: opts?.idempotency_key,
        }),
      },
    ),

  landlordReviewMissingInfo: (
    listingId: string,
    applicationId: string,
    requestId: string,
    body: {
      decision: 'accept' | 'return';
      note?: string;
      expected_response_version?: number;
    },
  ) =>
    request<{ request_id: string; status: string }>(
      `/v1/landlord/listings/${listingId}/applicants/${applicationId}/missing-info/${requestId}/review`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  landlordMissingInfoDocUrl: (applicationId: string, documentId: string) =>
    request<{ url: string; expires_at: string; document_id: string }>(
      `/v1/landlord/applicants/${applicationId}/missing-info/documents/${documentId}/url`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  landlordApplicantDetail: (applicationId: string) =>
    request<{
      application_id: string;
      listing_id: string;
      org_id: string;
      status: string;
      created_at: string;
      display_name: string;
      profile: {
        move_in_urgency: string | null;
        household_size: number | null;
        has_pets: boolean | null;
        preferred_state: string | null;
        income_band: string;
        annual_income_cents: number | null;
      };
      intake_snapshot: unknown;
      criteria_version_id: string | null;
      prequal_evaluation: {
        appears_to_meet?: boolean;
        checks?: Array<{
          key: string;
          label: string;
          result: string;
          detail: string;
          self_reported: boolean;
        }>;
        criteria_version_id?: string | null;
        evaluated_at?: string;
      } | null;
      screening_summary: {
        credit: string;
        criminal: string;
        eviction: string;
        identity: string;
      };
      missing_info_requests: Array<{
        id: string;
        categories: string[];
        message: string | null;
        status: string;
        renter_response: string | null;
        created_at: string;
        responded_at: string | null;
      }>;
      broker_notes: Array<{ note: string; at: string; actor_party_id: string | null }>;
      broker_recommendation: string | null;
      broker_recommendation_at: string | null;
      activity: Array<{
        event_type: string;
        payload: Record<string, unknown>;
        occurred_at: string;
        actor_party_id: string | null;
      }>;
      timestamps: {
        info_requested_at: string | null;
        move_forward_at: string | null;
        passed_at: string | null;
        contact_revealed_at: string | null;
      };
      match_score_value: number | null;
      match_score_version: string | null;
      contact: null | {
        given_name: string | null;
        family_name: string | null;
        email: string | null;
        phone_e164: string | null;
        revealed_at: string;
      };
    }>(`/v1/landlord/applicants/${applicationId}`),

  landlordActivity: (opts?: { limit?: number; offset?: number; category?: string }) => {
    const q = new URLSearchParams();
    if (opts?.limit != null) q.set('limit', String(opts.limit));
    if (opts?.offset != null) q.set('offset', String(opts.offset));
    if (opts?.category) q.set('category', opts.category);
    const qs = q.toString();
    return request<{
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
    }>(`/v1/landlord/activity${qs ? `?${qs}` : ''}`);
  },

  getListingCriteria: (listingId: string) =>
    request<{
      listing_id: string;
      criteria: null | {
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
    }>(`/v1/landlord/listings/${listingId}/criteria`),

  putListingCriteria: (
    listingId: string,
    body: {
      jurisdiction?: string | null;
      rules: {
        min_income_to_rent_ratio?: number;
        move_in_window_days?: number;
        pets_allowed?: boolean;
        max_occupants?: number;
        lease_term_months?: number | number[];
        require_complete_profile?: boolean;
      };
    },
  ) =>
    request<{ listing_id: string; criteria: unknown }>(
      `/v1/landlord/listings/${listingId}/criteria`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),

  uploadLeaseDocument: (
    listingId: string,
    applicationId: string,
    body: {
      content_type: string;
      original_filename: string;
      file_base64?: string;
      storage_key?: string;
    },
  ) =>
    request<{ id: string; status?: string }>(
      `/v1/landlord/listings/${listingId}/applicants/${applicationId}/lease`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  listListingLeases: (listingId: string, applicationId?: string) =>
    request<{
      listing_id: string;
      application_id: string | null;
      leases: Array<{
        id: string;
        listing_id: string;
        application_id: string | null;
        original_filename: string;
        content_type: string;
        created_at: string;
        status?: string;
        workflow_status?: string;
        acknowledged_at?: string | null;
        made_available_at?: string | null;
      }>;
    }>(
      applicationId
        ? `/v1/landlord/listings/${listingId}/applicants/${applicationId}/lease`
        : `/v1/landlord/listings/${listingId}/leases`,
    ),

  makeLeaseAvailableToRenter: (listingId: string, applicationId: string, docId: string) =>
    request<{ id: string; workflow_status: string }>(
      `/v1/landlord/listings/${listingId}/applicants/${applicationId}/leases/${docId}/make-available`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  listRenterLeases: (applicationId: string) =>
    request<{
      application_id: string;
      leases: Array<{
        id: string;
        original_filename: string;
        workflow_status: string;
        acknowledged_at: string | null;
        created_at: string;
      }>;
    }>(`/v1/renter/applications/${applicationId}/leases`),

  acknowledgeRenterLease: (applicationId: string, docId: string) =>
    request<{ id: string; workflow_status: string }>(
      `/v1/renter/applications/${applicationId}/leases/${docId}/acknowledge`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  renterLeaseDownloadUrl: (applicationId: string, docId: string) =>
    request<{ url: string; expires_at: string }>(
      `/v1/renter/applications/${applicationId}/leases/${docId}/download-url`,
    ),

  acceptBrokerInvitation: (invitationId: string) =>
    request<{ invitation: unknown; delegation: unknown }>(
      `/v1/landlord/broker-invitations/${invitationId}/accept`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  listLandlordBrokerInvitations: () =>
    request<{ invitations: Array<{ id: string; contact_email: string; status: string }> }>(
      '/v1/landlord/broker-invitations',
    ),

  revokeBrokerDelegation: (providerOrgId: string) =>
    request<{ delegation: unknown }>(`/v1/broker/delegations/${providerOrgId}/revoke`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  listSavedListings: () =>
    request<{
      saved: Array<{
        listing_id: string;
        created_at: string;
        status: string;
        rent_amount_cents: number;
        address_line1: string | null;
        city: string | null;
        state: string | null;
      }>;
    }>('/v1/renter/saved'),

  addSavedListing: (listingId: string) =>
    request<{ listing_id: string; created_at: string }>('/v1/renter/saved', {
      method: 'POST',
      body: JSON.stringify({ listing_id: listingId }),
    }),

  removeSavedListing: (listingId: string) =>
    request<{ removed: boolean }>('/v1/renter/saved', {
      method: 'DELETE',
      body: JSON.stringify({ listing_id: listingId }),
    }),

  listSupportCases: () =>
    request<{
      cases: Array<{
        id: string;
        category: string;
        subject: string;
        description: string;
        status: string;
        related_listing_id: string | null;
        related_application_id: string | null;
        created_at: string;
        updated_at: string;
      }>;
    }>('/v1/renter/support-cases'),

  createSupportCase: (body: {
    category:
      | 'screening'
      | 'payment'
      | 'cashback'
      | 'listing_issue'
      | 'privacy'
      | 'account'
      | 'broker_relationship'
      | 'fraud';
    subject: string;
    description: string;
    related_listing_id?: string;
    related_application_id?: string;
  }) =>
    request<{
      id: string;
      category: string;
      subject: string;
      status: string;
      created_at: string;
    }>('/v1/renter/support-cases', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getScreeningCenter: () =>
    request<{
      applications: Array<{
        application_id: string;
        listing_id: string | null;
        status: string;
        reports: Array<{
          report_kind: string;
          status: string;
          issued_at: string | null;
        }>;
      }>;
      ny_submissions: Array<{
        id: string;
        report_source: string;
        completed_at: string;
        state_jurisdiction: string;
        compliance_tag: string | null;
      }>;
      cashback: Array<{
        id: string;
        application_id: string;
        listing_id: string;
        status: string;
        amount_cents: number | null;
        offer_version: string;
        ineligible_reason: string | null;
      }>;
    }>('/v1/renter/screening-center'),

  respondMissingInfo: (
    applicationId: string,
    body: {
      response: string;
      request_id?: string;
      document_ids?: string[];
      idempotency_key?: string;
    },
  ) =>
    request<{ request_id: string; status: string; response_version?: number }>(
      `/v1/renter/applications/${applicationId}/missing-info-response`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  uploadMissingInfoDocument: (
    applicationId: string,
    requestId: string,
    body: {
      content_type: string;
      content_base64: string;
      original_filename?: string;
      doc_type?: string;
    },
  ) =>
    request<{
      document_id: string;
      scan_status: string;
      content_type: string;
      size_bytes: number;
    }>(`/v1/renter/applications/${applicationId}/missing-info/${requestId}/documents`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  renterMissingInfoDocUrl: (applicationId: string, documentId: string) =>
    request<{ url: string; expires_at: string; document_id: string }>(
      `/v1/renter/applications/${applicationId}/missing-info/documents/${documentId}/url`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  getRenterCashback: () =>
    request<{
      offer_version_note?: string;
      eligibility: Array<{
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
    }>('/v1/renter/cashback'),

  listBrokerInvitations: () =>
    request<{
      invitations: Array<{
        id: string;
        broker_org_id: string;
        provider_org_id: string | null;
        contact_email: string;
        business_name: string | null;
        note: string | null;
        status: string;
        invited_by_party_id: string;
        created_at: string;
        accepted_at: string | null;
        expires_at: string | null;
      }>;
    }>('/v1/broker/invitations'),

  createBrokerInvitation: (body: {
    contact_email: string;
    business_name?: string;
    note?: string;
    expires_at?: string;
  }) =>
    request<{
      id: string;
      contact_email: string;
      business_name: string | null;
      note: string | null;
      status: string;
      created_at: string;
      expires_at: string | null;
    }>('/v1/broker/invitations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  cancelBrokerInvitation: (invitationId: string) =>
    request<{ invitation?: unknown; id?: string; status?: string }>(
      `/v1/broker/invitations/${invitationId}/cancel`,
      { method: 'POST', body: '{}' },
    ),

  getLandlordSettings: () =>
    request<{ screening_mode: 'auto_screen' | 'manual_review' }>('/v1/landlord/settings'),

  putLandlordSettings: (screening_mode: 'auto_screen' | 'manual_review') =>
    request<{ screening_mode: 'auto_screen' | 'manual_review' }>('/v1/landlord/settings', {
      method: 'PUT',
      body: JSON.stringify({ screening_mode }),
    }),

  getScreeningFee: (state?: string) =>
    request<{ fee?: { amount_cents?: number }; amount_cents?: number }>(
      state
        ? `/v1/config/screening-fee?state=${encodeURIComponent(state)}`
        : '/v1/config/screening-fee',
    ),

  updateListingStatus: (listingId: string, status: 'active' | 'paused' | 'draft' | 'rented') =>
    request<{ id: string; status: string }>(`/v1/landlord/listings/${listingId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  createLandlordListing: (body: {
    address_raw: string;
    rent_amount_cents: number;
    deposit_cents?: number;
    bedrooms?: number;
    bathrooms?: number;
    sqft?: number;
    description?: string;
    pets_allowed?: boolean;
    amenities?: string[];
    available_on?: string;
    status?: 'draft' | 'active' | 'paused';
    media_urls?: string[];
  }) =>
    request<{ listing_id: string; status: string; listing?: { id: string }; id?: string }>(
      '/v1/landlord/listings',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  updateLandlordListing: (
    listingId: string,
    body: {
      rent_amount_cents?: number;
      deposit_cents?: number | null;
      bedrooms?: number;
      bathrooms?: number;
      sqft?: number | null;
      description?: string | null;
      pets_allowed?: boolean | null;
      amenities?: string[];
      available_on?: string | null;
      status?: 'draft' | 'active' | 'paused' | 'rented';
    },
  ) =>
    request<{ listing?: unknown; id?: string }>(`/v1/landlord/listings/${listingId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  uploadListingPhoto: (
    listingId: string,
    body: { content_type: string; filename?: string; file_base64: string },
  ) =>
    request<{ url?: string; photo_url?: string }>(
      `/v1/landlord/listings/${listingId}/photos`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  listNotifications: () =>
    request<{
      notifications: Array<{
        id: string;
        event_type: string;
        template_key: string;
        payload: Record<string, unknown>;
        status: string;
        created_at: string;
        read_at: string | null;
        deep_link: string | null;
      }>;
    }>('/v1/notifications'),

  markNotificationRead: (notificationId: string) =>
    request<{ id: string; read_at: string }>(`/v1/notifications/${notificationId}/read`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  reportListingIssue: (
    listingId: string,
    body: {
      category:
        | 'stale_availability'
        | 'incorrect_price'
        | 'incorrect_photos'
        | 'incorrect_address'
        | 'scam_suspected'
        | 'other_non_sensitive';
      note?: string;
    },
  ) =>
    request<{ ok: true; listing_id: string }>(`/v1/listings/${listingId}/report-issue`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  confirmListingFreshness: (listingId: string) =>
    request<{ id: string; last_confirmed_at: string }>(
      `/v1/landlord/listings/${listingId}/confirm-freshness`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
};

/**
 * Dev StrictMode mounts effects twice. Share one in-flight redeem per token so the
 * second mount awaits the same promise instead of consuming an already-redeemed token.
 */
const redeemOnceInflight = new Map<
  string,
  Promise<{ session_id: string; party_id: string }>
>();

export function redeemMagicLinkOnce(
  token: string,
  purpose: MagicLinkPurpose = 'sign_in',
): Promise<{ session_id: string; party_id: string }> {
  const key = `${purpose}:${token}`;
  const existing = redeemOnceInflight.get(key);
  if (existing) return existing;
  let visitorKey: string | null = null;
  try {
    visitorKey = localStorage.getItem('dwel_visitor_key');
  } catch {
    visitorKey = null;
  }
  const pending = api.redeem(token, purpose, { visitor_key: visitorKey }).finally(() => {
    // Keep settled promise briefly so a remount can still read success; then clear.
    setTimeout(() => redeemOnceInflight.delete(key), 5_000);
  });
  redeemOnceInflight.set(key, pending);
  return pending;
}
