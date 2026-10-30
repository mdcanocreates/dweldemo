import { describe, expect, it } from 'vitest';
import {
  answersToIntakePayload,
  answersToProfilePayload,
  EMPTY_ANSWERS,
  intakeFieldsReady,
  mergeServerRecords,
  profileComplete,
  serverProfileSaved,
  type RenterAnswers,
} from '../../web/src/intake/answers.js';

function answers(partial: Partial<RenterAnswers>): RenterAnswers {
  return { ...EMPTY_ANSWERS, ...partial };
}

describe('renter answer payloads', () => {
  it('does not invent income, phone, state, or urgency from other answers', () => {
    const payload = answersToProfilePayload(
      answers({
        given_name: 'Ava',
        family_name: 'Cole',
        email: 'ava@example.com',
        phone: '5555550100',
        rent_max_dollars: '1800',
        bedrooms_min: '2',
        preferred_state: 'tx',
        move_in_urgency: 'flexible',
      }),
    );
    expect(payload.annual_income_cents).toBeNull();
    expect(payload.phone).toBe('5555550100');
    expect(payload.state).toBe('TX');
    expect(payload.move_in_urgency).toBe('flexible');
    expect(payload.rent_max_cents).toBe(180000);
    expect(payload.household_size).toBeNull();
  });

  it('does not copy the preferred state into the current address', () => {
    const payload = answersToIntakePayload(
      answers({ preferred_state: 'TX', current_address_state: '' }),
      false,
    );
    expect(payload.current_address_state).toBeUndefined();
  });

  it('does not treat an empty profile row as a saved account', () => {
    expect(
      serverProfileSaved({
        given_name: null,
        family_name: null,
        phone_e164: null,
        email: null,
        annual_income_cents: null,
        move_in_urgency: null,
        bedrooms_min: null,
        rent_max_cents: null,
        preferred_state: null,
        has_pets: null,
        household_size: 1,
      }),
    ).toBe(false);
  });

  it('does not derive monthly intake income from annual income', () => {
    const payload = answersToIntakePayload(
      answers({ annual_income_dollars: '72000', monthly_gross_income_dollars: '' }),
      false,
    );
    expect(payload.monthly_gross_income_cents).toBeUndefined();
  });

  it('treats a completeness flag without fields as incomplete', () => {
    expect(profileComplete(answers({ profile_complete: true }))).toBe(false);
    expect(
      profileComplete(
        answers({
          given_name: 'Ava',
          family_name: 'Cole',
          email: 'ava@example.com',
          phone: '5555550100',
          move_in_urgency: 'flexible',
          bedrooms_min: '1',
          rent_max_dollars: '1500',
          preferred_state: 'TX',
          household_size: '2',
        }),
      ),
    ).toBe(true);
  });

  it('does not mark a profile row as complete when required fields are missing', () => {
    const merged = mergeServerRecords(
      answers({ profile_complete: true, given_name: 'Local' }),
      {
        given_name: 'Ava',
        family_name: null,
        phone_e164: null,
        email: 'ava@example.com',
        annual_income_cents: null,
        move_in_urgency: null,
        bedrooms_min: null,
        rent_max_cents: null,
        preferred_state: null,
        has_pets: null,
        household_size: null,
      },
      null,
    );
    expect(merged.given_name).toBe('Ava');
    expect(merged.profile_complete).toBe(false);
    expect(profileComplete(merged)).toBe(false);
  });

  it('requires address and employment before the application form is ready', () => {
    expect(intakeFieldsReady(answers({ employer_name: 'Acme' }))).toBe(false);
    expect(
      intakeFieldsReady(
        answers({
          current_address_line1: '1 Main',
          current_address_city: 'Austin',
          current_address_state: 'TX',
          current_address_postal: '78701',
          employer_name: 'Acme',
          job_title: 'Engineer',
        }),
      ),
    ).toBe(true);
  });
});
