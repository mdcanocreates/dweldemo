/**
 * Frontend contract: renter UI consumes server ApplicationProgress shape
 * without inventing a parallel state machine.
 */
import { describe, expect, it } from 'vitest';
import type { ApplicationProgress } from '../components/application/ApplicationProgressTimeline';

function assertProgressContract(p: ApplicationProgress): void {
  expect(typeof p.current_stage).toBe('string');
  expect(typeof p.current_label).toBe('string');
  expect(Array.isArray(p.stages)).toBe(true);
  expect(p.stages.length).toBeGreaterThan(0);
  for (const s of p.stages) {
    expect(s.key).toBeTruthy();
    expect(['complete', 'current', 'upcoming', 'skipped', 'blocked']).toContain(s.status);
  }
  if (p.next_action_owner != null) {
    expect(['renter', 'home_provider', 'system', 'none']).toContain(p.next_action_owner);
  }
  if (p.primary_action) {
    expect(p.primary_action.key).toBeTruthy();
    expect(p.primary_action.label).toBeTruthy();
  }
  if (p.outstanding_steps) {
    expect(Array.isArray(p.outstanding_steps)).toBe(true);
  }
}

describe('ApplicationProgress FE contract', () => {
  it('accepts server-shaped progress with Sprint 1 fields', () => {
    const sample: ApplicationProgress = {
      status: 'awaiting_consent',
      status_label: 'Screening authorization needed',
      current_stage: 'screening_auth',
      current_label: 'Screening authorization',
      next_action_owner: 'renter',
      primary_action: {
        key: 'authorize_screening',
        label: 'Authorize screening',
        href_hint: 'screening',
      },
      outstanding_steps: [
        {
          key: 'authorize_screening',
          label: 'Authorize screening and complete payment if required.',
          owner: 'renter',
        },
      ],
      action_required: 'Authorize screening and complete payment if required.',
      last_update_at: '2026-01-02T00:00:00.000Z',
      next_step: 'Open screening on this application.',
      is_terminal: false,
      stages: [
        {
          key: 'interest_sent',
          label: 'Interest sent',
          status: 'complete',
          completed_at: '2026-01-01T00:00:00.000Z',
          explanation: 'Sent',
          action_required: null,
        },
        {
          key: 'screening_auth',
          label: 'Screening authorization',
          status: 'current',
          completed_at: null,
          explanation: 'Authorize',
          action_required: 'Authorize screening',
        },
      ],
    };
    assertProgressContract(sample);
  });

  it('accepts legacy progress without optional Sprint 1 fields (backward compatible)', () => {
    const legacy: ApplicationProgress = {
      current_stage: 'hp_review',
      current_label: 'Home Provider reviewing',
      action_required: null,
      last_update_at: null,
      next_step: 'Wait',
      stages: [
        {
          key: 'interest_sent',
          label: 'Interest sent',
          status: 'complete',
          completed_at: null,
          explanation: 'x',
          action_required: null,
        },
      ],
    };
    assertProgressContract(legacy);
  });
});
