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

export type ApplicationProgress = {
  status?: string;
  status_label?: string;
  current_stage: string;
  current_label: string;
  next_action_owner?: NextActionOwner;
  primary_action?: {
    key: string;
    label: string;
    href_hint: string | null;
  } | null;
  outstanding_steps?: Array<{
    key: string;
    label: string;
    owner: NextActionOwner;
  }>;
  action_required: string | null;
  last_update_at: string | null;
  next_step: string | null;
  stages: ProgressStage[];
  is_terminal?: boolean;
  timestamps?: {
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

function tone(status: ProgressStageStatus): string {
  if (status === 'complete') return 'border-dwel-mint bg-dwel-mint-soft text-dwel-success';
  if (status === 'current') return 'border-dwel-blue bg-[#eaf0ff] text-dwel-blue';
  if (status === 'blocked') return 'border-[#f0d7a0] bg-[#fff8e9] text-[#8a5a00]';
  return 'border-dwel-line bg-white text-dwel-muted';
}

function ownerLabel(owner: NextActionOwner | undefined): string {
  if (owner === 'renter') return 'You';
  if (owner === 'home_provider') return 'Home Provider';
  if (owner === 'system') return 'System';
  return '—';
}

type Props = {
  progress: ApplicationProgress;
  /** Compact list row vs full detail page. */
  compact?: boolean;
};

/** Server-derived application progress — never invent stages client-side. */
export function ApplicationProgressTimeline({ progress, compact = false }: Props) {
  const stages = compact
    ? progress.stages.filter((s) => s.status === 'complete' || s.status === 'current').slice(-3)
    : progress.stages;

  return (
    <div className={compact ? 'mt-2' : 'mt-4'}>
      {!compact ? (
        <div className="mb-3 space-y-1">
          <p className="text-sm font-semibold text-dwel-ink">
            {progress.status_label ?? progress.current_label}
          </p>
          {progress.next_action_owner && progress.next_action_owner !== 'none' ? (
            <p className="text-sm text-dwel-muted">
              Next step owned by:{' '}
              <strong className="text-dwel-ink">{ownerLabel(progress.next_action_owner)}</strong>
            </p>
          ) : null}
          {progress.action_required ? (
            <p className="text-sm text-dwel-blue">{progress.action_required}</p>
          ) : progress.next_step ? (
            <p className="text-sm text-dwel-muted">{progress.next_step}</p>
          ) : null}
          {progress.last_update_at ? (
            <p className="text-xs text-dwel-muted">
              Last updated {new Date(progress.last_update_at).toLocaleString()}
            </p>
          ) : null}
        </div>
      ) : progress.action_required ? (
        <p className="mb-1 text-xs font-semibold text-dwel-blue">{progress.action_required}</p>
      ) : null}

      <ol className={compact ? 'space-y-1' : 'space-y-2'}>
        {stages.map((s) => (
          <li
            key={s.key}
            className={`rounded-[10px] border px-3 py-2 ${tone(s.status)} ${
              compact ? 'text-xs' : 'text-sm'
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{s.label}</span>
              <span className="text-[11px] uppercase tracking-wide opacity-80">{s.status}</span>
            </div>
            {!compact ? <p className="mt-1 opacity-90">{s.explanation}</p> : null}
            {!compact && s.completed_at ? (
              <p className="mt-1 text-xs opacity-70">
                {new Date(s.completed_at).toLocaleString()}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
