import { describe, expect, it } from 'vitest';
import { resolveClaimedParty } from '../../src/modules/auth/passwordless.js';
import { AppError } from '../../src/modules/shared/errors.js';
import {
  presentApplicationDossier,
  recordedStatusUpdates,
  shouldFreezeIntakeSnapshot,
} from '../../src/modules/renter/dossier-view.js';
import {
  authoritativeSnapshotFromFreeze,
  classifySnapshotRecovery,
  INTAKE_FROZEN_EVENT,
} from '../../src/modules/renter/lifecycle.js';
import { intakeRowReady } from '../../src/modules/renter/intake.js';

const liveProfile = {
  given_name: 'Ava',
  family_name: 'Cole',
  email: 'ava@example.com',
  phone_e164: '+15555550100',
};

describe('renter dossier presentation', () => {
  it('does not copy a later profile into a frozen snapshot', () => {
    const presented = presentApplicationDossier({
      snapshotFrozen: true,
      liveProfile: { ...liveProfile, given_name: 'Changed' },
      liveIntake: {
        current_address_line1: '9 New St',
        employer_name: 'New Co',
      },
      snapshot: {
        captured_at: '2026-01-01T00:00:00.000Z',
        contact: {
          given_name: 'Ava',
          family_name: 'Cole',
          email: 'ava@example.com',
          phone_e164: '+15555550100',
        },
        intake: {
          current_address_line1: '1 Main',
          current_address_city: 'Columbus',
          current_address_state: 'OH',
          current_address_postal: '43215',
          employer_name: 'Acme',
          job_title: 'Engineer',
        },
      },
    });
    expect(presented.mode).toBe('frozen_snapshot');
    expect(presented.contact.given_name).toEqual({
      value: 'Ava',
      source: 'submitted_snapshot',
    });
    expect(presented.residence.line1.value).toBe('1 Main');
    expect(presented.employment.employer_name.value).toBe('Acme');
    expect(presented.current_account?.reason).toBe('account_is_not_the_submission');
    expect(presented.current_account?.contact.given_name.value).toBe('Changed');
  });

  it('keeps a missing snapshot field empty and shows the current account separately', () => {
    const presented = presentApplicationDossier({
      snapshotFrozen: true,
      liveProfile,
      liveIntake: {
        current_address_line1: '9 New St',
        current_address_city: 'Austin',
        current_address_state: 'TX',
        current_address_postal: '78701',
        employer_name: 'New Co',
        job_title: 'Analyst',
      },
      snapshot: {
        captured_at: '2026-02-01T00:00:00.000Z',
        contact: null,
        intake: {},
      },
    });
    expect(presented.contact.email).toEqual({ value: null, source: 'not_on_file' });
    expect(presented.residence.line1.source).toBe('not_on_file');
    expect(presented.current_account?.contact.email.value).toBe('ava@example.com');
    expect(presented.current_account?.residence.line1.value).toBe('9 New St');
    expect(presented.current_account?.contact.email.source).toBe('current_account');
  });

  it('does not treat a missing snapshot as the current profile', () => {
    const presented = presentApplicationDossier({
      snapshot: null,
      snapshotFrozen: false,
      liveProfile,
      liveIntake: { employer_name: 'Acme', job_title: 'Engineer' },
    });
    expect(presented.mode).toBe('snapshot_absent');
    expect(presented.retrieval.snapshot).toBe('absent');
    expect(presented.contact.given_name).toEqual({ value: null, source: 'not_on_file' });
    expect(presented.employment.employer_name.source).toBe('not_on_file');
    expect(presented.current_account?.reason).toBe('account_is_not_the_submission');
    expect(presented.current_account?.contact.given_name.value).toBe('Ava');
    expect(presented.current_account?.employment.employer_name.value).toBe('Acme');
  });

  it('recovers a snapshot only from the freeze event', () => {
    const snapshot = {
      captured_at: '2026-03-01T00:00:00.000Z',
      contact: { given_name: 'Ava', family_name: 'Cole' },
      intake: { employer_name: 'Acme' },
    };
    expect(
      classifySnapshotRecovery({
        intakeSnapshot: snapshot,
        freezeEventPayload: { source: INTAKE_FROZEN_EVENT, snapshot: { captured_at: 'later' } },
      }),
    ).toMatchObject({ classification: 'snapshot_present', snapshot: null });
    expect(
      classifySnapshotRecovery({
        intakeSnapshot: null,
        freezeEventPayload: { source: INTAKE_FROZEN_EVENT, snapshot },
      }).snapshot,
    ).toEqual(snapshot);
    expect(
      classifySnapshotRecovery({
        intakeSnapshot: null,
        freezeEventPayload: { given_name: 'Ava' },
      }).classification,
    ).toBe('not_recoverable');
    expect(authoritativeSnapshotFromFreeze({ source: 'profile', snapshot })).toBeNull();
  });

  it('does not invent fields from an unrecognized snapshot', () => {
    const presented = presentApplicationDossier({
      snapshotFrozen: true,
      snapshot: { unexpected: true },
      liveProfile,
      liveIntake: null,
    });
    expect(presented.snapshot_readable).toBe(false);
    expect(presented.snapshot_shape).toBe('unrecognized');
    expect(presented.contact.given_name.value).toBeNull();
    expect(presented.current_account?.contact.given_name.value).toBe('Ava');
  });

  it('reads a legacy flat intake snapshot without inventing contact', () => {
    const presented = presentApplicationDossier({
      snapshotFrozen: true,
      snapshot: {
        current_address_line1: '1 Main',
        employer_name: 'Acme',
      },
      liveProfile,
      liveIntake: null,
    });
    expect(presented.snapshot_shape).toBe('flat_intake');
    expect(presented.residence.line1.value).toBe('1 Main');
    expect(presented.contact.email.source).toBe('not_on_file');
  });

  it('records only timestamps that were actually stored', () => {
    const updates = recordedStatusUpdates({
      created_at: '2026-01-01T00:00:00.000Z',
      move_forward_at: null,
      screened_at: '2026-01-03T00:00:00.000Z',
      closed_at: undefined,
    });
    expect(updates.map((item) => item.label)).toEqual([
      'Application created',
      'Screening result was recorded',
    ]);
  });

  it('refuses to freeze a snapshot that already exists', () => {
    expect(shouldFreezeIntakeSnapshot(null)).toBe(true);
    expect(shouldFreezeIntakeSnapshot(undefined)).toBe(true);
    expect(shouldFreezeIntakeSnapshot({ contact: {} })).toBe(false);
  });
});

