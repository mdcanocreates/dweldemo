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

export function loadAnswers(): RenterAnswers {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...EMPTY_ANSWERS };
    return { ...EMPTY_ANSWERS, ...(JSON.parse(raw) as Partial<RenterAnswers>) };
  } catch {
    return { ...EMPTY_ANSWERS };
  }
}

export function saveAnswers(a: RenterAnswers) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(a));
  } catch {
    /* ignore */
  }
}

export function profileComplete(a: RenterAnswers): boolean {
  return Boolean(
    a.profile_complete ||
      (a.given_name &&
        a.family_name &&
        a.email &&
        a.phone &&
        a.move_in_urgency &&
        a.bedrooms_min &&
        a.rent_max_dollars &&
        a.preferred_state),
  );
}

export function answersToProfilePayload(a: RenterAnswers) {
  const annual = Number(a.annual_income_dollars);
  const rent = Number(a.rent_max_dollars);
  // Income is collected later via screening; API still expects a cents field.
  const annualCents = Number.isFinite(annual) && annual > 0
    ? Math.round(annual * 100)
    : Number.isFinite(rent) && rent > 0
      ? Math.round(rent * 12 * 3 * 100)
      : 1;
  return {
    given_name: a.given_name,
    family_name: a.family_name,
    phone: a.phone || '+10000000000',
    email: a.email,
    annual_income_cents: annualCents,
    move_in_urgency: a.move_in_urgency || 'within_30_days',
    bedrooms_min: Number(a.bedrooms_min) || 1,
    rent_max_cents: Number.isFinite(rent) ? Math.round(rent * 100) : 100000,
    state: a.preferred_state || 'OH',
    has_pets: Boolean(a.has_pets),
    household_size: Number(a.household_size) || 1,
  };
}

export function answersToIntakePayload(a: RenterAnswers, markComplete: boolean) {
  const monthly =
    Number(a.monthly_gross_income_dollars) ||
    (Number(a.annual_income_dollars) ? Number(a.annual_income_dollars) / 12 : NaN);
  return {
    current_address_line1: a.current_address_line1 || undefined,
    current_address_city: a.current_address_city || undefined,
    current_address_state: a.current_address_state || a.preferred_state || undefined,
    current_address_postal: a.current_address_postal || undefined,
    current_address_move_in: a.current_address_move_in || undefined,
    employer_name: a.employer_name || undefined,
    job_title: a.job_title || undefined,
    employer_phone: a.employer_phone || undefined,
    employment_length_months: a.employment_length_months
      ? Number(a.employment_length_months)
      : undefined,
    monthly_gross_income_cents: Number.isFinite(monthly) ? Math.round(monthly * 100) : undefined,
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
