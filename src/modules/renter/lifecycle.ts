/**
 * Renter lifecycle rules that must stay the same in the portal and Admin.
 * A missing snapshot is not filled from the current profile. The only
 * historical source that may be written back is the freeze event recorded
 * when that application was submitted.
 */

export const INTAKE_FROZEN_EVENT = 'application.intake_frozen';

const APPLICATION_STATUS_LABELS: Record<string, string> = {
  draft: 'Started, not sent',
  submitted: 'Submitted',
  awaiting_landlord_interest: 'Interest sent',
  mutual_interest: 'Home provider is interested',
  prescreen: 'Pre-screen in progress',
  interested: 'Interest sent',
  awaiting_consent: 'Screening authorization needed',
  screening_authorized: 'Screening authorized',
  screening_running: 'Screening in progress',
  screening_in_progress: 'Screening in progress',
  awaiting_provider_configuration: 'Screening unavailable',
  screened: 'Screening complete',
  screening_complete: 'Screening complete',
  info_requested: 'More information requested',
  more_info_requested: 'More information requested',
  landlord_passed: 'Passed for now',
  approved: 'Approved',
  declined: 'Not selected',
  withdrawn: 'Withdrawn',
  closed: 'Closed',
  prescreen_failed: 'Pre-screen did not pass',
  screening_error: 'Screening unavailable',
  awaiting_screening_request: 'Waiting for the home provider',
};

const LISTING_STATUS_LABELS: Record<string, string> = {
  draft: 'Not published',
  active: 'Available',
  paused: 'Paused',
  stale: 'Needs confirmation',
  expired: 'Expired',
  rented: 'Rented',
  removed: 'Removed',
  archived: 'Archived',
};

export type SnapshotRecoveryClass =
  | 'snapshot_present'
  | 'recoverable_from_freeze_event'
  | 'not_recoverable';

export type SnapshotRecovery = {
  classification: SnapshotRecoveryClass;
  reasons: string[];
  /** Present only when a freeze event can replace a null snapshot. Never a live profile. */
  snapshot: Record<string, unknown> | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function applicationStatusLabel(status: string): string {
  return APPLICATION_STATUS_LABELS[status] ?? status.replaceAll('_', ' ');
}

export function listingStatusLabel(status: string | null | undefined): string {
  if (!status?.trim()) return 'Not recorded';
  return LISTING_STATUS_LABELS[status] ?? status.replaceAll('_', ' ');
}

export function submittedContactName(snapshot: unknown): string | null {
  if (!isRecord(snapshot) || !isRecord(snapshot.contact)) return null;
  const given = snapshot.contact.given_name;
  const family = snapshot.contact.family_name;
  const name = [given, family]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim())
    .join(' ');
  return name || null;
}

export function submittedContactEmail(snapshot: unknown): string | null {
  if (!isRecord(snapshot) || !isRecord(snapshot.contact)) return null;
  const email = snapshot.contact.email;
  return typeof email === 'string' && email.trim() ? email.trim() : null;
}

/** A freeze-event payload is authoritative only when it carries the snapshot written at submit. */
export function authoritativeSnapshotFromFreeze(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload) || payload.source !== INTAKE_FROZEN_EVENT) return null;
  if (!isRecord(payload.snapshot)) return null;
  const captured = payload.snapshot.captured_at;
  if (typeof captured !== 'string' || !captured.trim()) return null;
  const hasContact = isRecord(payload.snapshot.contact);
  const hasIntake = isRecord(payload.snapshot.intake);
  if (!hasContact && !hasIntake) return null;
  return payload.snapshot;
}

export function classifySnapshotRecovery(input: {
  intakeSnapshot: unknown;
  freezeEventPayload: unknown | null;
}): SnapshotRecovery {
  if (input.intakeSnapshot != null) {
    return {
      classification: 'snapshot_present',
      reasons: ['stored_snapshot_is_kept'],
      snapshot: null,
    };
  }
  const recovered = authoritativeSnapshotFromFreeze(input.freezeEventPayload);
  if (recovered) {
    return {
      classification: 'recoverable_from_freeze_event',
      reasons: ['freeze_event_captured_at_submit'],
      snapshot: recovered,
    };
  }
  return {
    classification: 'not_recoverable',
    reasons: [
      'no_freeze_event',
      'live_profile_is_not_a_historical_submission',
      'live_intake_is_not_a_historical_submission',
    ],
    snapshot: null,
  };
}
