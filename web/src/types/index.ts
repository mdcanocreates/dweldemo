/** Types for userFlow.md progressive-trust redesign */

export type PartyRole = 'renter' | 'landlord' | 'broker' | 'admin';

/** Maps frontend party_role → API role gate used by RequireAuth */
export type UserRole = 'APPLICANT' | 'LANDLORD' | 'ADMIN' | 'BROKER';

export type MeResponse = {
  party_id: string;
  session_id: string;
  role: UserRole;
  email?: string | null;
  given_name?: string | null;
  family_name?: string | null;
  phone_e164?: string | null;
  renter_profile_complete?: boolean;
  mfa_enrolled: boolean;
  mfa_required: boolean;
  /** Set after /onboarding/role — undefined means new user needs role selection */
  party_role?: PartyRole | null;
  /** Raw org roles from /v1/auth/me */
  roles?: Array<{ role: string; org_id: string | null }>;
};

export type MagicLinkPurpose = 'sign_in' | 'landlord_sign_in' | 'admin_sign_in' | 'broker_sign_in';

export type ListingStatus =
  | 'DRAFT'
  | 'LIVE'
  | 'PAUSED'
  | 'CLOSED_LEASED'
  | 'CLOSED_WITHDRAWN'
  | 'EXPIRED'
  | 'active'
  | 'paused'
  | 'filled';

export type Listing = {
  id: string;
  property_name: string;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  county?: string;
  neighborhood?: string;
  rent_cents: number;
  /** Deposit in integer cents when API provides it. */
  deposit_cents?: number | null;
  /**
   * Renter cash-back display amount from API (e.g. cashback_cents).
   * Omit / null when the API does not supply a real value — never invent.
   */
  cashback_cents?: number | null;
  beds: number;
  baths: number;
  sqft?: number | null;
  lease_months?: number | null;
  available_on?: string | null;
  photos: string[];
  concession_available: boolean;
  concession_description?: string | null;
  specials_count: number;
  pet_friendly: boolean;
  parking: boolean;
  laundry?: boolean;
  description?: string;
  lat?: number;
  lng?: number;
  phone?: string | null;
  website?: string | null;
  status: ListingStatus;
  property_type?: 'apartment' | 'house' | 'townhome' | 'condo';
};

export type ListingSearchParams = {
  location?: string;
  locationType?: 'city' | 'neighborhood' | 'zip' | 'county' | 'state' | 'region';
  city?: string;
  county?: string;
  state?: string;
  postal_code?: string;
  beds?: number[];
  baths?: number[];
  price_min?: number;
  price_max?: number;
  available_after?: string;
  pet_friendly?: boolean;
  parking?: boolean;
  move_in_incentive?: boolean;
  property_type?: string[];
};

export type MatchReason = {
  field: 'beds' | 'city' | 'state' | 'rent' | 'available_after' | 'pet_friendly' | 'parking' | 'saved';
  op: 'in' | 'eq' | 'lte' | 'gte' | 'contains';
  value: string | number | number[] | boolean;
};

export type IncomeBand =
  | 'under_2k'
  | '2k_3k'
  | '3k_4k'
  | '4k_5k'
  | '5k_7_5k'
  | '7_5k_10k'
  | '10k_plus';

export type EmploymentStatus =
  | 'employed_full_time'
  | 'employed_part_time'
  | 'self_employed'
  | 'student'
  | 'retired'
  | 'other';

/** Self-reported pre-qualification — NOT an FCRA consumer report (userFlow.md). */
export type PrequalProfile = {
  id: string;
  full_name: string;
  phone: string;
  current_city: string;
  target_move_in_date: string;
  occupant_count: number;
  has_pets: boolean;
  pet_details: Array<{ type: string; breed: string; weight: string }> | null;
  budget_min_cents: number;
  budget_max_cents: number;
  bedrooms: string[];
  bathrooms: string;
  property_type_prefs: string[];
  must_haves: string[];
  preferred_areas: string[] | null;
  employment_status: EmploymentStatus;
  income_band: IncomeBand;
  has_eviction_history: boolean;
  has_bankruptcy_history: boolean;
  bio: string | null;
  move_reason: string | null;
  status: 'draft' | 'complete';
};

export type InterestStatus =
  | 'expressed'
  | 'screening_requested'
  | 'screening_consented'
  | 'screening_complete'
  | 'approved'
  | 'declined'
  | 'withdrawn';

export type Interest = {
  id: string;
  listing_id: string;
  renter_label: string;
  status: InterestStatus;
  created_at: string;
  consented_at?: string | null;
  withdrawn_at?: string | null;
  listing_name: string;
  listing_city: string;
  listing_state: string;
  /** Meeting demo only — never a real consumer report. */
  is_demo?: boolean;
};

export const INTEREST_LABELS: Record<InterestStatus, string> = {
  expressed: 'Sent',
  screening_requested: 'Screening requested',
  screening_consented: 'Screening in progress',
  screening_complete: 'Under review',
  approved: 'Approved ✓',
  declined: 'Not selected',
  withdrawn: 'Withdrawn',
};

/** Preview-only disclosure — not counsel-approved final copy. */
export const FCRA_CONSENT_COPY_PREVIEW =
  'By continuing, you authorize screening for this rental application.\n\n' +
  'This is an internal preview placeholder. Final FCRA disclosure text is pending legal review and is not shown here as production copy.';

/**
 * User-facing disclosure shown outside preview.
 * Engineering banners must never ship to production builds.
 */
export const FCRA_CONSENT_COPY = import.meta.env.DEV
  ? '[PENDING LEGAL REVIEW — DO NOT SHIP TO PRODUCTION]\n\nBy continuing, you authorize Dwel to obtain a consumer report for evaluating your rental application. Final disclosure text is pending counsel review.'
  : 'By continuing, you authorize Dwel and its screening partners to obtain a consumer report for evaluating your rental application. Final legal disclosure text is pending counsel review.';
