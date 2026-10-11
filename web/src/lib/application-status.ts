/** Human-readable application / screening status for production UI. */

export type StatusTone = 'neutral' | 'mint' | 'amber' | 'red' | 'blue' | 'gray';

const LABELS: Record<string, string> = {
  draft: 'Draft',
  awaiting_landlord_interest: 'Interest sent',
  awaiting_screening_request: 'Waiting for Home Provider',
  awaiting_consent: 'Screening authorization needed',
  screening_authorized: 'Screening authorized',
  screening_running: 'Screening in progress',
  screening_in_progress: 'Screening in progress',
  screened: 'Screening complete',
  screening_complete: 'Screening complete',
  awaiting_provider_configuration: 'Screening unavailable',
  approved: 'Approved',
  declined: 'Not selected',
  withdrawn: 'Withdrawn',
  landlord_passed: 'Passed for now',
  info_requested: 'More information requested',
  more_info_requested: 'More information requested',
  interested: 'Interest sent',
  submitted: 'Waiting for Home Provider',
  screening_error: 'Screening unavailable',
  active: 'Active',
  paused: 'Paused',
  rented: 'Rented',
};

const TONES: Record<string, StatusTone> = {
  draft: 'gray',
  awaiting_landlord_interest: 'blue',
  awaiting_screening_request: 'amber',
  awaiting_consent: 'amber',
  screening_authorized: 'blue',
  screening_running: 'blue',
  screening_in_progress: 'blue',
  screened: 'mint',
  screening_complete: 'mint',
  awaiting_provider_configuration: 'red',
  approved: 'mint',
  declined: 'red',
  withdrawn: 'gray',
  landlord_passed: 'gray',
  info_requested: 'amber',
  more_info_requested: 'amber',
  interested: 'blue',
  submitted: 'amber',
  screening_error: 'red',
  active: 'mint',
  paused: 'amber',
  rented: 'gray',
};

export function applicationStatusLabel(status: string): string {
  return LABELS[status] ?? status.replaceAll('_', ' ');
}

export function applicationStatusTone(status: string): StatusTone {
  return TONES[status] ?? 'neutral';
}

const CHECK_LABELS: Record<string, string> = {
  not_requested: 'Not requested',
  pending_consent: 'Awaiting consent',
  in_progress: 'In progress',
  clear: 'Clear',
  review: 'Review recommended',
  error: 'Unavailable',
  unavailable: 'Unavailable',
  unknown: 'Pending',
};

/** Human-readable screening check result for Home Provider / broker views. */
export function screeningCheckLabel(status: string): string {
  return CHECK_LABELS[status] ?? status.replaceAll('_', ' ');
}

/**
 * @deprecated Prefer server `progress` from listMyApplications.
 * Client timeline is not used by ApplicationDetailPage (Sprint 1).
 */
export type TimelineStage =
  | 'interest'
  | 'requested'
  | 'consent'
  | 'payment'
  | 'in_progress'
  | 'complete'
  | 'decision';

