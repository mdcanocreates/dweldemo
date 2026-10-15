import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { RenterShell } from '../../components/layout/RenterShell';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { LoadingState } from '../../components/ui/LoadingState';
import { MetricCard } from '../../components/ui/MetricCard';
import { api, ApiError, getSessionToken } from '../../api/client';
import { useSavedListings } from '../../hooks/useSavedListings';
import { formatCents } from '../../lib/money';
import {
  applicationStatusLabel,
  applicationStatusTone,
  friendlyApiError,
} from '../../lib/application-status';
import {
  applicationPath,
  applicationScreeningPath,
  isValidApplicationId,
} from '../../lib/application-routes';
import { buildSearchUrl, resolveLocationInput } from '../../lib/search-state';

type AppRow = {
  application_id: string;
  status: string;
  listing_id: string | null;
  created_at: string;
  listing: {
    line1: string | null;
    city: string | null;
    state: string | null;
    rent_amount_cents: number | null;
  } | null;
};

function urgencyLabel(u: string | null): string {
  if (!u) return 'Not set';
  const map: Record<string, string> = {
    immediate: 'ASAP',
    asap: 'ASAP',
    within_30_days: 'Within 30 days',
    within_60_days: 'Within 60 days',
    within_90_days: 'Within 90 days',
    flexible: 'Flexible',
  };
  return map[u] ?? u.replaceAll('_', ' ');
}

function profileCompletion(profile: {
  given_name: string | null;
  family_name: string | null;
  phone_e164: string | null;
  email: string | null;
  rent_max_cents: number | null;
  bedrooms_min: number | null;
  preferred_state: string | null;
  move_in_urgency: string | null;
  household_size: number | null;
} | null): number {
  if (!profile) return 0;
  const fields = [
    profile.given_name,
    profile.family_name,
    profile.phone_e164,
    profile.email,
    profile.rent_max_cents,
    profile.bedrooms_min,
    profile.preferred_state,
    profile.move_in_urgency,
    profile.household_size,
  ];
  const filled = fields.filter((v) => v != null && v !== '').length;
  return Math.round((filled / fields.length) * 100);
}

