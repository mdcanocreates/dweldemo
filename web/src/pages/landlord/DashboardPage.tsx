import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { LandlordShell } from '../../components/layout/LandlordShell';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { LoadingState } from '../../components/ui/LoadingState';
import { MetricCard } from '../../components/ui/MetricCard';
import { api, ApiError, getSessionToken } from '../../api/client';
import { formatCents } from '../../lib/money';
import { useAuth } from '../../hooks/useAuth';
import {
  applicationStatusLabel,
  applicationStatusTone,
  friendlyApiError,
} from '../../lib/application-status';
import { landlordApplicantPath } from '../../lib/application-routes';

type LandlordListing = {
  id: string;
  status: string;
  rent_amount_cents: number;
  city: string | null;
  state: string | null;
  line1: string | null;
  bedrooms: number | null;
  applicant_count: number | string;
  photo_url?: string | null;
};

type Applicant = {
  application_id: string;
  status: string;
  created_at: string;
  score_band: string;
  income_band: string;
  household_size: number | null;
  has_pets: boolean | null;
  move_in_urgency?: string | null;
  display_name?: string | null;
  criteria_match?: boolean | null;
  current_location?: string | null;
  preferred_lease_term_months?: number | null;
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
  listing_id: string;
  listing_label: string;
  rent_cents?: number | null;
};

const SCREENING_IN_PROGRESS = new Set([
  'awaiting_consent',
  'screening_authorized',
  'screening_running',
  'screening_in_progress',
  'awaiting_provider_configuration',
]);

const READY = new Set(['screened', 'screening_complete']);

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function applicantName(a: Applicant): string {
  if (a.display_name) return a.display_name;
  if (a.contact) {
    return (
      [a.contact.given_name, a.contact.family_name?.slice(0, 1)]
        .filter(Boolean)
        .join(' ')
        .trim() || 'Applicant'
    );
  }
  return `Applicant · ${a.score_band}`;
}

