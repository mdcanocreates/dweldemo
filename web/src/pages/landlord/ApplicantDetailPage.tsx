import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'wouter';
import { LandlordShell } from '../../components/layout/LandlordShell';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/ErrorState';
import { LoadingState } from '../../components/ui/LoadingState';
import { api, ApiError, getSessionToken } from '../../api/client';
import {
  applicationStatusLabel,
  applicationStatusTone,
  friendlyApiError,
  MISSING_INFO_OPTIONS,
  PASS_REASON_OPTIONS,
  screeningCheckLabel,
} from '../../lib/application-status';
import { isValidApplicationId } from '../../lib/application-routes';
import { formatCents } from '../../lib/money';
import { isUiPreviewActive } from '../../lib/ui-preview';
import { getUiPreviewUniverse } from '../../lib/ui-preview-data';

type PrequalCheck = {
  key: string;
  label: string;
  result: string;
  detail: string;
  self_reported: boolean;
};

type PrequalEvaluation = {
  appears_to_meet?: boolean;
  checks?: PrequalCheck[];
};

type ApplicantRow = {
  application_id: string;
  status: string;
  created_at: string;
  score_band: string;
  income_band: string;
  household_size: number | null;
  has_pets: boolean | null;
  contact: null | {
    given_name: string | null;
    family_name: string | null;
    email: string | null;
    phone_e164: string | null;
  };
  screening_summary: {
    credit: string;
    criminal: string;
    eviction: string;
    identity: string;
  };
  self_reported_income_cents?: number | null;
  employment_status?: string | null;
  move_in_window?: string | null;
  renter_label?: string;
  display_name?: string | null;
  prequal_evaluation?: PrequalEvaluation | null;
};

type ActivityItem = { id: string; text: string; when: string };

type Loaded = {
  applicant: ApplicantRow;
  listing_id: string;
  listing_label: string;
  rent_cents: number | null;
  brokerNotes: Array<{ note: string; at: string }>;
  recommendation: 'approve' | 'decline' | null;
  activity: ActivityItem[];
  missing_info_requests: Array<{
    id: string;
    categories: string[];
    message: string | null;
    status: string;
    renter_response: string | null;
    required_document_types?: string[];
    review_note?: string | null;
    response_version?: number;
    documents?: Array<{
      document_id: string;
      doc_type: string;
      scan_status: string;
      reviewer_accessible: boolean;
    }>;
  }>;
  leases: Array<{
    id: string;
    original_filename: string;
    created_at: string;
    workflow_status?: string;
  }>;
};

type TabId =
  | 'overview'
  | 'application'
  | 'financial'
  | 'screening'
  | 'notes'
  | 'activity'
  | 'lease';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'application', label: 'Application' },
  { id: 'financial', label: 'Financial qualification' },
  { id: 'screening', label: 'Screening report' },
  { id: 'notes', label: 'Notes' },
  { id: 'activity', label: 'Activity' },
  { id: 'lease', label: 'Lease' },
];

const REQUIRED_DOC_OPTIONS = [
  { code: 'proof_of_income', label: 'Proof of income' },
  { code: 'employment_letter', label: 'Employment letter' },
  { code: 'id_document', label: 'ID document' },
  { code: 'pet_documentation', label: 'Pet documentation' },
  { code: 'household_roster', label: 'Household roster' },
  { code: 'other_supporting', label: 'Other supporting' },
] as const;

const SCREENING_IN_PROGRESS = new Set([
  'awaiting_consent',
  'screening_authorized',
  'screening_running',
  'screening_in_progress',
  'awaiting_provider_configuration',
]);

const READY = new Set(['screened', 'screening_complete']);

const PREQUAL = new Set([
  'awaiting_landlord_interest',
  'draft',
  'interested',
  'submitted',
  'prescreen',
  'info_requested',
  'more_info_requested',
]);

function applicantName(a: ApplicantRow): string {
  if (a.display_name) return a.display_name;
  if (a.renter_label) return a.renter_label;
  if (a.contact) {
    return (
      [a.contact.given_name, a.contact.family_name?.slice(0, 1)]
        .filter(Boolean)
        .join(' ')
        .trim() || 'Applicant'
    );
  }
  return `Applicant · band ${a.score_band}`;
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return 'Recently';
}