export function applicationTimeline(status: string): {
  stages: Array<{ id: TimelineStage; label: string; state: 'done' | 'current' | 'upcoming' }>;
  nextAction: { label: string; href?: string; kind: 'primary' | 'secondary' | 'none' };
  nextCopy: string;
} {
  const order: TimelineStage[] = [
    'interest',
    'requested',
    'consent',
    'payment',
    'in_progress',
    'complete',
    'decision',
  ];
  const labels: Record<TimelineStage, string> = {
    interest: 'Interest sent',
    requested: 'Requested',
    consent: 'Consent',
    payment: 'Payment',
    in_progress: 'In progress',
    complete: 'Complete',
    decision: 'Decision',
  };

  let current: TimelineStage = 'interest';
  if (status === 'awaiting_landlord_interest' || status === 'info_requested') current = 'interest';
  else if (status === 'awaiting_screening_request') current = 'requested';
  else if (status === 'awaiting_consent') current = 'consent';
  else if (status === 'screening_authorized') current = 'payment';
  else if (status === 'screening_running' || status === 'screening_in_progress') {
    current = 'in_progress';
  } else if (status === 'screened' || status === 'screening_complete') current = 'complete';
  else if (status === 'approved' || status === 'declined' || status === 'landlord_passed') {
    current = 'decision';
  }

  const idx = order.indexOf(current);
  const stages = order.map((id, i) => ({
    id,
    label: labels[id],
    state: (i < idx ? 'done' : i === idx ? 'current' : 'upcoming') as 'done' | 'current' | 'upcoming',
  }));

  if (status === 'awaiting_consent') {
    return {
      stages,
      nextAction: { label: 'Authorize screening', href: 'screening', kind: 'primary' },
      nextCopy:
        'Your Home Provider moved forward. Authorize screening for this Home Provider — you may reuse an eligible report or pay the screening fee once.',
    };
  }
  if (status === 'info_requested' || status === 'more_info_requested') {
    return {
      stages,
      nextAction: { label: 'Respond to request', href: undefined, kind: 'none' },
      nextCopy:
        'The Home Provider requested additional permitted information. Respond below to continue review.',
    };
  }
  if (status === 'screening_running' || status === 'screening_in_progress') {
    return {
      stages,
      nextAction: { label: 'Back to applications', href: '/applications', kind: 'secondary' },
      nextCopy: 'Screening is in progress. We will update this application when it completes.',
    };
  }
  if (status === 'screened' || status === 'screening_complete') {
    return {
      stages,
      nextAction: { label: 'Back to applications', href: '/applications', kind: 'secondary' },
      nextCopy: 'Your screening is complete. The Home Provider is reviewing your application.',
    };
  }
  if (status === 'approved') {
    return {
      stages,
      nextAction: { label: 'Back to applications', href: '/applications', kind: 'secondary' },
      nextCopy:
        'You were approved. Lease and cashback stages appear here when the Home Provider records them. Contact details may appear when shared.',
    };
  }
  if (status === 'declined') {
    return {
      stages,
      nextAction: { label: 'Browse more homes', href: '/search', kind: 'primary' },
      nextCopy: 'This application was not selected. Keep browsing — your profile can be reused.',
    };
  }
  if (status === 'landlord_passed') {
    return {
      stages,
      nextAction: { label: 'Browse more homes', href: '/search', kind: 'primary' },
      nextCopy:
        'The Home Provider passed for now. You can keep browsing other homes — this is not a final denial based on a consumer report.',
    };
  }
  if (status === 'awaiting_landlord_interest') {
    return {
      stages,
      nextAction: { label: 'Browse more homes', href: '/search', kind: 'secondary' },
      nextCopy: 'Interest sent. Waiting for the Home Provider to move forward or request more information.',
    };
  }
  return {
    stages,
    nextAction: { label: 'Back to applications', href: '/applications', kind: 'secondary' },
    nextCopy: 'Track progress here as your application moves forward.',
  };
}

export function friendlyApiError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('forbidden') || m.includes('auth_forbidden') || m.includes('role required')) {
    return "You don't have access to this application.";
  }
  if (m.includes('screening_provider') || m.includes('certn') || m.includes('unavailable')) {
    return 'Screening is temporarily unavailable. No new screening has been submitted. Please try again later.';
  }
  if (m.includes('payment') || m.includes('payment_intent') || m.includes('charge')) {
    return "We couldn't complete your payment. Check whether a charge was recorded before trying again.";
  }
  if (m.includes('not found') || m.includes('application_not_found')) {
    return 'We could not find that application.';
  }
  if (m.includes('auth') || m.includes('sign in') || m.includes('session')) {
    return 'Please sign in to continue.';
  }
  if (m.includes('internal') || m.includes('500')) {
    return 'Something went wrong on our side. Please try again or contact support.';
  }
  return message;
}

export const PASS_REASON_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'income_below', label: 'Income below stated criteria' },
  { code: 'move_in_mismatch', label: 'Move-in timing mismatch' },
  { code: 'pet_policy', label: 'Pet policy' },
  { code: 'occupancy_exceeded', label: 'Occupancy exceeded' },
  { code: 'lease_term', label: 'Lease term mismatch' },
  { code: 'incomplete_profile', label: 'Incomplete profile' },
  { code: 'unit_unavailable', label: 'Unit no longer available' },
];

export const MISSING_INFO_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'move_in', label: 'Move-in timing' },
  { code: 'income', label: 'Income details' },
  { code: 'occupants', label: 'Occupants / household' },
  { code: 'pets', label: 'Pets' },
  { code: 'lease_term', label: 'Preferred lease term' },
  { code: 'incomplete_profile', label: 'Incomplete profile fields' },
];