/** Production Home Provider dashboard — real org KPIs, clickable. */
export function LandlordDashboardPage() {
  const { user } = useAuth();
  const [listings, setListings] = useState<LandlordListing[]>([]);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!getSessionToken()) {
      setLoading(false);
      setError('Sign in as a Home Provider to view your dashboard.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.landlordListings();
      setListings(res.listings);
      const rows: Applicant[] = [];
      for (const listing of res.listings) {
        const apps = await api.landlordApplicants(listing.id);
        for (const a of apps.applicants) {
          rows.push({
            ...a,
            listing_id: listing.id,
            listing_label: listing.line1 || listing.city || listing.id,
          });
        }
      }
      rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
      setApplicants(rows);
    } catch (err) {
      setError(friendlyApiError(err instanceof ApiError ? err.message : 'Could not load dashboard.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const name = user?.given_name?.trim() || 'there';
  const live = listings.filter((l) => l.status === 'active').length;
  const interestTotal = listings.reduce((s, l) => s + Number(l.applicant_count || 0), 0);
  const screeningsInProgress = applicants.filter((a) => SCREENING_IN_PROGRESS.has(a.status)).length;
  const readyForReview = applicants.filter((a) => READY.has(a.status)).length;

  return (
    <LandlordShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight">
            {greeting()}, {name}
          </h1>
          <p className="mt-1 text-sm text-dwel-muted">
            Here&apos;s what needs your attention for your Home Provider organization.
          </p>
        </div>
        <Link href="/listings">
          <Button className="min-h-11">+ Create listing</Button>
        </Link>
      </div>

      {loading ? <div className="mt-6"><LoadingState rows={4} /></div> : null}
      {error ? (
        <div className="mt-6">
          <ErrorState
            message={error}
            onRetry={() => void load()}
            action={
              <Link href="/auth/login?returnTo=/dashboard">
                <Button variant="secondary" className="!py-2 text-sm">
                  Sign in
                </Button>
              </Link>
            }
          />
        </div>
      ) : null}

      {!loading && !error ? (
        <>
          {readyForReview > 0 ? (
            <Card className="mt-5 flex flex-wrap items-center justify-between gap-3 border-l-4 border-dwel-red bg-[#fff5f5] p-[18px]">
              <div>
                <strong>Action required</strong>
                <div className="text-xs text-dwel-muted">
                  {readyForReview} applicant{readyForReview === 1 ? '' : 's'} ready for review.
                </div>
              </div>
              <Link href="/listings/applicants?status=screening_complete">
                <Button className="!py-2 text-sm">Review now</Button>
              </Link>
            </Card>
          ) : null}

          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Portfolio snapshot</h2>
            <span className="text-xs text-dwel-muted">Live from your org</span>
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Active listings" value={live} href="/listings?status=active" />
            <MetricCard
              label="Open renter interests"
              value={interestTotal}
              href="/listings/applicants?status=interested"
            />
            <MetricCard
              label="Screenings in progress"
              value={screeningsInProgress}
              href="/landlord/screenings?status=in_progress"
            />
            <MetricCard
              label="Ready for review"
              value={readyForReview}
              href="/listings/applicants?status=screening_complete"
            />
            <MetricCard
              label="Total applicants"
              value={applicants.length}
              href="/listings/applicants"
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
            <Card className="p-[18px]">
              <h2 className="text-xl font-semibold">Portfolio performance</h2>
              <p className="mt-3 text-sm text-dwel-muted">
                Performance data will appear as traffic accumulates. Listing views and conversion
                analytics are not exposed by the API yet.
              </p>
            </Card>
            <Card className="p-[18px]">
              <h2 className="text-xl font-semibold">Billing summary</h2>
              <p className="mt-3 text-sm text-dwel-muted">
                Invoice history and accrued listing fees are not available from the billing API yet.
                Screening fees are paid by renters when you request screening.
              </p>
              <Link href="/landlord/billing" className="mt-4 inline-block">
                <Button variant="secondary" className="!py-2 text-sm">
                  View billing
                </Button>
              </Link>
            </Card>
          </div>

          <div className="mt-8 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Your listings</h2>
            <Link href="/listings" className="text-sm font-semibold underline">
              View all →
            </Link>
          </div>
          {listings.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title="No listings yet"
                body="Publish a listing to start receiving interest."
                action={
                  <Link href="/listings">
                    <Button className="!py-2 text-sm">Go to listings</Button>
                  </Link>
                }
              />
            </div>
          ) : (
            <Card className="mt-3 overflow-x-auto p-0">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-dwel-muted">
                    <th className="px-3 py-3 font-bold">Listing</th>
                    <th className="px-3 py-3 font-bold">Status</th>
                    <th className="px-3 py-3 font-bold">Rent</th>
                    <th className="px-3 py-3 font-bold">Interests</th>
                    <th className="px-3 py-3 font-bold" />
                  </tr>
                </thead>
                <tbody>
                  {listings.slice(0, 6).map((l) => (
                    <tr key={l.id} className="border-t border-dwel-line">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-[50px] w-[68px] overflow-hidden rounded-[10px] bg-dwel-surface2">
                            {l.photo_url ? (
                              <img
                                src={l.photo_url}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : null}
                          </div>
                          <div>
                            <strong>{l.line1 || 'Listing'}</strong>
                            <div className="text-xs text-dwel-muted">
                              {l.city}, {l.state}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={applicationStatusTone(l.status)}>
                          {applicationStatusLabel(l.status)}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">{formatCents(l.rent_amount_cents)}</td>
                      <td className="px-3 py-3">{Number(l.applicant_count)}</td>
                      <td className="px-3 py-3 text-right">
                        <Link href={`/landlord/listings/${l.id}`}>
                          <Button variant="secondary" className="!py-2 text-sm">
                            Open
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <div className="mt-8 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Recent applicant activity</h2>
            <Link href="/listings/applicants" className="text-sm font-semibold underline">
              All applicants
            </Link>
          </div>
          <Card className="mt-3 p-[18px]">
            {applicants.length === 0 ? (
              <EmptyState
                title="No applicants yet"
                body="Renter interest will appear here when someone expresses interest."
              />
            ) : (
              <div className="divide-y divide-dwel-line">
                {applicants.slice(0, 6).map((a) => (
                  <div
                    key={a.application_id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3.5"
                  >
                    <div>
                      <p className="font-semibold">{applicantName(a)}</p>
                      <p className="text-xs text-dwel-muted">{a.listing_label}</p>
                      <Badge tone={applicationStatusTone(a.status)} className="mt-1">
                        {applicationStatusLabel(a.status)}
                      </Badge>
                    </div>
                    {landlordApplicantPath(a.application_id) ? (
                      <Link href={landlordApplicantPath(a.application_id)!}>
                        <Button variant="secondary" className="!py-2 text-sm">
                          Open
                        </Button>
                      </Link>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}
    </LandlordShell>
  );
}

/** Applicant queue — review happens on detail, not shallow approve/decline. */
export function LandlordApplicantsQueuePage() {
  const [applicants, setApplicants] = useState<
    Array<Applicant & { rent_cents: number | null }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');

  async function refresh() {
    const listingsRes = await api.landlordListings();
    const rows: Array<Applicant & { rent_cents: number | null }> = [];
    for (const listing of listingsRes.listings) {
      const apps = await api.landlordApplicants(listing.id);
      for (const a of apps.applicants) {
        rows.push({
          ...a,
          listing_id: listing.id,
          listing_label: listing.line1 || listing.city || listing.id,
          rent_cents: listing.rent_amount_cents ?? null,
        });
      }
    }
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    setApplicants(rows);
  }

  useEffect(() => {
    if (!getSessionToken()) {
      setLoading(false);
      setError('Sign in as a Home Provider to view applicants.');
      return;
    }
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const status = params.get('status');
    if (status) setFilter(status);
    let cancelled = false;
    void (async () => {
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(
            friendlyApiError(err instanceof ApiError ? err.message : 'Could not load applicants.'),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = applicants.filter((a) => {
    if (filter === 'all') return true;
    if (filter === 'interested') {
      return (
        a.status === 'awaiting_landlord_interest' ||
        a.status === 'draft' ||
        a.status === 'interested' ||
        a.status === 'submitted'
      );
    }
    if (filter === 'screening_complete') return READY.has(a.status);
    if (filter === 'screening_in_progress') return SCREENING_IN_PROGRESS.has(a.status);
    return a.status === filter;
  });

  function actionRequired(a: Applicant): string {
    if (a.status === 'interested' || a.status === 'submitted' || a.status === 'draft' || a.status === 'awaiting_landlord_interest' || a.status === 'info_requested') {
      return 'Review — Move Forward / Pass';
    }
    if (a.status === 'awaiting_consent') return 'Waiting on renter after Move Forward';
    if (SCREENING_IN_PROGRESS.has(a.status)) return 'Screening in progress';
    if (READY.has(a.status)) return 'Final decision required';
    if (a.status === 'approved') return 'Approved';
    if (a.status === 'declined') return 'Not selected';
    if (a.status === 'landlord_passed') return 'Passed for now';
    if (a.status === 'screening_error') return 'Screening error — review';
    return 'Open application';
  }

  function queueMeta(a: Applicant): string {
    const bits: string[] = [];
    if (a.current_location) bits.push(`Location: ${a.current_location}`);
    if (a.preferred_lease_term_months != null) {
      bits.push(`Lease term: ${a.preferred_lease_term_months} mo`);
    }
    if (a.move_in_urgency) bits.push(`Move-in: ${a.move_in_urgency.replace(/_/g, ' ')}`);
    if (a.income_band && a.income_band !== 'undisclosed') {
      bits.push(`Income: ${a.income_band.replace(/_/g, ' ')} (self-reported)`);
    }
    if (a.household_size != null) bits.push(`Occupants: ${a.household_size}`);
    if (a.has_pets != null) bits.push(a.has_pets ? 'Pets: yes' : 'Pets: no');
    if (a.criteria_match === true) bits.push('Appears to meet criteria');
    if (a.criteria_match === false) bits.push('Does not appear to meet criteria');
    return bits.join(' · ');
  }

  function timeWaiting(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const days = Math.floor(ms / 86_400_000);
    if (days > 0) return `${days}d waiting`;
    const hours = Math.floor(ms / 3_600_000);
    if (hours > 0) return `${hours}h waiting`;
    return 'Just now';
  }

  function screeningLabel(a: Applicant): string {
    if (READY.has(a.status) || a.status === 'approved' || a.status === 'declined') return 'Complete';
    if (SCREENING_IN_PROGRESS.has(a.status)) return applicationStatusLabel(a.status);
    if (a.status === 'screening_error') return 'Error';
    return 'Not ordered';
  }

  return (
    <LandlordShell>
      <h1 className="text-[32px] font-semibold tracking-tight">Applicants</h1>
      <p className="mt-1 text-sm text-dwel-muted">
        Queue of renter interest. Open an application to review details before deciding.
      </p>
      <Card className="mt-4 border-l-4 border-dwel-blue bg-[#f8fbff] p-4 text-sm">
        Approve and decline are only available inside the full application review — not from this
        list. Contact stays masked until approval.
      </Card>

      <div className="mt-4 flex flex-wrap gap-2">
        <select
          className="min-h-11 rounded-[10px] border border-dwel-line bg-white px-3"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter applicants"
        >
          <option value="all">All statuses</option>
          <option value="interested">Open interests</option>
          <option value="awaiting_consent">Awaiting consent</option>
          <option value="screening_in_progress">Screening in progress</option>
          <option value="screening_complete">Screening complete</option>
          <option value="approved">Approved</option>
          <option value="declined">Not selected</option>
        </select>
      </div>

      {loading ? (
        <div className="mt-6">
          <LoadingState />
        </div>
      ) : null}
      {error ? (
        <div className="mt-4">
          <ErrorState message={error} />
        </div>
      ) : null}

      <Card className="mt-6 p-[18px]">
        {!loading && filtered.length === 0 ? (
          <EmptyState
            title="No applicants in this view"
            body="Renter interest will appear here when someone expresses interest in a listing."
          />
        ) : null}
        <div className="divide-y divide-dwel-line">
          {filtered.map((a) => {
            const href = landlordApplicantPath(a.application_id);
            const row = (
              <div className="grid gap-3 py-3.5 sm:grid-cols-[52px_1fr_auto] sm:items-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#e9eefb] text-sm font-extrabold text-dwel-blue">
                  {applicantName(a).slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-dwel-ink">{applicantName(a)}</p>
                  <p className="text-xs text-dwel-muted">
                    {a.listing_label}
                    {a.rent_cents != null ? ` · ${formatCents(a.rent_cents)}/mo` : ''}
                    {' · '}
                    {new Date(a.created_at).toLocaleDateString()}
                    {' · '}
                    {timeWaiting(a.created_at)}
                  </p>
                  {queueMeta(a) ? (
                    <p className="mt-1 text-xs text-dwel-muted">{queueMeta(a)}</p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge tone={applicationStatusTone(a.status)}>
                      {applicationStatusLabel(a.status)}
                    </Badge>
                    <Badge tone={READY.has(a.status) ? 'mint' : SCREENING_IN_PROGRESS.has(a.status) ? 'amber' : 'gray'}>
                      Screening: {screeningLabel(a)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-dwel-blue">{actionRequired(a)}</p>
                </div>
                <div>
                  <span className="inline-flex min-h-10 items-center rounded-[10px] bg-dwel-ink px-3 text-sm font-semibold text-white">
                    View application
                  </span>
                </div>
              </div>
            );
            if (!href) return <div key={a.application_id}>{row}</div>;
            return (
              <Link
                key={a.application_id}
                href={href}
                className="block rounded-[12px] outline-none transition hover:bg-dwel-surface2 focus-visible:ring-2 focus-visible:ring-dwel-blue"
              >
                {row}
              </Link>
            );
          })}
        </div>
      </Card>
    </LandlordShell>
  );
}

export function LandlordBillingSummary() {
  return (
    <LandlordShell>
      <h1 className="text-[32px] font-semibold tracking-tight">Billing</h1>
      <p className="mt-1 text-sm text-dwel-muted">
        Current cycle, listing charges, payment method, and invoices.
      </p>
      <Card className="mt-6 max-w-2xl p-[18px] text-sm text-dwel-muted">
        Invoice history and accrued listing-fee totals are not available from the API yet. Screening
        fees are paid by renters when a Home Provider requests screening. Stripe Connect payout
        tooling can be linked when your org is ready for payouts — Dwel does not collect rent.
      </Card>
      <Link href="/dashboard" className="mt-4 inline-block text-sm font-semibold underline">
        ← Back to dashboard
      </Link>
    </LandlordShell>
  );
}
