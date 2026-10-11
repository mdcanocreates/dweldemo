import { describe, expect, it } from 'vitest';
import { buildApplicationProgress } from '../../src/modules/applications/progress.js';

describe('buildApplicationProgress', () => {
  it('PASS before screening skips payment stages', () => {
    const p = buildApplicationProgress({
      status: 'landlord_passed',
      created_at: '2026-01-01T00:00:00.000Z',
      passed_at: '2026-01-02T00:00:00.000Z',
    });
    expect(p.stages.some((s) => s.key === 'payment' && s.status === 'complete')).toBe(false);
    expect(p.current_stage).toBe('not_selected');
    expect(p.stages.find((s) => s.key === 'not_selected')?.status).toBe('complete');
    expect(p.next_action_owner).toBe('none');
    expect(p.is_terminal).toBe(true);
    expect(p.status_label).toBe('Passed for now');
  });

  it('Case A awaiting consent shows payment current', () => {
    const p = buildApplicationProgress({
      status: 'awaiting_consent',
      created_at: '2026-01-01T00:00:00.000Z',
      move_forward_at: '2026-01-02T00:00:00.000Z',
      reused_report: false,
    });
    expect(p.action_required).toMatch(/Authorize/i);
    expect(p.stages.find((s) => s.key === 'payment')?.status).toBe('current');
    expect(p.next_action_owner).toBe('renter');
    expect(p.primary_action?.key).toBe('authorize_screening');
    expect(p.outstanding_steps.length).toBeGreaterThan(0);
  });

  it('Case B share path has no $30 payment stage as current charge', () => {
    const p = buildApplicationProgress({
      status: 'awaiting_consent',
      created_at: '2026-01-01T00:00:00.000Z',
      move_forward_at: '2026-01-02T00:00:00.000Z',
      reused_report: true,
    });
    expect(p.stages.some((s) => s.key === 'share_auth')).toBe(true);
    expect(p.stages.some((s) => s.key === 'payment')).toBe(false);
  });

  it('Approved shows lease pending then cashback upcoming', () => {
    const p = buildApplicationProgress({
      status: 'approved',
      created_at: '2026-01-01T00:00:00.000Z',
      move_forward_at: '2026-01-02T00:00:00.000Z',
      screened_at: '2026-01-03T00:00:00.000Z',
      contact_revealed_at: '2026-01-04T00:00:00.000Z',
      reused_report: false,
      fee_paid: true,
    });
    expect(p.stages.find((s) => s.key === 'decision')?.label).toBe('Approved');
    expect(p.current_stage).toBe('lease');
    expect(p.status).toBe('approved');
    expect(p.timestamps.contact_revealed_at).toBe('2026-01-04T00:00:00.000Z');
  });

  it('info_requested assigns renter ownership and respond CTA', () => {
    const p = buildApplicationProgress({
      status: 'info_requested',
      created_at: '2026-01-01T00:00:00.000Z',
      info_requested_at: '2026-01-02T00:00:00.000Z',
    });
    expect(p.next_action_owner).toBe('renter');
    expect(p.primary_action?.key).toBe('respond_missing_info');
    expect(p.status_label).toMatch(/information/i);
  });

  it('awaiting_landlord_interest waits on home provider', () => {
    const p = buildApplicationProgress({
      status: 'awaiting_landlord_interest',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(p.next_action_owner).toBe('home_provider');
    expect(p.primary_action).toBeNull();
  });
});
