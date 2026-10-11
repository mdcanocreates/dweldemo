import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/modules/shared/errors.js';
import {
  assertHpTransitionAllowed,
  listHpTransitionMatrix,
  normalizeHpDecision,
} from '../../src/modules/applications/transitions.js';

describe('HP application transition policy', () => {
  it('aliases move_forward to request_screening', () => {
    expect(normalizeHpDecision('move_forward')).toBe('request_screening');
  });

  it('allows approve only from screened statuses', () => {
    expect(
      assertHpTransitionAllowed({
        fromStatus: 'screening_complete',
        decision: 'approve',
      }).toStatus,
    ).toBe('approved');
    expect(() =>
      assertHpTransitionAllowed({
        fromStatus: 'awaiting_consent',
        decision: 'approve',
      }),
    ).toThrow(AppError);
  });

  it('rejects transitions from terminal statuses with 409', () => {
    try {
      assertHpTransitionAllowed({ fromStatus: 'declined', decision: 'pass' });
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(409);
      expect((err as AppError).code).toBe('invalid_transition');
    }
  });

  it('allows request_screening from awaiting_landlord_interest', () => {
    const rule = assertHpTransitionAllowed({
      fromStatus: 'awaiting_landlord_interest',
      decision: 'move_forward',
    });
    expect(rule.decision).toBe('request_screening');
    expect(rule.toStatus).toBe('awaiting_consent');
  });

  it('rejects request_screening once screening is already running', () => {
    expect(() =>
      assertHpTransitionAllowed({
        fromStatus: 'screening_running',
        decision: 'request_screening',
      }),
    ).toThrow(/Cannot 'request_screening'/);
  });

  it('matrix covers every rule × status combination', () => {
    const matrix = listHpTransitionMatrix();
    expect(matrix.length).toBeGreaterThan(50);
    const approveFromScreened = matrix.find(
      (r) => r.decision === 'approve' && r.fromStatus === 'screened',
    );
    expect(approveFromScreened?.allowed).toBe(true);
    const approveFromDraft = matrix.find(
      (r) => r.decision === 'approve' && r.fromStatus === 'draft',
    );
    expect(approveFromDraft?.allowed).toBe(false);
    const passFromApproved = matrix.find(
      (r) => r.decision === 'pass' && r.fromStatus === 'approved',
    );
    expect(passFromApproved?.allowed).toBe(false);
  });
});
