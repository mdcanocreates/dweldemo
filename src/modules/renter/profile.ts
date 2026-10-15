import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';

export const MOVE_IN_URGENCY = [
  'immediate',
  'within_30_days',
  'within_60_days',
  'within_90_days',
  'flexible',
] as const;

export type MoveInUrgency = (typeof MOVE_IN_URGENCY)[number];

export type RenterProfileInput = {
  givenName: string;
  familyName: string;
  phoneE164: string;
  email: string;
  annualIncomeCents: number;
  moveInUrgency: MoveInUrgency;
  bedroomsMin: number;
  rentMaxCents: number;
  preferredState: string;
  hasPets: boolean;
  householdSize: number;
  preferredLeaseTermMonths?: number | null;
};

export type RenterProfileView = {
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
  preferred_lease_term_months: number | null;
  updated_at: string;
};

export function normalizePhoneE164(phone: string): string {
  const trimmed = phone.trim();
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  throw new AppError('phone must be E.164', 'validation_error', 400);
}

function normalizeState(state: string): string {
  const s = state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) {
    throw new AppError('state must be a 2-letter code', 'validation_error', 400);
  }
  return s;
}

export async function getRenterProfile(
  client: DbClient,
  partyId: string,
): Promise<RenterProfileView | null> {
  const { rows } = await client.query<{
    party_id: string;
    given_name: string | null;
    family_name: string | null;
    phone_e164: string | null;
    email: string | null;
    annual_income_cents: number | null;
    move_in_urgency: string | null;
    bedrooms_min: string | null;
    rent_max_cents: number | null;
    preferred_state: string | null;
    has_pets: boolean | null;
    household_size: number | null;
    preferred_lease_term_months: number | null;
    updated_at: Date;
  }>(
    `select party_id, given_name, family_name, phone_e164, email,
            annual_income_cents, move_in_urgency, bedrooms_min::text,
            rent_max_cents, preferred_state, has_pets, household_size,
            preferred_lease_term_months, updated_at
     from renter_profile
     where party_id = $1`,
    [partyId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    party_id: row.party_id,
    given_name: row.given_name,
    family_name: row.family_name,
    phone_e164: row.phone_e164,
    email: row.email,
    annual_income_cents: row.annual_income_cents,
    move_in_urgency: row.move_in_urgency,
    bedrooms_min: row.bedrooms_min != null ? Number(row.bedrooms_min) : null,
    rent_max_cents: row.rent_max_cents,
    preferred_state: row.preferred_state,
    has_pets: row.has_pets,
    household_size: row.household_size,
    preferred_lease_term_months: row.preferred_lease_term_months,
    updated_at: row.updated_at.toISOString(),
  };
}

export async function upsertRenterProfile(
  client: DbClient,
  partyId: string,
  input: RenterProfileInput,
): Promise<RenterProfileView> {
  const phone = normalizePhoneE164(input.phoneE164);
  const state = normalizeState(input.preferredState);
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError('invalid email', 'validation_error', 400);
  }
  if (!input.givenName.trim() || !input.familyName.trim()) {
    throw new AppError('name is required', 'validation_error', 400);
  }
  if (input.annualIncomeCents < 0 || input.rentMaxCents <= 0) {
    throw new AppError('invalid money fields', 'validation_error', 400);
  }
  if (input.householdSize < 1 || input.bedroomsMin < 0) {
    throw new AppError('invalid household/bedrooms', 'validation_error', 400);
  }

  const leaseTerm =
    input.preferredLeaseTermMonths != null &&
    Number.isFinite(input.preferredLeaseTermMonths) &&
    input.preferredLeaseTermMonths > 0
      ? Math.trunc(input.preferredLeaseTermMonths)
      : null;

  await client.query(
    `insert into renter_profile (
       party_id, given_name, family_name, phone_e164, email,
       annual_income_cents, move_in_urgency, bedrooms_min, rent_max_cents,
       preferred_state, has_pets, household_size, preferred_lease_term_months, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
     on conflict (party_id) do update set
       given_name = excluded.given_name,
       family_name = excluded.family_name,
       phone_e164 = excluded.phone_e164,
       email = excluded.email,
       annual_income_cents = excluded.annual_income_cents,
       move_in_urgency = excluded.move_in_urgency,
       bedrooms_min = excluded.bedrooms_min,
       rent_max_cents = excluded.rent_max_cents,
       preferred_state = excluded.preferred_state,
       has_pets = excluded.has_pets,
       household_size = excluded.household_size,
       preferred_lease_term_months = coalesce(
         excluded.preferred_lease_term_months,
         renter_profile.preferred_lease_term_months
       ),
       updated_at = now()`,
    [
      partyId,
      input.givenName.trim(),
      input.familyName.trim(),
      phone,
      email,
      input.annualIncomeCents,
      input.moveInUrgency,
      input.bedroomsMin,
      input.rentMaxCents,
      state,
      input.hasPets,
      input.householdSize,
      leaseTerm,
    ],
  );

  const profile = await getRenterProfile(client, partyId);
  if (!profile) throw new AppError('profile missing after upsert', 'internal_error', 500);
  return profile;
}
