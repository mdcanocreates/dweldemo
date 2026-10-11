/**
 * Canonical home-provider application decision transitions.
 * Rejects invalid from→to with HTTP 409. Does not invent new statuses.
 */

import { AppError } from '../shared/errors.js';

export type HpDecision =
  | 'approve'
  | 'decline'
  | 'request_screening'
  | 'pass'
  | 'request_more_info'
  | 'move_forward';

export type TransitionActor = 'home_provider' | 'broker' | 'system' | 'renter';

export type TransitionRule = {
  decision: Exclude<HpDecision, 'move_forward'>;
  toStatus: string;
  /** Empty = any non-terminal status (still excludes terminals explicitly). */
  fromStatuses: readonly string[] | '*';
  requireScreeningComplete?: boolean;
  requireReasonCodes?: boolean;
  requireMissingInfoCategories?: boolean;
  actor: TransitionActor;
};

const TERMINAL = new Set([
  'approved',
  'declined',
  'landlord_passed',
  'withdrawn',
  'closed',
]);

/** Statuses from which HP may still act (non-exhaustive product surface). */
const PRE_SCREEN_OPEN = [
  'draft',
  'submitted',
  'prescreen',
  'awaiting_landlord_interest',
  'interested',
  'info_requested',
] as const;

const AWAITING_CONSENT_LIKE = [
  'awaiting_consent',
  'screening_authorized',
  'screening_running',
  'screening_in_progress',
  'awaiting_provider_configuration',
] as const;

const SCREENED = ['screening_complete', 'screened'] as const;

/**
 * Allowed HP decisions. `move_forward` aliases to `request_screening` before lookup.
 */
export const HP_TRANSITION_RULES: readonly TransitionRule[] = [
  {
    decision: 'pass',
    toStatus: 'landlord_passed',
    fromStatuses: [...PRE_SCREEN_OPEN, ...AWAITING_CONSENT_LIKE, ...SCREENED],
    requireReasonCodes: true,
    actor: 'home_provider',
  },
  {
    decision: 'request_screening',
    toStatus: 'awaiting_consent',
    fromStatuses: [...PRE_SCREEN_OPEN, 'info_requested'],
    actor: 'home_provider',
  },
  {
    decision: 'request_more_info',
    toStatus: 'info_requested',
    fromStatuses: [...PRE_SCREEN_OPEN, ...AWAITING_CONSENT_LIKE, ...SCREENED],
    requireMissingInfoCategories: true,
    actor: 'home_provider',
  },
  {
    decision: 'decline',
    toStatus: 'declined',
    fromStatuses: [
      ...PRE_SCREEN_OPEN,
      ...AWAITING_CONSENT_LIKE,
      ...SCREENED,
    ],
    actor: 'home_provider',
  },
  {
    decision: 'approve',
    toStatus: 'approved',
    fromStatuses: [...SCREENED],
    requireScreeningComplete: true,
    actor: 'home_provider',
  },
];

export function normalizeHpDecision(decision: HpDecision): Exclude<HpDecision, 'move_forward'> {
  return decision === 'move_forward' ? 'request_screening' : decision;
}

export function isTerminalApplicationStatus(status: string): boolean {
  return TERMINAL.has(status);
}

export function getHpTransitionRule(
  decision: HpDecision,
): TransitionRule | undefined {
  const d = normalizeHpDecision(decision);
  return HP_TRANSITION_RULES.find((r) => r.decision === d);
}

/**
 * Validate that a home-provider decision is allowed from the current status.
 * Idempotent same-status terminals are handled by the caller before this runs.
 */
export function assertHpTransitionAllowed(input: {
  fromStatus: string;
  decision: HpDecision;
}): TransitionRule {
  const rule = getHpTransitionRule(input.decision);
  if (!rule) {
    throw new AppError(
      `Unsupported decision: ${input.decision}`,
      'invalid_transition',
      409,
    );
  }

  if (isTerminalApplicationStatus(input.fromStatus)) {
    // Allow only when caller already short-circuited idempotent same decision.
    throw new AppError(
      `Application is in terminal status '${input.fromStatus}' and cannot transition via '${rule.decision}'.`,
      'invalid_transition',
      409,
    );
  }

  if (rule.fromStatuses !== '*') {
    const allowed = new Set(rule.fromStatuses);
    if (!allowed.has(input.fromStatus)) {
      throw new AppError(
        `Cannot '${rule.decision}' from status '${input.fromStatus}'.`,
        'invalid_transition',
        409,
      );
    }
  }

  return rule;
}

/** Exhaustive matrix rows for tests (decision × from → allowed?). */
export function listHpTransitionMatrix(): Array<{
  decision: Exclude<HpDecision, 'move_forward'>;
  fromStatus: string;
  allowed: boolean;
  toStatus: string | null;
}> {
  const statuses = [
    ...PRE_SCREEN_OPEN,
    ...AWAITING_CONSENT_LIKE,
    ...SCREENED,
    'approved',
    'declined',
    'landlord_passed',
    'withdrawn',
    'closed',
  ];
  const out: Array<{
    decision: Exclude<HpDecision, 'move_forward'>;
    fromStatus: string;
    allowed: boolean;
    toStatus: string | null;
  }> = [];
  for (const rule of HP_TRANSITION_RULES) {
    for (const from of statuses) {
      let allowed = false;
      if (!isTerminalApplicationStatus(from)) {
        if (rule.fromStatuses === '*' || rule.fromStatuses.includes(from)) {
          allowed = true;
        }
      }
      out.push({
        decision: rule.decision,
        fromStatus: from,
        allowed,
        toStatus: allowed ? rule.toStatus : null,
      });
    }
  }
  return out;
}
