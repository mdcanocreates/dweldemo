import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { RenterShell } from '../../components/layout/RenterShell';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/ErrorState';
import { LoadingState } from '../../components/ui/LoadingState';
import { api, ApiError, getSessionToken } from '../../api/client';
import { formatCents } from '../../lib/money';
import {
  applicationStatusLabel,
  applicationStatusTone,
  friendlyApiError,
} from '../../lib/application-status';
import {
  ApplicationProgressTimeline,
  type ApplicationProgress,
} from '../../components/application/ApplicationProgressTimeline';
import { applicationScreeningPath } from '../../lib/application-routes';

type AppRow = {
  application_id: string;
  status: string;
  listing_id: string | null;
  created_at: string;
  progress?: ApplicationProgress;
  listing: {
    line1: string | null;
    city: string | null;
    state: string | null;
    rent_amount_cents: number | null;
  } | null;
};

type LeaseRow = {
  id: string;
  original_filename: string;
  workflow_status: string;
  acknowledged_at: string | null;
  created_at: string;
};

type CashbackRow = {
  id: string;
  application_id: string;
  status: string;
  amount_cents: number | null;
  offer_version: string;
  ineligible_reason: string | null;
};

function ownerCopy(owner: ApplicationProgress['next_action_owner']): string {
  if (owner === 'renter') return 'You — action needed';
  if (owner === 'home_provider') return 'Waiting on Home Provider';
  if (owner === 'system') return 'In progress with screening system';
  return 'No further action';
}

function primaryHref(
  appId: string,
  action: ApplicationProgress['primary_action'],
): string | null {
  if (!action) return null;
  if (action.href_hint === 'screening') return applicationScreeningPath(appId);
  if (action.href_hint === 'search') return '/search';
  if (action.href_hint === 'detail') return null; // same page
  return null;
}

