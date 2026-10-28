/**
 * Shared renter answers + persistence.
 * G-0 → renter_profile; N-6 remainder → renter_application_intake.
 */

export type Occupant = { name: string; relationship: string; age_band: string };
export type Pet = { species: string; breed: string; weight_lbs: string };

/** Unified client state spanning G-0 profile + N-6 application intake. */
export type RenterAnswers = {
  // G-0 / renter_profile
  given_name: string;
  family_name: string;
  phone: string;
  email: string;
  annual_income_dollars: string;
  move_in_urgency: string;
  bedrooms_min: string;
  rent_max_dollars: string;
  preferred_state: string;
  has_pets: boolean | null;
  household_size: string;
  // N-6 / renter_application_intake
  current_address_line1: string;
  current_address_city: string;
  current_address_state: string;
  current_address_postal: string;
  current_address_move_in: string;
  employer_name: string;
  job_title: string;
  employer_phone: string;
  employment_length_months: string;
  monthly_gross_income_dollars: string;
  occupants: Occupant[];
  pets: Pet[];
  emergency_name: string;
  emergency_relationship: string;
  emergency_phone: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_plate: string;
  skip_vehicle: boolean;
  profile_complete: boolean;
};

export const EMPTY_ANSWERS: RenterAnswers = {
  given_name: '',
  family_name: '',
  phone: '',
  email: '',
  annual_income_dollars: '',
  move_in_urgency: '',
  bedrooms_min: '',
  rent_max_dollars: '',
  preferred_state: '',
  has_pets: null,
  household_size: '1',
  current_address_line1: '',
  current_address_city: '',
  current_address_state: '',
  current_address_postal: '',
  current_address_move_in: '',
  employer_name: '',
  job_title: '',
  employer_phone: '',
  employment_length_months: '',
  monthly_gross_income_dollars: '',
  occupants: [],
  pets: [],
  emergency_name: '',
  emergency_relationship: '',
  emergency_phone: '',
  vehicle_make: '',
  vehicle_model: '',
  vehicle_plate: '',
  skip_vehicle: false,
  profile_complete: false,
};

export const STORE_KEY = 'dwel20.renter.answers.v2';
export const CHAT_SESSION_KEY = 'dwel20.intake.chat.v2';

type DraftStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function draftStore(): DraftStore | null {
  const store = (globalThis as { localStorage?: DraftStore }).localStorage;
  if (!store || typeof store.getItem !== 'function') return null;
  return store;
}

export function loadAnswers(): RenterAnswers {
  try {
    const raw = draftStore()?.getItem(STORE_KEY);
    if (!raw) return { ...EMPTY_ANSWERS };
    return { ...EMPTY_ANSWERS, ...(JSON.parse(raw) as Partial<RenterAnswers>) };
  } catch {
    return { ...EMPTY_ANSWERS };
  }
}

export function saveAnswers(a: RenterAnswers) {
  try {
    draftStore()?.setItem(STORE_KEY, JSON.stringify(a));
  } catch {
    /* ignore */
  }
}

export type ServerProfileFields = {
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
};

function preferText(server: string | null | undefined, local: string): string {
  if (typeof server === 'string' && server.trim()) return server.trim();
  return local;
}

/** Required discover fields. A stored flag alone does not make a profile complete. */
export function profileFieldsComplete(a: RenterAnswers): boolean {
  return Boolean(
    a.given_name.trim() &&
      a.family_name.trim() &&
      a.email.trim() &&
      a.phone.trim() &&
      a.move_in_urgency &&
      a.bedrooms_min.trim() &&
      a.rent_max_dollars.trim() &&
      a.preferred_state.trim().length === 2,
  );
}

export function profileComplete(a: RenterAnswers): boolean {
  return profileFieldsComplete(a);
}

/** A profile row exists for many applicants who never saved identity fields. */
export function serverProfileSaved(profile: ServerProfileFields | null | undefined): boolean {
  if (!profile) return false;
  return Boolean(
    profile.given_name?.trim() &&
      profile.family_name?.trim() &&
      profile.email?.trim() &&
      profile.phone_e164?.trim() &&
      profile.move_in_urgency?.trim() &&
      profile.bedrooms_min != null &&
      profile.rent_max_cents != null &&
      profile.rent_max_cents > 0 &&
      profile.preferred_state?.trim().length === 2,
  );
}

/** Address and employment collected on the application form, not inferred from rent. */
export function intakeFieldsReady(a: RenterAnswers): boolean {
  return Boolean(
    a.current_address_line1.trim() &&
      a.current_address_city.trim() &&
      a.current_address_state.trim() &&
      a.current_address_postal.trim() &&
      a.employer_name.trim() &&
      a.job_title.trim(),
  );
}

/**
 * Server values win when present. Local drafts fill only blanks.
 * Completeness is recomputed from fields. A profile row does not imply completeness.
 */