function DataLabel({ kind }: { kind: 'SELF REPORTED' | 'VERIFIED' | 'PENDING' | 'NOT AVAILABLE' }) {
  const tone =
    kind === 'VERIFIED'
      ? 'bg-dwel-mint-soft text-dwel-success'
      : kind === 'SELF REPORTED'
        ? 'bg-[#fff8e9] text-[#8a5a00]'
        : kind === 'PENDING'
          ? 'bg-[#eaf0ff] text-dwel-blue'
          : 'bg-dwel-surface2 text-dwel-muted';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide ${tone}`}>
      {kind}
    </span>
  );
}

function eventLabel(eventType: string): string {
  return eventType.replaceAll('_', ' ').replaceAll('.', ' · ');
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const base64 = result.includes(',') ? result.split(',')[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function previewPrequal(app: {
  income_band: string;
  has_pets: boolean | null;
  household_size: number | null;
}): PrequalEvaluation {
  return {
    appears_to_meet: app.income_band === '3x+' || app.income_band === '2.5x',
    checks: [
      {
        key: 'income',
        label: 'Income-to-rent',
        result: app.income_band === '3x+' ? 'meets' : 'unknown',
        detail: `Self-reported band: ${app.income_band}`,
        self_reported: true,
      },
      {
        key: 'pets',
        label: 'Pets',
        result: app.has_pets == null ? 'unknown' : app.has_pets ? 'does_not_meet' : 'meets',
        detail: app.has_pets == null ? 'Not provided' : app.has_pets ? 'Has pets' : 'No pets',
        self_reported: true,
      },
      {
        key: 'occupants',
        label: 'Occupancy',
        result: app.household_size != null && app.household_size <= 4 ? 'meets' : 'unknown',
        detail: app.household_size != null ? `${app.household_size} occupants` : 'Not provided',
        self_reported: true,
      },
    ],
  };
}

async function loadApplicant(applicationId: string): Promise<Loaded | null> {
  if (isUiPreviewActive()) {
    const u = getUiPreviewUniverse();
    const app = u.applicants.find((a) => a.application_id === applicationId);
    if (!app) return null;
    const listing = u.listings.find((l) => l.id === app.listing_id);
    const incomeGuess =
      app.income_band === '3x+'
        ? Math.round((listing?.rent_amount_cents ?? 185_000) * 3.2)
        : app.income_band === '2.5x'
          ? Math.round((listing?.rent_amount_cents ?? 185_000) * 2.5)
          : null;
    const revealed = app.status === 'approved';
    const prequal = previewPrequal(app);
    return {
      applicant: {
        ...app,
        display_name: app.renter_label,
        contact: revealed
          ? app.contact
          : app.contact
            ? {
                given_name: app.contact.given_name,
                family_name: app.contact.family_name
                  ? app.contact.family_name.slice(0, 1)
                  : null,
                email: null,
                phone_e164: null,
              }
            : null,
        renter_label: app.renter_label,
        self_reported_income_cents: incomeGuess,
        employment_status: 'Employed (self-reported)',
        move_in_window: 'Within 30 days',
        prequal_evaluation: prequal,
      },
      listing_id: app.listing_id,
      listing_label: listing?.line1 || app.listing_label || app.listing_id,
      rent_cents: listing?.rent_amount_cents ?? null,
      brokerNotes: (u.notes[applicationId] ?? []).map((n) => ({ note: n.note, at: n.at })),
      recommendation: u.recommendations[applicationId] ?? null,
      activity: u.activity
        .filter(
          (e) =>
            e.href?.includes(applicationId) ||
            e.text.toLowerCase().includes(
              (app.renter_label ?? '').toLowerCase().split(' ')[0] ?? 'zzz',
            ) ||
            e.kind === 'applicant' ||
            e.kind === 'screening',
        )
        .slice(0, 8)
        .map((e) => ({ id: e.id, text: e.text, when: e.when })),
      missing_info_requests: [],
      leases: [],
    };
  }

  if (!getSessionToken()) throw new Error('Sign in required');

  try {
    const detail = await api.landlordApplicantDetail(applicationId);
    let listingLabel = detail.listing_id;
    let rentCents: number | null = null;
    try {
      const listingsRes = await api.landlordListings();
      const listing = listingsRes.listings.find((l) => l.id === detail.listing_id);
      if (listing) {
        listingLabel = listing.line1 || listing.city || listing.id;
        rentCents = listing.rent_amount_cents;
      }
    } catch {
      /* listing label optional */
    }

    let leases: Loaded['leases'] = [];
    try {
      const leaseRes = await api.listListingLeases(detail.listing_id, applicationId);
      leases = leaseRes.leases.map((l) => ({
        id: l.id,
        original_filename: l.original_filename,
        created_at: l.created_at,
        workflow_status: l.workflow_status,
      }));
    } catch {
      leases = [];
    }

    const rec =
      detail.broker_recommendation === 'approve' || detail.broker_recommendation === 'decline'
        ? detail.broker_recommendation
        : null;

    return {
      applicant: {
        application_id: detail.application_id,
        status: detail.status,
        created_at: detail.created_at,
        score_band: detail.match_score_value != null ? String(detail.match_score_value) : '—',
        income_band: detail.profile.income_band,
        household_size: detail.profile.household_size,
        has_pets: detail.profile.has_pets,
        contact: detail.contact,
        screening_summary: detail.screening_summary,
        display_name: detail.display_name,
        move_in_window: detail.profile.move_in_urgency,
        self_reported_income_cents: detail.profile.annual_income_cents,
        prequal_evaluation: detail.prequal_evaluation,
      },
      listing_id: detail.listing_id,
      listing_label: listingLabel,
      rent_cents: rentCents,
      brokerNotes: detail.broker_notes.map((n) => ({ note: n.note, at: n.at })),
      recommendation: rec,
      activity: detail.activity.map((e, i) => ({
        id: `${e.occurred_at}-${i}`,
        text: eventLabel(e.event_type),
        when: new Date(e.occurred_at).toLocaleString(),
      })),
      missing_info_requests: detail.missing_info_requests,
      leases,
    };
  } catch (err) {
    if (!(err instanceof ApiError) || (err.status !== 404 && err.status !== 501)) {
      // Fall through to N+1 only when detail endpoint missing
      if (!(err instanceof ApiError && (err.status === 404 || err.status === 405))) throw err;
    }
  }

  // Fallback: listing loop (legacy)
  const listingsRes = await api.landlordListings();
  for (const listing of listingsRes.listings) {
    const apps = await api.landlordApplicants(listing.id);
    const app = apps.applicants.find((a) => a.application_id === applicationId);
    if (app) {
      return {
        applicant: app,
        listing_id: listing.id,
        listing_label: listing.line1 || listing.city || listing.id,
        rent_cents: listing.rent_amount_cents,
        brokerNotes: [],
        recommendation: null,
        activity: [],
        missing_info_requests: [],
        leases: [],
      };
    }
  }
  return null;
}

/** Home Provider applicant review workspace — `/landlord/applicants/:applicationId`. */
export function LandlordApplicantDetailPage() {
  const params = useParams<{ applicationId: string }>();
  const applicationId = params.applicationId;
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [decisionNote, setDecisionNote] = useState('');
  const [confirmDecision, setConfirmDecision] = useState<'approve' | 'decline' | null>(null);
  const [passOpen, setPassOpen] = useState(false);
  const [passReasons, setPassReasons] = useState<string[]>([]);
  const [missingOpen, setMissingOpen] = useState(false);
  const [missingCats, setMissingCats] = useState<string[]>([]);
  const [missingDocTypes, setMissingDocTypes] = useState<string[]>([]);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [leaseBusy, setLeaseBusy] = useState(false);
  const [checkr, setCheckr] = useState<Awaited<ReturnType<typeof api.getCheckrScreening>> | null>(
    null,
  );
  const [checkrBusy, setCheckrBusy] = useState(false);

  const invalidId = !isValidApplicationId(applicationId);

  async function refresh() {
    if (invalidId || !applicationId) {
      setLoading(false);
      setError('This application link is invalid.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const row = await loadApplicant(applicationId);
      if (!row) {
        setError('Application not found in your organization.');
        setData(null);
      } else {
        setData(row);
        try {
          const ck = await api.getCheckrScreening(applicationId);
          setCheckr(ck);
        } catch {
          setCheckr(null);
        }
      }
    } catch (err) {
      setError(friendlyApiError(err instanceof ApiError ? err.message : 'Could not load application.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [applicationId]);

  async function decide(
    decision: 'move_forward' | 'pass' | 'request_more_info' | 'approve' | 'decline',
    extra?: {
      reason_codes?: string[];
      missing_info_categories?: string[];
      required_document_types?: string[];
    },
  ) {
    if (!data) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.landlordDecide(data.listing_id, data.applicant.application_id, decision, {
        note: decisionNote.trim() || undefined,
        reason_codes: extra?.reason_codes,
        missing_info_categories: extra?.missing_info_categories,
        required_document_types: extra?.required_document_types,
        expected_status: data.applicant.status,
        idempotency_key:
          decision === 'request_more_info'
            ? `mir-${data.applicant.application_id}-${Date.now()}`
            : undefined,
      });
      setConfirmDecision(null);
      setPassOpen(false);
      setMissingOpen(false);
      setPassReasons([]);
      setMissingCats([]);
      setMissingDocTypes([]);
      setDecisionNote('');
      await refresh();
    } catch (err) {
      setActionError(friendlyApiError(err instanceof ApiError ? err.message : 'Action failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function reviewMissingInfo(
    requestId: string,
    decision: 'accept' | 'return',
    responseVersion?: number,
  ) {
    if (!data) return;
    setReviewBusyId(requestId);
    setActionError(null);
    try {
      await api.landlordReviewMissingInfo(
        data.listing_id,
        data.applicant.application_id,
        requestId,
        {
          decision,
          note: decisionNote.trim() || undefined,
          expected_response_version: responseVersion,
        },
      );
      setDecisionNote('');
      await refresh();
    } catch (err) {
      setActionError(friendlyApiError(err instanceof ApiError ? err.message : 'Review failed.'));
    } finally {
      setReviewBusyId(null);
    }
  }

  async function onLeaseFile(file: File | null) {
    if (!file || !data) return;
    setLeaseBusy(true);
    setActionError(null);
    try {
      await api.uploadLeaseDocument(data.listing_id, data.applicant.application_id, {
        content_type: file.type || 'application/pdf',
        original_filename: file.name,
        file_base64: await fileToBase64(file),
      });
      await refresh();
      setTab('lease');
    } catch (err) {
      setActionError(friendlyApiError(err instanceof ApiError ? err.message : 'Lease upload failed.'));
    } finally {
      setLeaseBusy(false);
    }
  }

  const a = data?.applicant;
  const status = a?.status ?? '';
  const rent = data?.rent_cents ?? null;
  const selfIncome = a?.self_reported_income_cents ?? null;
  const ratio =
    rent != null && selfIncome != null && selfIncome > 0
      ? ((rent / selfIncome) * 100).toFixed(1)
      : null;

  const screeningReady = READY.has(status);
  const prequalStage = PREQUAL.has(status);
  const screeningBusy = SCREENING_IN_PROGRESS.has(status);
  const prequal = a?.prequal_evaluation ?? null;

  const missing = useMemo(() => {
    const m: string[] = [];
    if (prequalStage) m.push('Final approve/deny unlocks after screening is complete.');
    if (screeningBusy) m.push('Screening is not complete.');
    if (selfIncome == null && !prequal?.checks?.length) {
      m.push('Verified income is not available — only self-reported values may exist.');
    }
    return m;
  }, [prequalStage, screeningBusy, selfIncome, prequal]);

  const tabs = useMemo(
    () => (status === 'approved' ? TABS : TABS.filter((t) => t.id !== 'lease')),
    [status],
  );

  return (
    <LandlordShell>
      <Link href="/listings/applicants">
        <Button variant="secondary" className="!py-2 text-sm">
          ← All applicants
        </Button>
      </Link>

      {invalidId ? (
        <div className="mt-6">
          <ErrorState message="This application link is invalid." />
        </div>
      ) : null}
      {loading ? (
        <div className="mt-6">
          <LoadingState />
        </div>
      ) : null}
      {error ? (
        <div className="mt-6">
          <ErrorState message={error} onRetry={() => void refresh()} />
        </div>
      ) : null}

      {a && data ? (
        <>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-[32px] font-semibold tracking-tight">{applicantName(a)}</h1>
              <p className="mt-1 text-sm text-dwel-muted">
                Applied to{' '}
                <Link
                  href={`/landlord/listings/${data.listing_id}`}
                  className="font-semibold underline"
                >
                  {data.listing_label}
                </Link>
                {rent != null ? ` · ${formatCents(rent)}/mo` : ''}
                {' · '}
                {new Date(a.created_at).toLocaleDateString()} ({timeSince(a.created_at)})
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone={applicationStatusTone(a.status)}>
                  {applicationStatusLabel(a.status)}
                </Badge>
                <Badge tone={screeningReady ? 'mint' : screeningBusy ? 'amber' : 'gray'}>
                  Screening:{' '}
                  {screeningReady
                    ? 'Complete'
                    : screeningBusy
                      ? applicationStatusLabel(a.status)
                      : 'Not ordered'}
                </Badge>
              </div>
            </div>
          </div>

          {actionError ? (
            <p className="mt-4 rounded-[12px] bg-[#fff5f5] px-3 py-2 text-sm text-dwel-red">
              {actionError}
            </p>
          ) : null}

          {isUiPreviewActive() ? (
            <p className="mt-3 text-xs font-semibold text-dwel-success">
              Preview data — simulated findings are labeled. Not a live consumer report.
            </p>
          ) : null}

          {prequal ? (
            <Card className="mt-4 p-[18px]">
              <h2 className="text-lg font-semibold">Criteria evaluation</h2>
              <p className="mt-1 text-sm font-medium text-dwel-ink">
                {prequal.appears_to_meet
                  ? 'Appears to meet current listing criteria'
                  : 'Does not clearly meet current listing criteria'}
              </p>
              <p className="mt-1 text-xs text-dwel-muted">
                Self-reported pre-qual only — not a consumer report decision.
              </p>
              <ul className="mt-3 space-y-2">
                {(prequal.checks ?? []).map((c) => (
                  <li
                    key={c.key}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-dwel-line px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      {c.label}
                      {c.self_reported ? <DataLabel kind="SELF REPORTED" /> : null}
                    </span>
                    <span className="font-semibold capitalize">
                      {c.result.replaceAll('_', ' ')}
                      {c.detail ? (
                        <span className="ml-2 font-normal text-dwel-muted">· {c.detail}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <div className="mt-5 flex gap-1 overflow-x-auto border-b border-dwel-line pb-px">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`whitespace-nowrap rounded-t-[10px] px-3 py-2 text-sm font-semibold ${
                  tab === t.id
                    ? 'bg-dwel-surface text-dwel-ink shadow-[inset_0_-2px_0_0_#4dfa9f]'
                    : 'text-dwel-muted hover:text-dwel-ink'
                }`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="space-y-4">
              {tab === 'overview' && (
                <Card className="p-[18px]">
                  <h2 className="text-lg font-semibold">Property</h2>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-dwel-muted">Address</dt>
                      <dd className="font-semibold text-right">{data.listing_label}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-dwel-muted">Monthly rent</dt>
                      <dd className="font-semibold">
                        {rent != null ? formatCents(rent) : '—'}
                      </dd>
                    </div>
                  </dl>
                  <h2 className="mt-6 text-lg font-semibold">Applicant</h2>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-dwel-muted">Display name</dt>
                      <dd className="font-semibold">{applicantName(a)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-dwel-muted">Move-in</dt>
                      <dd className="font-semibold">{a.move_in_window ?? '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-dwel-muted">Household</dt>
                      <dd className="font-semibold">{a.household_size ?? '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-dwel-muted">Pets</dt>
                      <dd className="font-semibold">
                        {a.has_pets == null ? '—' : a.has_pets ? 'Yes' : 'No'}
                      </dd>
                    </div>
                  </dl>
                  {a.status === 'approved' && a.contact?.email ? (
                    <div className="mt-4 rounded-[10px] bg-dwel-mint-soft px-3 py-2 text-sm">
                      <strong>Contact revealed after approval</strong>
                      <p className="mt-1">
                        {[a.contact.given_name, a.contact.family_name].filter(Boolean).join(' ')}
                      </p>
                      <p>{a.contact.email}</p>
                      {a.contact.phone_e164 ? <p>{a.contact.phone_e164}</p> : null}
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-dwel-muted">
                      Contact details stay masked until you approve this applicant.
                    </p>
                  )}
                </Card>
              )}

              {tab === 'application' && (
                <Card className="p-[18px]">
                  <h2 className="text-lg font-semibold">Application submission</h2>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-dwel-muted">Submitted</dt>
                      <dd className="font-semibold">
                        {new Date(a.created_at).toLocaleString()}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-dwel-muted">Status</dt>
                      <dd className="font-semibold">{applicationStatusLabel(a.status)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-dwel-muted">Income band</dt>
                      <dd className="font-semibold">{a.income_band}</dd>
                    </div>
                  </dl>
                  {data.missing_info_requests.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      <h3 className="font-semibold">Missing information requests</h3>
                      {data.missing_info_requests.map((r) => (
                        <div
                          key={r.id}
                          className="rounded-[10px] border border-dwel-line px-3 py-2 text-sm"
                        >
                          <p className="font-medium capitalize">{r.status}</p>
                          <p className="text-dwel-muted">
                            Categories: {r.categories.join(', ') || '—'}
                          </p>
                          {r.required_document_types?.length ? (
                            <p className="text-dwel-muted">
                              Docs requested: {r.required_document_types.join(', ')}
                            </p>
                          ) : null}
                          {r.renter_response ? (
                            <p className="mt-1">Response: {r.renter_response}</p>
                          ) : null}
                          {r.documents?.length ? (
                            <ul className="mt-2 space-y-1">
                              {r.documents.map((d) => (
                                <li key={d.document_id} className="flex flex-wrap items-center gap-2">
                                  <span>
                                    {d.doc_type} · {d.scan_status}
                                  </span>
                                  {d.reviewer_accessible ? (
                                    <Button
                                      variant="secondary"
                                      className="!py-1 text-xs"
                                      onClick={() => {
                                        void (async () => {
                                          try {
                                            const res = await api.landlordMissingInfoDocUrl(
                                              data.applicant.application_id,
                                              d.document_id,
                                            );
                                            window.open(res.url, '_blank', 'noopener,noreferrer');
                                          } catch (err) {
                                            setActionError(
                                              friendlyApiError(
                                                err instanceof ApiError
                                                  ? err.message
                                                  : 'Could not open document.',
                                              ),
                                            );
                                          }
                                        })();
                                      }}
                                    >
                                      Preview
                                    </Button>
                                  ) : (
                                    <span className="text-xs text-dwel-muted">Scanning…</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {r.status === 'responded' ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button
                                className="!py-1 text-xs"
                                disabled={reviewBusyId === r.id}
                                onClick={() =>
                                  void reviewMissingInfo(r.id, 'accept', r.response_version)
                                }
                              >
                                Accept response
                              </Button>
                              <Button
                                variant="secondary"
                                className="!py-1 text-xs"
                                disabled={reviewBusyId === r.id}
                                onClick={() =>
                                  void reviewMissingInfo(r.id, 'return', r.response_version)
                                }
                              >
                                Return for correction
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-4 text-xs text-dwel-muted">
                    Protected-class information is not shown here.
                  </p>
                </Card>
              )}

              {tab === 'financial' && (
                <Card className="p-[18px]">
                  <h2 className="text-lg font-semibold">Financial qualification</h2>
                  <p className="mt-1 text-xs text-dwel-muted">
                    Self-reported values are never labeled as verified. No automatic approval
                    threshold is applied by Dwel.
                  </p>
                  <dl className="mt-4 space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-dwel-muted">Listed rent</dt>
                      <dd className="font-semibold">
                        {rent != null ? formatCents(rent) : '—'}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="flex items-center gap-2 text-dwel-muted">
                        Gross income{' '}
                        <DataLabel kind={selfIncome != null ? 'SELF REPORTED' : 'NOT AVAILABLE'} />
                      </dt>
                      <dd className="font-semibold">
                        {selfIncome != null ? formatCents(selfIncome) : '—'}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-dwel-muted">Rent-to-income (self-reported)</dt>
                      <dd className="font-semibold">{ratio != null ? `${ratio}%` : '—'}</dd>
                    </div>
                  </dl>
                </Card>
              )}

              {tab === 'screening' && (
                <Card className="p-[18px]">
                  <h2 className="text-lg font-semibold">Screening report</h2>
                  <p className="mt-1 text-xs text-dwel-muted">
                    Authorized normalized results only. Completion does not mean “no records found.”
                    Raw vendor payloads are never shown. A <strong>consider</strong> result requires
                    human review — it is never an automatic decline.
                  </p>
                  <dl className="mt-4 space-y-2 text-sm">
                    {(['identity', 'credit', 'criminal', 'eviction'] as const).map((key) => (
                      <div key={key} className="flex justify-between gap-3">
                        <dt className="capitalize text-dwel-muted">{key}</dt>
                        <dd className="font-semibold">
                          {screeningCheckLabel(a.screening_summary[key])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-4 text-sm text-dwel-muted">
                    Report availability:{' '}
                    <strong className="text-dwel-ink">
                      {screeningReady
                        ? 'Available for authorized review'
                        : screeningBusy
                          ? 'In progress'
                          : 'Not ordered'}
                    </strong>
                  </p>

                  {checkr && checkr.status !== 'not_requested' ? (
                    <div className="mt-6 border-t border-dwel-line pt-4">
                      <h3 className="text-base font-semibold">Checkr Tenant screening</h3>
                      <p className="mt-1 text-xs text-dwel-muted">
                        Sub-status: <strong>{checkr.status}</strong>
                        {checkr.environment ? ` · ${checkr.environment}` : ''}
                        {checkr.review_required
                          ? ' · Review required (consider indicators present)'
                          : ''}
                      </p>
                      {checkr.products && Object.keys(checkr.products).length > 0 ? (
                        <dl className="mt-3 space-y-2 text-sm">
                          {Object.entries(checkr.products).map(([key, val]) => (
                            <div key={key} className="flex justify-between gap-3">
                              <dt className="text-dwel-muted">{key.replace(/_/g, ' ')}</dt>
                              <dd className="font-semibold">{val.result ?? val.status ?? '—'}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {checkr.status === 'completed' && checkr.checkr_report_id ? (
                          <a
                            href={api.checkrReportPdfUrl(applicationId!)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Button variant="secondary">Download report PDF</Button>
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-6 border-t border-dwel-line pt-4">
                      <p className="text-sm text-dwel-muted">
                        Checkr Tenant screening has not been requested for this application.
                      </p>
                      <Button
                        className="mt-3"
                        disabled={checkrBusy}
                        onClick={() => {
                          void (async () => {
                            if (!applicationId) return;
                            setCheckrBusy(true);
                            setActionError(null);
                            try {
                              await api.initiateCheckrScreening(applicationId);
                              const ck = await api.getCheckrScreening(applicationId);
                              setCheckr(ck);
                            } catch (err) {
                              setActionError(
                                friendlyApiError(
                                  err instanceof ApiError
                                    ? err.message
                                    : 'Could not start Checkr screening.',
                                ),
                              );
                            } finally {
                              setCheckrBusy(false);
                            }
                          })();
                        }}
                      >
                        {checkrBusy ? 'Starting…' : 'Initiate Checkr screening'}
                      </Button>
                    </div>
                  )}
                </Card>
              )}

              {tab === 'notes' && (
                <Card className="p-[18px]">
                  <h2 className="text-lg font-semibold">Notes &amp; broker recommendation</h2>
                  {data.recommendation ? (
                    <p className="mt-3 rounded-[10px] border border-dwel-line bg-[#f8fbff] px-3 py-2 text-sm">
                      <strong>Broker recommendation:</strong>{' '}
                      {data.recommendation === 'approve'
                        ? 'Recommend approve'
                        : 'Recommend decline'}
                      <span className="mt-1 block text-xs text-dwel-muted">
                        Final decision remains with the Home Provider.
                      </span>
                    </p>
                  ) : (
                    <p className="mt-3 text-sm text-dwel-muted">No broker recommendation yet.</p>
                  )}
                  {data.brokerNotes.length > 0 ? (
                    <ul className="mt-3 space-y-2 text-sm">
                      {data.brokerNotes.map((n) => (
                        <li
                          key={`${n.at}-${n.note.slice(0, 16)}`}
                          className="rounded-[10px] bg-dwel-surface2 px-3 py-2"
                        >
                          {n.note}
                          <span className="ml-2 text-xs text-dwel-muted">
                            · {new Date(n.at).toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Card>
              )}

              {tab === 'activity' && (
                <Card className="p-[18px]">
                  <h2 className="text-lg font-semibold">Activity</h2>
                  {data.activity.length > 0 ? (
                    <ul className="mt-3 space-y-2 text-sm">
                      {data.activity.map((e) => (
                        <li
                          key={e.id}
                          className="flex justify-between gap-3 rounded-[10px] border border-dwel-line px-3 py-2"
                        >
                          <span>{e.text}</span>
                          <span className="shrink-0 text-xs text-dwel-muted">{e.when}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-dwel-muted">
                      Move forward, pass, screening, and decision events appear here when recorded.
                    </p>
                  )}
                </Card>
              )}

              {tab === 'lease' && status === 'approved' && (
                <Card className="p-[18px]">
                  <h2 className="text-lg font-semibold">Lease documents</h2>
                  <p className="mt-1 text-xs text-dwel-muted">
                    Upload executed lease files for this applicant. Counsel templates are not
                    provided here.
                  </p>
                  <label className="mt-4 block text-sm">
                    <span className="font-medium">Upload lease (PDF or image)</span>
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      className="mt-2 block w-full text-sm"
                      disabled={leaseBusy}
                      onChange={(e) => void onLeaseFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  {leaseBusy ? <p className="mt-2 text-sm text-dwel-muted">Uploading…</p> : null}
                  {data.leases.length > 0 ? (
                    <ul className="mt-4 space-y-2 text-sm">
                      {data.leases.map((l) => (
                        <li
                          key={l.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-dwel-line px-3 py-2"
                        >
                          <span>
                            {l.original_filename}
                            <span className="ml-2 text-xs text-dwel-muted">
                              · {new Date(l.created_at).toLocaleString()}
                              {l.workflow_status
                                ? ` · ${l.workflow_status.replace(/_/g, ' ')}`
                                : ''}
                            </span>
                          </span>
                          {(!l.workflow_status || l.workflow_status === 'uploaded') && (
                            <Button
                              variant="secondary"
                              className="!py-1.5 text-xs"
                              disabled={leaseBusy}
                              onClick={() => {
                                void (async () => {
                                  setLeaseBusy(true);
                                  try {
                                    await api.makeLeaseAvailableToRenter(
                                      data.listing_id,
                                      data.applicant.application_id,
                                      l.id,
                                    );
                                    await refresh();
                                  } catch (err) {
                                    setError(
                                      friendlyApiError(
                                        err instanceof ApiError
                                          ? err.message
                                          : 'Could not make lease available.',
                                      ),
                                    );
                                  } finally {
                                    setLeaseBusy(false);
                                  }
                                })();
                              }}
                            >
                              Make available to renter
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-4 text-sm text-dwel-muted">No lease documents uploaded yet.</p>
                  )}
                </Card>
              )}
            </div>

            <Card className="h-max space-y-4 p-[18px] lg:sticky lg:top-24">
              <h2 className="text-lg font-semibold">Decision workspace</h2>
              <p className="text-xs text-dwel-muted">
                Decisions require your review. Dwel does not auto-approve or auto-deny based on a
                score.
              </p>
              {missing.length > 0 ? (
                <div className="rounded-[10px] border border-[#f0d7a0] bg-[#fff8e9] px-3 py-2 text-xs text-[#8a5a00]">
                  <strong>Before deciding:</strong>
                  <ul className="mt-1 list-disc pl-4">
                    {missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {data.recommendation ? (
                <p className="text-sm">
                  Broker recommends:{' '}
                  <strong>
                    {data.recommendation === 'approve' ? 'Approve' : 'Decline'}
                  </strong>
                </p>
              ) : null}
              <label className="block text-sm">
                <span className="font-medium">Internal decision note</span>
                <textarea
                  className="mt-1 w-full rounded-[10px] border border-dwel-line px-3 py-2"
                  rows={3}
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                  placeholder="Optional note for your records"
                />
              </label>
              <div className="flex flex-col gap-2">
                {prequalStage ? (
                  <>
                    <Button
                      className="!bg-dwel-mint !text-dwel-ink"
                      disabled={busy}
                      onClick={() => void decide('move_forward')}
                    >
                      Move Forward
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setPassOpen(true);
                        setMissingOpen(false);
                      }}
                    >
                      Pass
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setMissingOpen(true);
                        setPassOpen(false);
                      }}
                    >
                      Request missing information
                    </Button>
                  </>
                ) : null}
                {screeningBusy ? (
                  <p className="text-sm text-dwel-muted">
                    {status === 'awaiting_consent'
                      ? 'Waiting on renter authorization after Move Forward — do not duplicate the request.'
                      : 'Screening in progress. Approve/deny unlocks when complete.'}
                  </p>
                ) : null}
                {screeningReady ? (
                  <>
                    <Button
                      className="!bg-dwel-mint !text-dwel-ink"
                      disabled={busy}
                      onClick={() => setConfirmDecision('approve')}
                    >
                      Approve applicant
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => setConfirmDecision('decline')}
                    >
                      Deny applicant
                    </Button>
                  </>
                ) : null}
                {(status === 'approved' || status === 'declined' || status === 'landlord_passed') && (
                  <p className="text-sm text-dwel-muted">
                    Decision recorded: {applicationStatusLabel(status)}.
                  </p>
                )}
                {!prequalStage &&
                !screeningBusy &&
                !screeningReady &&
                status !== 'approved' &&
                status !== 'declined' &&
                status !== 'landlord_passed' ? (
                  <p className="text-sm text-dwel-muted">
                    No decision actions available for this state (
                    {applicationStatusLabel(status)}).
                  </p>
                ) : null}
              </div>
              <p className="text-[11px] text-dwel-muted">
                [PLACEHOLDER] Adverse decisions that rely on a consumer report may require legally
                approved notices — counsel review before production templates.
              </p>
            </Card>
          </div>

          {passOpen ? (
            <div
              className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-4 sm:items-center"
              role="dialog"
              aria-modal="true"
            >
              <Card className="w-full max-w-md p-5">
                <h2 className="text-lg font-semibold">Pass — select reason(s)</h2>
                <p className="mt-2 text-sm text-dwel-muted">
                  At least one reason is required. Freeform “Other” is not available.
                </p>
                <ul className="mt-4 space-y-2">
                  {PASS_REASON_OPTIONS.map((opt) => (
                    <label key={opt.code} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={passReasons.includes(opt.code)}
                        onChange={(e) => {
                          setPassReasons((prev) =>
                            e.target.checked
                              ? [...prev, opt.code]
                              : prev.filter((c) => c !== opt.code),
                          );
                        }}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </ul>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    disabled={busy || passReasons.length === 0}
                    onClick={() => void decide('pass', { reason_codes: passReasons })}
                  >
                    {busy ? 'Saving…' : 'Confirm Pass'}
                  </Button>
                  <Button variant="secondary" onClick={() => setPassOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </Card>
            </div>
          ) : null}

          {missingOpen ? (
            <div
              className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-4 sm:items-center"
              role="dialog"
              aria-modal="true"
            >
              <Card className="w-full max-w-md p-5">
                <h2 className="text-lg font-semibold">Request missing information</h2>
                <p className="mt-2 text-sm text-dwel-muted">
                  Select permitted categories only. [PLACEHOLDER] counsel-safe copy.
                </p>
                <ul className="mt-4 space-y-2">
                  {MISSING_INFO_OPTIONS.map((opt) => (
                    <label key={opt.code} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={missingCats.includes(opt.code)}
                        onChange={(e) => {
                          setMissingCats((prev) =>
                            e.target.checked
                              ? [...prev, opt.code]
                              : prev.filter((c) => c !== opt.code),
                          );
                        }}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </ul>
                <p className="mt-4 text-sm font-semibold">Required supporting documents (optional)</p>
                <ul className="mt-2 space-y-2">
                  {REQUIRED_DOC_OPTIONS.map((opt) => (
                    <label key={opt.code} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={missingDocTypes.includes(opt.code)}
                        onChange={(e) => {
                          setMissingDocTypes((prev) =>
                            e.target.checked
                              ? [...prev, opt.code]
                              : prev.filter((c) => c !== opt.code),
                          );
                        }}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </ul>
                <textarea
                  className="mt-3 w-full rounded-[10px] border border-dwel-line px-3 py-2 text-sm"
                  rows={2}
                  placeholder="Instructions for the renter (optional)"
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                  maxLength={500}
                />
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    disabled={busy || missingCats.length === 0}
                    onClick={() =>
                      void decide('request_more_info', {
                        missing_info_categories: missingCats,
                        required_document_types: missingDocTypes,
                      })
                    }
                  >
                    {busy ? 'Saving…' : 'Send request'}
                  </Button>
                  <Button variant="secondary" onClick={() => setMissingOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </Card>
            </div>
          ) : null}

          {confirmDecision ? (
            <div
              className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-4 sm:items-center"
              role="dialog"
              aria-modal="true"
            >
              <Card className="w-full max-w-md p-5">
                <h2 className="text-lg font-semibold">
                  Confirm {confirmDecision === 'approve' ? 'approval' : 'denial'}
                </h2>
                <p className="mt-2 text-sm text-dwel-muted">
                  This records a final Home Provider decision for {applicantName(a)} on{' '}
                  {data.listing_label}.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    className={
                      confirmDecision === 'approve' ? '!bg-dwel-mint !text-dwel-ink' : undefined
                    }
                    variant={confirmDecision === 'decline' ? 'destructive' : 'primary'}
                    onClick={() => void decide(confirmDecision)}
                  >
                    {busy ? 'Saving…' : 'Confirm'}
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmDecision(null)}>
                    Cancel
                  </Button>
                </div>
              </Card>
            </div>
          ) : null}
        </>
      ) : null}
    </LandlordShell>
  );
}