describe('intake readiness', () => {
  it('requires address and employment before intake is ready', () => {
    expect(intakeRowReady({ employer_name: 'Acme', job_title: 'Engineer' })).toBe(false);
    expect(intakeRowReady(null)).toBe(false);
    expect(
      intakeRowReady({
        current_address_line1: '1 Main',
        current_address_city: 'Austin',
        current_address_state: 'TX',
        current_address_postal: '78701',
        employer_name: 'Acme',
        job_title: 'Engineer',
      }),
    ).toBe(true);
  });
});

describe('email identity claim', () => {
  it('keeps the party that already owns the email and does not merge the new one', () => {
    const claimed = resolveClaimedParty({
      createdPartyId: 'new-party',
      claimInserted: false,
      existingPartyId: 'canonical-party',
    });
    expect(claimed.partyId).toBe('canonical-party');
    expect(claimed.orphanPartyId).toBe('new-party');
  });

  it('uses the new party when the email claim is inserted', () => {
    const claimed = resolveClaimedParty({
      createdPartyId: 'new-party',
      claimInserted: true,
      existingPartyId: null,
    });
    expect(claimed).toEqual({ partyId: 'new-party', orphanPartyId: null });
  });

  it('fails closed when the email row cannot be resolved', () => {
    expect(() =>
      resolveClaimedParty({
        createdPartyId: 'new-party',
        claimInserted: false,
        existingPartyId: null,
      }),
    ).toThrow(AppError);
  });
});
