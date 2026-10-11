import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/modules/shared/errors.js';
import {
  validateRequiredDocumentTypes,
  REQUIRED_DOCUMENT_TYPES,
} from '../../src/modules/renter/missing-info-docs.js';

/** Mirrors src/modules/internal/cases.ts applicationAllowedActions — keep in sync. */
function applicationAllowedActions(status: string): string[] {
  const terminal = new Set([
    'approved',
    'declined',
    'landlord_passed',
    'withdrawn',
    'closed',
  ]);
  if (terminal.has(status)) return [];
  const actions: string[] = [];
  if (
    [
      'draft',
      'submitted',
      'awaiting_landlord_interest',
      'interested',
      'info_requested',
      'awaiting_consent',
      'screening_authorized',
      'screening_running',
      'screening_in_progress',
      'awaiting_provider_configuration',
      'screened',
      'screening_complete',
    ].includes(status)
  ) {
    actions.push('request_information');
  }
  if (status === 'awaiting_landlord_interest' || status === 'info_requested') {
    actions.push('accept_missing_info', 'return_missing_info');
  }
  return actions;
}

describe('missing-info document types', () => {
  it('accepts empty list', () => {
    expect(validateRequiredDocumentTypes([])).toEqual([]);
    expect(validateRequiredDocumentTypes(undefined)).toEqual([]);
  });

  it('accepts whitelist types', () => {
    expect(validateRequiredDocumentTypes(['proof_of_income', 'id_document'])).toEqual([
      'proof_of_income',
      'id_document',
    ]);
  });

  it('rejects unknown types', () => {
    expect(() => validateRequiredDocumentTypes(['ssn_card'])).toThrow(AppError);
  });

  it('exports required document type catalog', () => {
    expect(REQUIRED_DOCUMENT_TYPES).toContain('proof_of_income');
  });
});

describe('CC application allowed actions (policy mirror)', () => {
  it('does not expose approve/decline for staff', () => {
    const actions = applicationAllowedActions('screening_complete');
    expect(actions).not.toContain('approve');
    expect(actions).not.toContain('decline');
    expect(actions).toContain('request_information');
  });

  it('exposes accept/return when awaiting landlord interest', () => {
    const actions = applicationAllowedActions('awaiting_landlord_interest');
    expect(actions).toContain('accept_missing_info');
    expect(actions).toContain('return_missing_info');
  });

  it('terminal statuses have no staff actions', () => {
    expect(applicationAllowedActions('approved')).toEqual([]);
    expect(applicationAllowedActions('declined')).toEqual([]);
  });
});
