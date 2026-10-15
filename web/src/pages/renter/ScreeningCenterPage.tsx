import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { RenterShell } from '../../components/layout/RenterShell';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { LoadingState } from '../../components/ui/LoadingState';
import { api, ApiError, getSessionToken } from '../../api/client';
import {
  applicationStatusLabel,
  applicationStatusTone,
  friendlyApiError,
} from '../../lib/application-status';
import { formatCents } from '../../lib/money';

type Center = Awaited<ReturnType<typeof api.getScreeningCenter>>;

function reportFreshness(issuedAt: string | null): string {
  if (!issuedAt) return 'No issue date';
  const days = Math.floor((Date.now() - new Date(issuedAt).getTime()) / 86_400_000);
  if (days <= 0) return 'Issued today';
  if (days === 1) return '1 day old';
  return `${days} days old`;
}

function nextActions(status: string, applicationId: string): Array<{ label: string; href: string }> {
  if (status === 'awaiting_consent') {
    return [
      {
        label: 'Authorize screening',
        href: `/applications/${applicationId}/screening`,
      },
    ];
  }
  if (status === 'info_requested' || status === 'more_info_requested') {
    return [{ label: 'Respond to request', href: `/applications/${applicationId}` }];
  }
  if (['screening_running', 'screening_in_progress', 'screening_authorized'].includes(status)) {
    return [{ label: 'View application', href: `/applications/${applicationId}` }];
  }
  return [{ label: 'View application', href: `/applications/${applicationId}` }];
}

/** Renter Screening Center — `#/screening`. */
export function ScreeningCenterPage() {
  const [data, setData] = useState<Center | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!getSessionToken()) {
      setLoading(false);
      setError('Sign in to view your screening center.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await api.getScreeningCenter());
    } catch (err) {
      setError(
        friendlyApiError(err instanceof ApiError ? err.message : 'Could not load screening center.'),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <RenterShell workspace>
      <h1 className="text-[30px] font-semibold tracking-tight">Screening center</h1>
      <p className="mt-1 text-sm text-dwel-muted">
        Report status, freshness, and next actions across your applications. Share history is
        per Home Provider authorization — not a global unlock.
      </p>

      {loading ? (
        <div className="mt-6">
          <LoadingState />
        </div>
      ) : null}
      {error ? (
        <div className="mt-6">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : null}

      {data && !loading ? (
        <div className="mt-6 space-y-4">
          {data.applications.length === 0 ? (
            <EmptyState
              title="No screening activity yet"
              body="When a Home Provider moves forward, screening status will appear here."
              action={
                <Link href="/search">
                  <Button className="!py-2 text-sm">Browse homes</Button>
                </Link>
              }
            />
          ) : (
            data.applications.map((app) => {
              const actions = nextActions(app.status, app.application_id);
              return (
                <Card key={app.application_id} className="p-[18px]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-dwel-muted">Application</p>
                      <Link
                        href={`/applications/${app.application_id}`}
                        className="font-semibold underline"
                      >
                        {app.application_id.slice(0, 8)}…
                      </Link>
                      {app.listing_id ? (
                        <p className="mt-1 text-xs text-dwel-muted">
                          Listing{' '}
                          <Link href={`/listing/${app.listing_id}`} className="underline">
                            {app.listing_id.slice(0, 8)}…
                          </Link>
                        </p>
                      ) : null}
                    </div>
                    <Badge tone={applicationStatusTone(app.status)}>
                      {applicationStatusLabel(app.status)}
                    </Badge>
                  </div>

                  <div className="mt-4">
                    <h3 className="text-sm font-semibold">Report status</h3>
                    {app.reports.length === 0 ? (
                      <p className="mt-1 text-sm text-dwel-muted">No reports on file yet.</p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-sm">
                        {app.reports.map((r) => (
                          <li
                            key={`${r.report_kind}-${r.issued_at}`}
                            className="flex flex-wrap justify-between gap-2 rounded-[10px] bg-dwel-surface2 px-3 py-2"
                          >
                            <span className="capitalize">{r.report_kind.replaceAll('_', ' ')}</span>
                            <span>
                              {r.status}
                              <span className="ml-2 text-xs text-dwel-muted">
                                · {reportFreshness(r.issued_at)}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="mt-4">
                    <h3 className="text-sm font-semibold">Next actions</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {actions.map((a) => (
                        <Link key={a.href + a.label} href={a.href}>
                          <Button variant="secondary" className="!py-2 text-sm">
                            {a.label}
                          </Button>
                        </Link>
                      ))}
                    </div>
                  </div>
                </Card>
              );
            })
          )}

          {data.ny_submissions.length > 0 ? (
            <Card className="p-[18px]">
              <h2 className="text-lg font-semibold">NY self-provided reports</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {data.ny_submissions.map((n) => (
                  <li key={n.id} className="rounded-[10px] border border-dwel-line px-3 py-2">
                    {n.report_source} · {n.state_jurisdiction}
                    <span className="ml-2 text-xs text-dwel-muted">
                      completed {new Date(n.completed_at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {data.cashback.length > 0 ? (
            <Card className="p-[18px]">
              <h2 className="text-lg font-semibold">Cashback status</h2>
              <p className="mt-1 text-xs text-dwel-muted">
                Status only. Funding is a pending business decision — not a payout promise.
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {data.cashback.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap justify-between gap-2 rounded-[10px] border border-dwel-line px-3 py-2"
                  >
                    <span>
                      {c.status}
                      {c.amount_cents != null ? ` · ${formatCents(c.amount_cents)}` : ''}
                    </span>
                    <Link
                      href={`/applications/${c.application_id}`}
                      className="text-xs font-semibold underline"
                    >
                      Application
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : null}
    </RenterShell>
  );
}
