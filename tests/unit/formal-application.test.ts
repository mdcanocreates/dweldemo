import { describe, expect, it } from 'vitest';
import { formalApplicationReady } from '../../src/modules/applications/formal.js';

const readyIntake = {
  current_address_line1: '1 Main',
  current_address_city: 'Austin',
  current_address_state: 'TX',
  current_address_postal: '78702',
  employer_name: 'Acme',
  job_title: 'Analyst',
  monthly_gross_income_cents: 400000,
};

describe('formal application readiness', () => {
  it('requires stated income and household size', () => {
    const missingIncome = formalApplicationReady({
      intake: { ...readyIntake, monthly_gross_income_cents: null },
      householdSize: 2,
    });
    expect(missingIncome.ok).toBe(false);
    if (!missingIncome.ok) expect(missingIncome.missing).toContain('income');

    const missingHousehold = formalApplicationReady({
      intake: readyIntake,
      householdSize: null,
    });
    expect(missingHousehold.ok).toBe(false);
    if (!missingHousehold.ok) expect(missingHousehold.missing).toContain('household');
  });

  it('accepts a stated zero income and does not read rent', () => {
    const ready = formalApplicationReady({
      intake: { ...readyIntake, monthly_gross_income_cents: 0 },
      householdSize: 1,
    });
    expect(ready).toEqual({ ok: true });
  });
});
