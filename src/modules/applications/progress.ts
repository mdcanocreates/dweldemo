/**
 * State-derived renter application progress timeline.
 * No hardcoded demo stages — branches from application + screening + lease + cashback status.
 */

export type ProgressStageStatus = 'complete' | 'current' | 'upcoming' | 'skipped' | 'blocked';

export type ProgressStage = {
  key: string;
  label: string;
  status: ProgressStageStatus;
  completed_at: string | null;
  explanation: string;
  action_required: string | null;
};

export type NextActionOwner = 'renter' | 'home_provider' | 'system' | 'none';

export type PrimaryAction = {
  key: string;
  label: string;
  href_hint: string | null;
} | null;

export type OutstandingStep = {
  key: string;
  label: string;
  owner: NextActionOwner;
};

export type ApplicationProgress = {
  /** Raw persisted application.status */
  status: string;
  /** Human-readable status label */
  status_label: string;
  current_stage: string;
  current_label: string;
  /** Who owns the next step */
  next_action_owner: NextActionOwner;
  /** Single primary CTA for the renter UI (null when waiting / terminal) */
  primary_action: PrimaryAction;
  /** Outstanding requirements visible to the renter */
  outstanding_steps: OutstandingStep[];
  action_required: string | null;
  last_update_at: string | null;
  next_step: string | null;
  stages: ProgressStage[];
  is_terminal: boolean;
  timestamps: {
    created_at: string;
    move_forward_at: string | null;
    passed_at: string | null;
    info_requested_at: string | null;
    screening_authorized_at: string | null;
    screened_at: string | null;
    contact_revealed_at: string | null;
    closed_at: string | null;
  };
};

type Input = {
  status: string;
  created_at: string;
  move_forward_at?: string | null;
  passed_at?: string | null;
  info_requested_at?: string | null;
  screening_authorized_at?: string | null;
  screened_at?: string | null;
  closed_at?: string | null;
  contact_revealed_at?: string | null;
  reused_report?: boolean;
  fee_paid?: boolean;
  lease_workflow_status?: string | null;
  cashback_status?: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  awaiting_landlord_interest: 'Interest sent',
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
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replaceAll('_', ' ');
}

function stage(
  key: string,
  label: string,
  status: ProgressStageStatus,
  explanation: string,
  opts?: { completed_at?: string | null; action_required?: string | null },
): ProgressStage {
  return {
    key,
    label,
    status,
    completed_at: opts?.completed_at ?? null,
    explanation,
    action_required: opts?.action_required ?? null,
  };
}

function ownerForStatus(s: string): NextActionOwner {
  if (
    s === 'info_requested' ||
    s === 'more_info_requested' ||
    s === 'awaiting_consent' ||
    s === 'screening_authorized'
  ) {
    return 'renter';
  }
  if (
    s === 'screening_running' ||
    s === 'screening_in_progress' ||
    s === 'awaiting_provider_configuration'
  ) {
    return 'system';
  }
  if (
    s === 'approved' ||
    s === 'declined' ||
    s === 'landlord_passed' ||
    s === 'withdrawn' ||
    s === 'closed'
  ) {
    return 'none';
  }
  return 'home_provider';
}

function primaryFor(
  s: string,
  lease: string | null | undefined,
): PrimaryAction {
  if (s === 'info_requested' || s === 'more_info_requested') {
    return {
      key: 'respond_missing_info',
      label: 'Respond to information request',
      href_hint: 'detail',
    };
  }
  if (s === 'awaiting_consent') {
    return {
      key: 'authorize_screening',
      label: 'Authorize screening',
      href_hint: 'screening',
    };
  }
  if (s === 'screening_authorized') {
    return {
      key: 'submit_screening',
      label: 'Continue screening',
      href_hint: 'screening',
    };
  }
  if (s === 'approved') {
    const leaseAvail =
      lease === 'available_to_renter' ||
      lease === 'acknowledged' ||
      lease === 'complete' ||
      lease === 'executed_copy_uploaded';
    if (leaseAvail && lease !== 'complete' && lease !== 'executed_copy_uploaded') {
      return {
        key: 'review_lease',
        label: 'Review lease documents',
        href_hint: 'detail',
      };
    }
    return null;
  }
  if (s === 'declined' || s === 'landlord_passed') {
    return {
      key: 'browse_more',
      label: 'Browse more homes',
      href_hint: 'search',
    };
  }
  return null;
}

