/**
 * Human labels for enums shown in UI. Never render raw underscored codes.
 */

const DISPLAY: Record<string, string> = {
  // Income bands
  under_30k: 'Under $30k',
  under_40k: 'Under $40k',
  '30k_50k': '$30k–$50k',
  '40k_60k': '$40k–$60k',
  '40k_75k': '$40k–$75k',
  '50k_75k': '$50k–$75k',
  '60k_80k': '$60k–$80k',
  '75k_100k': '$75k–$100k',
  '75k_120k': '$75k–$120k',
  '80k_100k': '$80k–$100k',
  '100k_120k': '$100k–$120k',
  '100k_150k': '$100k–$150k',
  '120k_200k': '$120k–$200k',
  '150k_200k': '$150k–$200k',
  '200k_plus': '$200k+',
  undisclosed: 'Not shared',
  // Score bands
  unscored: 'Not scored',
  strong: 'Strong fit',
  good: 'Good fit',
  fair: 'Fair fit',
  needs_review: 'Needs review',
  high: 'Strong fit',
  mid: 'Moderate fit',
  low: 'Lower fit',
  unknown_band: 'Not scored',
  // Screening dimension labels
  credit: 'Credit',
  criminal: 'Criminal',
  eviction: 'Eviction',
  identity: 'Identity',
  // Screening results
  unknown: 'Pending',
  pending: 'Pending',
  not_run: 'Not started',
  not_started: 'Not started',
  clear: 'Clear',
  pass: 'Clear',
  records: 'Records found',
  review: 'Needs review',
  fail: 'Flag',
  failed: 'Flag',
  complete: 'Complete',
  reported: 'Reported',
  verified: 'Verified',
  not: 'Not verified',
  // Move-in
  immediate: 'ASAP',
  asap: 'ASAP',
  within_30_days: 'Within 30 days',
  within_60_days: 'Within 60 days',
  within_90_days: 'Within 90 days',
  flexible: 'Flexible',
  // Application / listing status
  draft: 'Draft',
  awaiting_landlord_interest: 'Awaiting your review',
  mutual_interest: 'Mutual interest',
  awaiting_consent: 'Waiting on applicant consent',
  screening_authorized: 'Screening started',
  screening_running: 'Screening in progress',
  screening_in_progress: 'Screening in progress',
  screening_complete: 'Screening complete',
  screened: 'Screening complete',
  approved: 'Approved',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  closed: 'Closed',
  submitted: 'Submitted',
  landlord_passed: 'Passed',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
  // Lead / connect
  offered: 'Offered',
  accepted: 'Accepted',
  expired: 'Expired',
  none: 'Not started',
  restricted: 'Needs attention',
};

/** Map a stored enum / code to a user-facing label. */
export function displayName(value: string | null | undefined, fallback = '—'): string {
  if (value == null || value === '') return fallback;
  if (DISPLAY[value]) return DISPLAY[value]!;
  // Fallback: underscores → spaces so nothing renders raw codes
  if (value.includes('_')) {
    return value
      .split('_')
      .filter((p) => p && p !== 'v1' && !/^v\d+$/i.test(p))
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join(' ');
  }
  return value;
}

const UNKNOWN_SCREENING = new Set(['unknown', 'pending', 'not_started', 'not_run', '', '—']);

/** True when at least one screening dimension has a real result. */
export function hasScreeningResults(summary: {
  credit?: string;
  criminal?: string;
  eviction?: string;
  identity?: string;
}): boolean {
  return (['credit', 'criminal', 'eviction', 'identity'] as const).some((k) => {
    const v = (summary[k] ?? '').toLowerCase();
    return Boolean(v) && !UNKNOWN_SCREENING.has(v);
  });
}

const PRE_SCREEN = new Set([
  'awaiting_landlord_interest',
  'mutual_interest',
  'draft',
  'submitted',
]);

const IN_PROGRESS = new Set([
  'awaiting_consent',
  'screening_authorized',
  'screening_running',
  'screening_in_progress',
]);

const READY = new Set(['screening_complete', 'screened']);

export function screeningPhase(
  status: string,
): 'pre' | 'in_progress' | 'ready' | 'terminal' | 'other' {
  if (PRE_SCREEN.has(status)) return 'pre';
  if (IN_PROGRESS.has(status)) return 'in_progress';
  if (READY.has(status)) return 'ready';
  if (status === 'approved' || status === 'declined' || status === 'landlord_passed') return 'terminal';
  return 'other';
}