/** Authenticated renter home — HTML reference layout, real API metrics. */
export function RenterHomePage() {
  const [, setLocation] = useLocation();
  const { savedIds } = useSavedListings();
  const [apps, setApps] = useState<AppRow[]>([]);
  const [profile, setProfile] = useState<Awaited<
    ReturnType<typeof api.getRenterProfile>
  >['profile']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationQuery, setLocationQuery] = useState('Austin, TX');

  async function load() {
    if (!getSessionToken()) {
      setLoading(false);
      setError('Sign in to see your renter home.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [appsRes, profileRes] = await Promise.all([
        api.listMyApplications(),
        api.getRenterProfile(),
      ]);
      setApps(appsRes.applications);
      setProfile(profileRes.profile);
      if (profileRes.profile?.preferred_state) {
        setLocationQuery(profileRes.profile.preferred_state);
      }
    } catch (err) {
      setError(
        friendlyApiError(err instanceof ApiError ? err.message : 'Could not load your home.'),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const completion = profileCompletion(profile);
  const needsAction = apps.filter((a) => a.status === 'awaiting_consent');
  const screeningInProgress = apps.filter(
    (a) => a.status === 'screening_running' || a.status === 'screening_in_progress',
  );
  const continueApps = [...needsAction, ...apps.filter((a) => !needsAction.includes(a))].slice(0, 3);

  return (
    <RenterShell workspace>
      <h1 className="text-[30px] font-semibold tracking-tight text-dwel-ink">Find your next place</h1>
      <p className="mt-1 text-sm text-dwel-muted">
        Browse freely. Sign in only when you want to save or apply.
      </p>

      {loading ? <div className="mt-6"><LoadingState rows={4} /></div> : null}
      {error ? (
        <div className="mt-6">
          <ErrorState
            message={error}
            onRetry={() => void load()}
            action={
              <Link href="/auth/login?returnTo=/home">
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
          <div className="mt-[18px] grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="flex min-h-[300px] flex-col justify-end rounded-[24px] bg-[linear-gradient(145deg,#0e1a28,#172a3a)] p-8 text-white">
              <span className="mb-3 w-max rounded-full bg-dwel-mint px-2.5 py-1 text-xs font-extrabold text-dwel-ink">
                Dwel renter profile
              </span>
              <h2 className="text-[34px] font-semibold leading-tight tracking-tight text-white">
                One profile. Unlimited listings. Keep more of your move-in money.
              </h2>
              <form
                className="mt-5 flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const location = resolveLocationInput(locationQuery);
                  setLocation(buildSearchUrl(location ? { location } : {}));
                }}
              >
                <label className="sr-only" htmlFor="renter-home-loc">
                  Location
                </label>
                <input
                  id="renter-home-loc"
                  value={locationQuery}
                  onChange={(e) => setLocationQuery(e.target.value)}
                  className="min-h-11 flex-1 rounded-[12px] border border-dwel-line px-[13px] text-dwel-ink"
                />
                <Button type="submit" className="!bg-dwel-mint !text-dwel-ink min-h-11">
                  Search homes
                </Button>
              </form>
            </div>

            <Card className="p-[18px]">
              <h2 className="text-xl font-semibold">Your renter snapshot</h2>
              <p className="mt-4 flex justify-between text-sm">
                <span className="text-dwel-muted">Profile completeness</span>
                <strong>{completion}%</strong>
              </p>
              <p className="mt-2 flex justify-between text-sm">
                <span className="text-dwel-muted">Move-in</span>
                <strong>{urgencyLabel(profile?.move_in_urgency ?? null)}</strong>
              </p>
              <p className="mt-2 flex justify-between text-sm">
                <span className="text-dwel-muted">Budget</span>
                <strong>
                  {profile?.rent_max_cents != null
                    ? `Up to ${formatCents(profile.rent_max_cents)}`
                    : 'Not set'}
                </strong>
              </p>
              <p className="mt-2 flex justify-between text-sm">
                <span className="text-dwel-muted">Preferred areas</span>
                <strong>{profile?.preferred_state || 'Not set'}</strong>
              </p>
              <Link href="/profile" className="mt-5 inline-block">
                <Button className="min-h-11">
                  {completion < 100 ? 'Finish profile' : 'Edit profile'}
                </Button>
              </Link>
            </Card>
          </div>

          <div className="mt-[18px] grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Saved homes"
              value={savedIds.length}
              hint="Synced when signed in"
              href="/saved"
            />
            <MetricCard
              label="Applications"
              value={apps.length}
              hint={
                needsAction.length
                  ? `${needsAction.length} need${needsAction.length === 1 ? 's' : ''} action`
                  : 'Track interest & screening'
              }
              href="/applications"
            />
            <MetricCard
              label="Screening in progress"
              value={screeningInProgress.length}
              href="/screening"
            />
            <MetricCard label="Browse homes" value="→" hint="Find your next place" href="/search" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
            <Card className="p-[18px]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-xl font-semibold">Continue where you left off</h2>
                <Link href="/applications" className="text-sm font-semibold underline">
                  View all
                </Link>
              </div>
              {continueApps.length === 0 ? (
                <EmptyState
                  title="No applications yet"
                  body="Express interest on a listing to start tracking here."
                  action={
                    <Link href="/search">
                      <Button className="!py-2 text-sm">Browse homes</Button>
                    </Link>
                  }
                />
              ) : (
                <div className="divide-y divide-dwel-line">
                  {continueApps
                    .filter((a) => isValidApplicationId(a.application_id))
                    .map((a) => {
                    const href =
                      a.status === 'awaiting_consent'
                        ? applicationScreeningPath(a.application_id)
                        : applicationPath(a.application_id);
                    if (!href) return null;
                    return (
                    <div
                      key={a.application_id}
                      className="grid grid-cols-[1fr_auto] items-center gap-3 py-3.5 sm:grid-cols-[1fr_auto_auto]"
                    >
                      <div>
                        <p className="font-semibold">
                          {a.listing?.line1 || a.listing?.city || 'Listing'}
                        </p>
                        <p className="text-sm text-dwel-muted">
                          {a.listing?.rent_amount_cents != null
                            ? `${formatCents(a.listing.rent_amount_cents)}/mo`
                            : ''}
                          {a.listing?.city ? ` · ${a.listing.city}` : ''}
                        </p>
                        <Badge tone={applicationStatusTone(a.status)} className="mt-1">
                          {applicationStatusLabel(a.status)}
                        </Badge>
                      </div>
                      <Link href={href}>
                        <Button
                          variant={a.status === 'awaiting_consent' ? 'primary' : 'secondary'}
                          className="!py-2 text-sm"
                        >
                          {a.status === 'awaiting_consent' ? 'Continue' : 'View'}
                        </Button>
                      </Link>
                    </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card className="p-[18px]">
              <h2 className="text-xl font-semibold">Next best actions</h2>
              {needsAction[0] ? (
                <div className="mt-3 rounded-[13px] border-l-4 border-dwel-mint bg-dwel-mint-soft p-3.5 text-sm">
                  <strong>Consent needed</strong>
                  <br />
                  {needsAction[0].listing?.line1 || 'An application'} is waiting on screening
                  authorization.
                  <div className="mt-3">
                    {isValidApplicationId(needsAction[0].application_id) &&
                    applicationScreeningPath(needsAction[0].application_id) ? (
                      <Link href={applicationScreeningPath(needsAction[0].application_id)!}>
                        <Button className="!py-2 text-sm">Authorize screening</Button>
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {completion < 100 ? (
                <div className="mt-3 rounded-[13px] border-l-4 border-dwel-amber bg-[#fff8e9] p-3.5 text-sm">
                  <strong>Profile incomplete</strong>
                  <br />
                  Finish your renter profile to reuse it across applications.
                  <div className="mt-3">
                    <Link href="/profile">
                      <Button variant="secondary" className="!py-2 text-sm">
                        Finish profile
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : null}
              {!needsAction[0] && completion >= 100 ? (
                <p className="mt-3 text-sm text-dwel-muted">
                  You&apos;re caught up. Browse homes or check application updates.
                </p>
              ) : null}
            </Card>
          </div>
        </>
      ) : null}
    </RenterShell>
  );
}