export function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [app, setApp] = useState<AppRow | null>(null);
  const [feeCents, setFeeCents] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progressUnavailable, setProgressUnavailable] = useState(false);
  const [missingResponse, setMissingResponse] = useState('');
  const [missingBusy, setMissingBusy] = useState(false);
  const [missingError, setMissingError] = useState<string | null>(null);
  const [missingOk, setMissingOk] = useState<string | null>(null);
  const [cashback, setCashback] = useState<CashbackRow | null>(null);
  const [cashbackNote, setCashbackNote] = useState<string | null>(null);
  const [leases, setLeases] = useState<LeaseRow[]>([]);
  const [leaseBusy, setLeaseBusy] = useState<string | null>(null);
  const [leaseUnavailable, setLeaseUnavailable] = useState(false);

  const load = useCallback(async () => {
    if (!id || !getSessionToken()) {
      setLoading(false);
      setError('Sign in to view this application.');
      return;
    }
    setLoading(true);
    setError(null);
    setProgressUnavailable(false);
    try {
      const [appsRes, feeRes, cashRes] = await Promise.all([
        api.listMyApplications(),
        api.getScreeningFee().catch(() => null),
        api.getRenterCashback().catch(() => null),
      ]);
      const found = appsRes.applications.find((a) => a.application_id === id) ?? null;
      if (!found) {
        setError('Application not found.');
        setApp(null);
        setLeases([]);
      } else {
        setApp(found);
        if (!found.progress) setProgressUnavailable(true);
        if (found.status === 'approved') {
          try {
            const leaseRes = await api.listRenterLeases(id);
            setLeases(leaseRes?.leases ?? []);
            setLeaseUnavailable(false);
          } catch {
            setLeases([]);
            setLeaseUnavailable(true);
          }
        } else {
          setLeases([]);
          setLeaseUnavailable(false);
        }
      }
      const cents = feeRes?.fee?.amount_cents ?? feeRes?.amount_cents ?? null;
      if (typeof cents === 'number') setFeeCents(cents);
      if (cashRes) {
        setCashbackNote(cashRes.offer_version_note ?? null);
        setCashback(cashRes.eligibility.find((e) => e.application_id === id) ?? null);
      }
    } catch (err) {
      setError(
        friendlyApiError(err instanceof ApiError ? err.message : 'Could not load application.'),
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onFocus = () => {
      void load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onFocus();
    });
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  async function submitMissingInfo() {
    if (!app || !missingResponse.trim()) return;
    setMissingBusy(true);
    setMissingError(null);
    setMissingOk(null);
    try {
      await api.respondMissingInfo(app.application_id, { response: missingResponse.trim() });
      setMissingOk('Response submitted. The Home Provider can continue review.');
      setMissingResponse('');
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not submit response.';
      if (/missing_info|does not exist|relation/i.test(msg)) {
        setMissingError(
          'Information requests are not available in this environment yet. Please try again later.',
        );
      } else {
        setMissingError(friendlyApiError(msg));
      }
    } finally {
      setMissingBusy(false);
    }
  }

  const progress = app?.progress ?? null;
  const infoRequested =
    app?.status === 'info_requested' || app?.status === 'more_info_requested';
  const statusLabel = progress?.status_label ?? (app ? applicationStatusLabel(app.status) : '');
  const ctaHref = app && progress ? primaryHref(app.application_id, progress.primary_action) : null;

  return (
    <RenterShell workspace>
      <Link href="/applications">
        <Button variant="secondary" className="!py-2 text-sm">
          ← Back to applications
        </Button>
      </Link>

      {loading ? (
        <div className="mt-6">
          <LoadingState rows={2} />
        </div>
      ) : null}
      {error ? (
        <div className="mt-6">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : null}

      {app && !loading ? (
        <>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-[30px] font-semibold tracking-tight">
                {app.listing?.line1 || app.listing?.city || 'Application'}
              </h1>
              <p className="mt-1 text-sm text-dwel-muted">
                Application detail
                {progress?.last_update_at
                  ? ` · Updated ${new Date(progress.last_update_at).toLocaleString()}`
                  : ` · Started ${new Date(app.created_at).toLocaleDateString()}`}
              </p>
            </div>
            <Badge tone={applicationStatusTone(app.status)}>{statusLabel}</Badge>
          </div>

          {progress ? (
            <Card className="mt-6 p-[18px]">
              <h2 className="text-lg font-semibold">Where is my application?</h2>
              <ApplicationProgressTimeline progress={progress} />
            </Card>
          ) : (
            <Card className="mt-6 p-[18px]">
              <h2 className="text-lg font-semibold">Application status</h2>
              <p className="mt-2 text-sm text-dwel-muted">
                {progressUnavailable
                  ? 'Progress details are unavailable from the server right now. Status below is the stored application status only — no invented timeline.'
                  : 'Loading progress…'}
              </p>
              <p className="mt-3 text-sm">
                Status: <strong>{applicationStatusLabel(app.status)}</strong>
              </p>
            </Card>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
            <Card className="p-[18px]">
              <h2 className="text-xl font-semibold">Next action</h2>
              <div className="mt-3 rounded-[13px] border-l-4 border-dwel-mint bg-dwel-mint-soft p-3.5 text-sm">
                {progress
                  ? ownerCopy(progress.next_action_owner)
                  : 'See application status above.'}
                {progress?.next_step ? (
                  <p className="mt-2 text-dwel-muted">{progress.next_step}</p>
                ) : null}
              </div>
              {progress?.outstanding_steps && progress.outstanding_steps.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                  {progress.outstanding_steps.map((s) => (
                    <li key={s.key}>{s.label}</li>
                  ))}
                </ul>
              ) : null}
              {progress?.primary_action ? (
                <div className="mt-4">
                  {ctaHref ? (
                    <Link href={ctaHref}>
                      <Button className="min-h-11">
                        {progress.primary_action.label}
                        {app.status === 'awaiting_consent' && feeCents != null
                          ? ` · ${formatCents(feeCents)}`
                          : ''}
                      </Button>
                    </Link>
                  ) : (
                    <Button
                      className="min-h-11"
                      onClick={() => {
                        if (infoRequested) {
                          document.getElementById('missing-info-panel')?.scrollIntoView({
                            behavior: 'smooth',
                          });
                        }
                      }}
                    >
                      {progress.primary_action.label}
                    </Button>
                  )}
                </div>
              ) : null}
              {(app.status === 'awaiting_consent' ||
                app.status === 'screening_authorized' ||
                app.status === 'screening_running' ||
                app.status === 'screening_in_progress') && (
                <p className="mt-4 text-sm">
                  <Link
                    href={applicationScreeningPath(app.application_id) ?? '/screening'}
                    className="font-semibold underline"
                  >
                    Open screening for this application →
                  </Link>
                </p>
              )}
            </Card>

            <Card className="p-[18px]">
              <h2 className="text-xl font-semibold">Application snapshot</h2>
              <p className="mt-4 flex justify-between text-sm">
                <span className="text-dwel-muted">Listing</span>
                <strong>
                  {app.listing?.city || '—'}
                  {app.listing?.state ? `, ${app.listing.state}` : ''}
                </strong>
              </p>
              <p className="mt-2 flex justify-between text-sm">
                <span className="text-dwel-muted">Rent</span>
                <strong>
                  {app.listing?.rent_amount_cents != null
                    ? `${formatCents(app.listing.rent_amount_cents)}/mo`
                    : '—'}
                </strong>
              </p>
              <p className="mt-2 flex justify-between text-sm">
                <span className="text-dwel-muted">Screening fee</span>
                <strong>{feeCents != null ? formatCents(feeCents) : 'From config'}</strong>
              </p>
              <p className="mt-2 flex justify-between text-sm">
                <span className="text-dwel-muted">Started</span>
                <strong>{new Date(app.created_at).toLocaleDateString()}</strong>
              </p>
              {progress?.last_update_at ? (
                <p className="mt-2 flex justify-between text-sm">
                  <span className="text-dwel-muted">Last update</span>
                  <strong>{new Date(progress.last_update_at).toLocaleString()}</strong>
                </p>
              ) : null}
            </Card>
          </div>

          {infoRequested ? (
            <div id="missing-info-panel">
            <Card className="mt-4 p-[18px]">
              <h2 className="text-lg font-semibold">Outstanding: information requested</h2>
              <p className="mt-1 text-sm text-dwel-muted">
                The Home Provider asked for additional permitted details. Provide a clear response
                so review can continue.
              </p>
              <textarea
                className="mt-3 w-full rounded-[10px] border border-dwel-line px-3 py-2 text-sm"
                rows={4}
                value={missingResponse}
                onChange={(e) => setMissingResponse(e.target.value)}
                placeholder="Your response"
                maxLength={2000}
              />
              {missingError ? <p className="mt-2 text-sm text-dwel-red">{missingError}</p> : null}
              {missingOk ? <p className="mt-2 text-sm text-dwel-success">{missingOk}</p> : null}
              <Button
                className="mt-3"
                disabled={missingBusy || !missingResponse.trim()}
                onClick={() => void submitMissingInfo()}
              >
                {missingBusy ? 'Submitting…' : 'Submit response'}
              </Button>
            </Card>
            </div>
          ) : null}

          {app.status === 'approved' ? (
            <Card className="mt-4 p-[18px]">
              <h2 className="text-lg font-semibold">Lease documents</h2>
              <p className="mt-1 text-xs text-dwel-muted">
                Document workflow only — not an electronic signature product. There is no Sign lease
                action here.
              </p>
              {leaseUnavailable ? (
                <p className="mt-3 text-sm text-dwel-muted">
                  Lease documents are not available in this environment yet.
                </p>
              ) : leases.length === 0 ? (
                <p className="mt-3 text-sm text-dwel-muted">
                  No lease documents available yet. Your Home Provider will make them available when
                  ready.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {leases.map((l) => (
                    <li
                      key={l.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-dwel-line px-3 py-2 text-sm"
                    >
                      <div>
                        <p className="font-semibold">{l.original_filename}</p>
                        <p className="text-xs text-dwel-muted">
                          {l.workflow_status.replace(/_/g, ' ')}
                          {l.acknowledged_at
                            ? ` · acknowledged ${new Date(l.acknowledged_at).toLocaleDateString()}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          className="!py-2 text-sm"
                          disabled={leaseBusy === l.id}
                          onClick={() => {
                            void (async () => {
                              setLeaseBusy(l.id);
                              try {
                                const res = await api.renterLeaseDownloadUrl(
                                  app.application_id,
                                  l.id,
                                );
                                window.open(res.url, '_blank', 'noopener,noreferrer');
                              } catch (err) {
                                setError(
                                  friendlyApiError(
                                    err instanceof ApiError
                                      ? err.message
                                      : 'Could not open lease.',
                                  ),
                                );
                              } finally {
                                setLeaseBusy(null);
                              }
                            })();
                          }}
                        >
                          View / download
                        </Button>
                        {l.workflow_status === 'available_to_renter' ? (
                          <Button
                            className="!py-2 text-sm"
                            disabled={leaseBusy === l.id}
                            onClick={() => {
                              void (async () => {
                                setLeaseBusy(l.id);
                                try {
                                  await api.acknowledgeRenterLease(app.application_id, l.id);
                                  await load();
                                } catch (err) {
                                  setError(
                                    friendlyApiError(
                                      err instanceof ApiError
                                        ? err.message
                                        : 'Could not acknowledge.',
                                    ),
                                  );
                                } finally {
                                  setLeaseBusy(null);
                                }
                              })();
                            }}
                          >
                            Acknowledge receipt
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {app.status === 'approved' || cashback ? (
            <Card className="mt-4 p-[18px]">
              <h2 className="text-lg font-semibold">Cashback eligibility</h2>
              {cashback ? (
                <div className="mt-3 rounded-[10px] border border-dwel-line px-3 py-2 text-sm">
                  <p>
                    Status: <strong>{cashback.status}</strong>
                    {cashback.amount_cents != null
                      ? ` · ${formatCents(cashback.amount_cents)} (display offer)`
                      : ''}
                  </p>
                  <p className="mt-1 text-xs text-dwel-muted">
                    {cashbackNote ||
                      'Display offer only. This is not a funded payout or guarantee of payment.'}
                  </p>
                  {cashback.ineligible_reason ? (
                    <p className="mt-1 text-xs text-dwel-muted">
                      Reason: {cashback.ineligible_reason}
                    </p>
                  ) : null}
                </div>
              ) : app.status === 'approved' ? (
                <p className="mt-2 text-sm text-dwel-muted">
                  No cashback eligibility row yet for this application. Eligibility display is not a
                  payout promise.
                </p>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}
    </RenterShell>
  );
}