export function mergeServerRecords(
  local: RenterAnswers,
  profile: ServerProfileFields | null,
  intake: Record<string, unknown> | null,
): RenterAnswers {
  const next: RenterAnswers = { ...local };
  if (profile) {
    next.given_name = preferText(profile.given_name, next.given_name);
    next.family_name = preferText(profile.family_name, next.family_name);
    next.phone = preferText(profile.phone_e164, next.phone);
    next.email = preferText(profile.email, next.email);
    if (profile.annual_income_cents != null && profile.annual_income_cents > 0) {
      next.annual_income_dollars = String(Math.round(profile.annual_income_cents / 100));
    }
    next.move_in_urgency = preferText(profile.move_in_urgency, next.move_in_urgency);
    if (profile.bedrooms_min != null) next.bedrooms_min = String(profile.bedrooms_min);
    if (profile.rent_max_cents != null && profile.rent_max_cents > 0) {
      next.rent_max_dollars = String(Math.round(profile.rent_max_cents / 100));
    }
    next.preferred_state = preferText(profile.preferred_state, next.preferred_state);
    if (profile.has_pets != null) next.has_pets = profile.has_pets;
    if (profile.household_size != null) next.household_size = String(profile.household_size);
  }
  if (intake) {
    next.current_address_line1 = preferText(
      intake.current_address_line1 as string | null,
      next.current_address_line1,
    );
    next.current_address_city = preferText(
      intake.current_address_city as string | null,
      next.current_address_city,
    );
    next.current_address_state = preferText(
      intake.current_address_state as string | null,
      next.current_address_state,
    );
    next.current_address_postal = preferText(
      intake.current_address_postal as string | null,
      next.current_address_postal,
    );
    if (intake.current_address_move_in) {
      next.current_address_move_in = String(intake.current_address_move_in).slice(0, 10);
    }
    next.employer_name = preferText(intake.employer_name as string | null, next.employer_name);
    next.job_title = preferText(intake.job_title as string | null, next.job_title);
    next.employer_phone = preferText(intake.employer_phone as string | null, next.employer_phone);
    if (intake.employment_length_months != null) {
      next.employment_length_months = String(intake.employment_length_months);
    }
    if (intake.monthly_gross_income_cents != null) {
      next.monthly_gross_income_dollars = String(Number(intake.monthly_gross_income_cents) / 100);
    }
    const occ = Array.isArray(intake.occupants) ? (intake.occupants as Occupant[]) : [];
    if (occ.length) next.occupants = occ;
    const petRows = Array.isArray(intake.pets) ? (intake.pets as Pet[]) : [];
    if (petRows.length) next.pets = petRows;
    const ec = (intake.emergency_contact ?? null) as Record<string, string> | null;
    if (ec) {
      next.emergency_name = ec.name ?? next.emergency_name;
      next.emergency_relationship = ec.relationship ?? next.emergency_relationship;
      next.emergency_phone = ec.phone ?? next.emergency_phone;
    }
    const veh = (intake.vehicle ?? null) as Record<string, string> | null;
    if (veh) {
      next.vehicle_make = veh.make ?? next.vehicle_make;
      next.vehicle_model = veh.model ?? next.vehicle_model;
      next.vehicle_plate = veh.plate ?? next.vehicle_plate;
    }
  }
  next.profile_complete = profileFieldsComplete(next);
  return next;
}

export function answersToProfilePayload(a: RenterAnswers) {
  const annual = Number(a.annual_income_dollars);
  const rent = Number(a.rent_max_dollars);
  const statedAnnual = a.annual_income_dollars.trim();
  const annualCents =
    statedAnnual && Number.isFinite(annual) && annual >= 0 ? Math.round(annual * 100) : null;
  const bedrooms = Number(a.bedrooms_min);
  const household = Number(a.household_size);
  return {
    given_name: a.given_name.trim(),
    family_name: a.family_name.trim(),
    phone: a.phone.trim(),
    email: a.email.trim(),
    annual_income_cents: annualCents,
    move_in_urgency: a.move_in_urgency,
    bedrooms_min: Number.isFinite(bedrooms) ? bedrooms : 0,
    rent_max_cents: Number.isFinite(rent) && rent > 0 ? Math.round(rent * 100) : 0,
    state: a.preferred_state.trim().toUpperCase(),
    has_pets: Boolean(a.has_pets),
    household_size: Number.isFinite(household) && household >= 1 ? Math.trunc(household) : 1,
  };
}

export function answersToIntakePayload(a: RenterAnswers, markComplete: boolean) {
  const monthly = Number(a.monthly_gross_income_dollars);
  const statedMonthly = a.monthly_gross_income_dollars.trim();
  return {
    current_address_line1: a.current_address_line1 || undefined,
    current_address_city: a.current_address_city || undefined,
    current_address_state: a.current_address_state || undefined,
    current_address_postal: a.current_address_postal || undefined,
    current_address_move_in: a.current_address_move_in || undefined,
    employer_name: a.employer_name || undefined,
    job_title: a.job_title || undefined,
    employer_phone: a.employer_phone || undefined,
    employment_length_months: a.employment_length_months
      ? Number(a.employment_length_months)
      : undefined,
    monthly_gross_income_cents:
      statedMonthly && Number.isFinite(monthly) && monthly >= 0
        ? Math.round(monthly * 100)
        : undefined,
    occupants: a.occupants.filter((o) => o.name.trim()),
    pets: a.pets.filter((p) => p.species.trim()),
    emergency_contact:
      a.emergency_name.trim() || a.emergency_phone.trim()
        ? {
            name: a.emergency_name,
            relationship: a.emergency_relationship,
            phone: a.emergency_phone,
          }
        : null,
    vehicle: a.skip_vehicle
      ? null
      : a.vehicle_make.trim() || a.vehicle_model.trim() || a.vehicle_plate.trim()
        ? { make: a.vehicle_make, model: a.vehicle_model, plate: a.vehicle_plate }
        : null,
    mark_complete: markComplete,
    given_name: a.given_name,
    family_name: a.family_name,
    phone: a.phone,
    email: a.email,
  };
}