export function buildApplicationProgress(input: Input): ApplicationProgress {
  const s = input.status;
  const stages: ProgressStage[] = [];
  const timestamps = {
    created_at: input.created_at,
    move_forward_at: input.move_forward_at ?? null,
    passed_at: input.passed_at ?? null,
    info_requested_at: input.info_requested_at ?? null,
    screening_authorized_at: input.screening_authorized_at ?? null,
    screened_at: input.screened_at ?? null,
    contact_revealed_at: input.contact_revealed_at ?? null,
    closed_at: input.closed_at ?? null,
  };

  stages.push(
    stage('interest_sent', 'Interest sent', 'complete', 'Your interest was sent to the Home Provider.', {
      completed_at: input.created_at,
    }),
  );

  // PASS before screening
  if (s === 'landlord_passed') {
    stages.push(
      stage(
        'hp_review',
        'Home Provider reviewed',
        'complete',
        'The Home Provider reviewed your interest.',
        { completed_at: input.passed_at ?? null },
      ),
      stage(
        'not_selected',
        'Not selected',
        'complete',
        'The Home Provider passed for now. This is not a final post-screening denial.',
        { completed_at: input.passed_at ?? null },
      ),
    );
    return summarize(
      stages,
      'not_selected',
      input.passed_at ?? input.created_at,
      null,
      null,
      input,
      timestamps,
    );
  }

  if (s === 'info_requested' || s === 'more_info_requested') {
    stages.push(
      stage(
        'hp_review',
        'Home Provider reviewing',
        'complete',
        'The Home Provider asked for additional permitted information.',
        { completed_at: input.info_requested_at ?? null },
      ),
      stage(
        'missing_info',
        'Information requested',
        'current',
        'Respond with the requested details so review can continue.',
        {
          completed_at: null,
          action_required: 'Respond to the missing information request.',
        },
      ),
    );
    return summarize(
      stages,
      'missing_info',
      input.info_requested_at ?? input.created_at,
      'Respond to the missing information request.',
      'Submit your response on the application detail page.',
      input,
      timestamps,
    );
  }

  const movedForward =
    Boolean(input.move_forward_at) ||
    [
      'awaiting_consent',
      'screening_authorized',
      'screening_running',
      'screening_in_progress',
      'awaiting_provider_configuration',
      'screened',
      'screening_complete',
      'approved',
      'declined',
    ].includes(s);

  if (!movedForward) {
    stages.push(
      stage(
        'hp_review',
        'Home Provider reviewing',
        'current',
        'No action needed from you right now. If the Home Provider moves forward, we will ask you to share a recent screening report or complete screening.',
        { action_required: null },
      ),
      stage('move_forward', 'Moved forward', 'upcoming', 'Waiting for the Home Provider.'),
      stage('screening', 'Screening', 'upcoming', 'Starts only after Move Forward.'),
      stage('final_review', 'Final review', 'upcoming', 'After screening is complete.'),
      stage('decision', 'Decision', 'upcoming', 'Approve or decline by the Home Provider.'),
    );
    return summarize(
      stages,
      'hp_review',
      input.created_at,
      null,
      'Wait for the Home Provider to review your interest.',
      input,
      timestamps,
    );
  }

  stages.push(
    stage(
      'hp_review',
      'Home Provider reviewing',
      'complete',
      'The Home Provider reviewed your interest.',
      { completed_at: input.move_forward_at ?? null },
    ),
    stage(
      'move_forward',
      'Home Provider moved forward',
      'complete',
      'The Home Provider wants to proceed to screening or report sharing.',
      { completed_at: input.move_forward_at ?? null },
    ),
  );

  const caseB = Boolean(input.reused_report);
  const screeningDone = ['screened', 'screening_complete', 'approved', 'declined'].includes(s);
  const screeningBusy = [
    'screening_authorized',
    'screening_running',
    'screening_in_progress',
    'awaiting_provider_configuration',
  ].includes(s);

  if (caseB) {
    stages.push(
      stage(
        'existing_report',
        'Existing report found',
        screeningDone || screeningBusy || s === 'awaiting_consent' ? 'complete' : 'current',
        'An eligible recent screening report can be shared for this Home Provider.',
      ),
      stage(
        'share_auth',
        'Report sharing authorized',
        screeningDone
          ? 'complete'
          : s === 'awaiting_consent'
            ? 'current'
            : screeningBusy
              ? 'complete'
              : 'upcoming',
        'You authorize this specific Home Provider to use your eligible report. No second screening charge.',
        {
          action_required:
            s === 'awaiting_consent' ? 'Authorize sharing your eligible report.' : null,
          completed_at: input.screening_authorized_at ?? null,
        },
      ),
      stage(
        'report_shared',
        'Report shared',
        screeningDone ? 'complete' : 'upcoming',
        'Authorized screening result is available for this application.',
        { completed_at: input.screened_at ?? null },
      ),
    );
  } else {
    const needsAuth = s === 'awaiting_consent';
    stages.push(
      stage(
        'screening_auth',
        'Screening authorization',
        screeningDone || screeningBusy
          ? 'complete'
          : needsAuth
            ? 'current'
            : 'upcoming',
        'Authorize screening for this Home Provider and application.',
        {
          action_required: needsAuth ? 'Authorize screening and complete payment if required.' : null,
          completed_at: input.screening_authorized_at ?? null,
        },
      ),
      stage(
        'payment',
        '$30 payment',
        input.fee_paid || screeningDone || screeningBusy
          ? 'complete'
          : needsAuth
            ? 'current'
            : 'upcoming',
        'A one-time screening fee applies when no eligible report exists.',
      ),
      stage(
        'screening_started',
        'Screening started',
        screeningDone ? 'complete' : screeningBusy ? 'current' : 'upcoming',
        'Screening is in progress with the screening provider.',
      ),
      stage(
        'screening_complete',
        'Screening complete',
        screeningDone ? 'complete' : 'upcoming',
        'Normalized results are ready for Home Provider review.',
        { completed_at: input.screened_at ?? null },
      ),
    );
  }

  if (s === 'declined') {
    stages.push(
      stage(
        'final_review',
        'Home Provider final review',
        'complete',
        'The Home Provider completed final review.',
      ),
      stage(
        'decision',
        'Not selected',
        'complete',
        'A decision was recorded. Legally required adverse-action notices are counsel-gated and are not auto-generated here.',
        { completed_at: input.closed_at ?? null },
      ),
    );
    return summarize(
      stages,
      'decision',
      input.closed_at ?? input.screened_at ?? null,
      null,
      null,
      input,
      timestamps,
    );
  }

  if (s === 'approved') {
    stages.push(
      stage(
        'final_review',
        'Home Provider final review',
        'complete',
        'The Home Provider completed final review.',
      ),
      stage(
        'decision',
        'Approved',
        'complete',
        'You were approved. Contact may be shared for lease next steps.',
        { completed_at: input.contact_revealed_at ?? input.closed_at ?? null },
      ),
    );
    const lease = input.lease_workflow_status;
    const leaseDone = lease === 'complete' || lease === 'executed_copy_uploaded';
    const leaseAck = lease === 'acknowledged';
    const leaseAvail = lease === 'available_to_renter' || leaseAck || leaseDone;
    stages.push(
      stage(
        'lease',
        leaseDone ? 'Lease documents complete' : leaseAvail ? 'Lease available' : 'Lease pending',
        leaseDone ? 'complete' : leaseAvail ? 'current' : 'current',
        'Document workflow only — this is not an electronic signature product.',
        {
          action_required: leaseAvail && !leaseDone ? 'Review and download your lease documents.' : null,
        },
      ),
      stage(
        'cashback',
        'Cashback eligibility',
        input.cashback_status
          ? input.cashback_status === 'paid'
            ? 'complete'
            : 'current'
          : 'upcoming',
        'Display offer status only. Funding and payout are a business decision and are not activated here.',
      ),
    );
    return summarize(
      stages,
      leaseDone ? 'cashback' : 'lease',
      input.contact_revealed_at ?? null,
      leaseAvail && !leaseDone ? 'Review lease documents.' : null,
      leaseAvail ? 'Open lease documents on this application.' : 'Waiting for lease documents.',
      input,
      timestamps,
    );
  }

  // After move forward, not yet decided
  if (screeningDone) {
    stages.push(
      stage(
        'final_review',
        'Home Provider final review',
        'current',
        'No action needed from you right now. The Home Provider is reviewing screening results.',
      ),
      stage('decision', 'Decision', 'upcoming', 'Waiting for the Home Provider decision.'),
    );
    return summarize(
      stages,
      'final_review',
      input.screened_at ?? null,
      null,
      'Wait for the Home Provider final review.',
      input,
      timestamps,
    );
  }

  if (screeningBusy) {
    stages.push(
      stage('final_review', 'Final review', 'upcoming', 'After screening completes.'),
      stage('decision', 'Decision', 'upcoming', 'Waiting for screening and Home Provider review.'),
    );
    return summarize(
      stages,
      caseB ? 'report_shared' : 'screening_started',
      input.screening_authorized_at ?? input.move_forward_at ?? null,
      null,
      'Screening is in progress.',
      input,
      timestamps,
    );
  }

  // awaiting_consent
  stages.push(
    stage('final_review', 'Final review', 'upcoming', 'After screening or share completes.'),
    stage('decision', 'Decision', 'upcoming', 'Waiting for authorization.'),
  );
  return summarize(
    stages,
    caseB ? 'share_auth' : 'screening_auth',
    input.move_forward_at ?? null,
    caseB
      ? 'Authorize sharing your eligible report.'
      : 'Authorize screening and pay if required.',
    'Open screening on this application.',
    input,
    timestamps,
  );
}

function summarize(
  stages: ProgressStage[],
  currentKey: string,
  lastUpdate: string | null,
  action: string | null,
  next: string | null,
  input: Input,
  timestamps: ApplicationProgress['timestamps'],
): ApplicationProgress {
  const current = stages.find((x) => x.key === currentKey);
  const actionRequired = action ?? current?.action_required ?? null;
  const nextOwner = ownerForStatus(input.status);
  const primary = primaryFor(input.status, input.lease_workflow_status);
  const outstanding: OutstandingStep[] = [];
  if (actionRequired && nextOwner === 'renter') {
    outstanding.push({
      key: primary?.key ?? 'renter_action',
      label: actionRequired,
      owner: 'renter',
    });
  }
  const terminal = ['approved', 'declined', 'landlord_passed', 'withdrawn', 'closed'].includes(
    input.status,
  );

  return {
    status: input.status,
    status_label: statusLabel(input.status),
    current_stage: currentKey,
    current_label: current?.label ?? currentKey,
    next_action_owner: terminal ? 'none' : nextOwner,
    primary_action: primary,
    outstanding_steps: outstanding,
    action_required: actionRequired,
    last_update_at: lastUpdate,
    next_step: next,
    stages,
    is_terminal: terminal,
    timestamps,
  };
}
