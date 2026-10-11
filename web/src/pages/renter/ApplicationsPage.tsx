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
import {
  ApplicationProgressTimeline,
  type ApplicationProgress,
} from '../../components/application/ApplicationProgressTimeline';

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

function nextAction(
  a: AppRow,
): { label: string; href: string; primary: boolean } | null {
  if (!isValidApplicationId(a.application_id)) return null;
  const detail = applicationPath(a.application_id);
  if (!detail) return null;
  const pa = a.progress?.primary_action;
  if (pa?.href_hint === 'screening') {
    const href = applicationScreeningPath(a.application_id);
    return href ? { label: pa.label, href, primary: true } : { label: pa.label, href: detail, primary: true };
  }
  if (pa?.href_hint === 'search') {
    return { label: pa.label, href: '/search', primary: false };
  }
  if (pa) {
    return { label: pa.label, href: detail, primary: true };
  }
  return { label: 'View', href: detail, primary: false };
}

/** Server-backed applications list — fully clickable rows. */
export function ApplicationsPage() {
  const [items, setItems] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!getSessionToken()) {
      setLoading(false);
      setError('Sign in to see your applications.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.listMyApplications();
      setItems(res.applications);
    } catch (err) {
      setError(
        friendlyApiError(err instanceof ApiError ? err.message : 'Could not load applications.'),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const onFocus = () => {
      void load();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  return (
    <RenterShell workspace>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-semibold tracking-tight">My applications</h1>
          <p className="mt-1 text-sm text-dwel-muted">
            Track interest, screening, and decisions.
          </p>
        </div>
        <Link href="/search">
          <Button className="min-h-11">Browse more homes</Button>
        </Link>
      </div>

      {loading ? (
        <div className="mt-6">
          <LoadingState />
        </div>
      ) : null}
      {error ? (
        <div className="mt-6">
          <ErrorState
            message={error}
            onRetry={() => void load()}
            action={
              <Link href="/auth/login?returnTo=/applications">
                <Button variant="secondary" className="!py-2 text-sm">
                  Sign in
                </Button>
              </Link>
            }
          />
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No applications yet"
            body="Express interest on a listing to start an application."
            action={
              <Link href="/search">
                <Button>Browse homes</Button>
              </Link>
            }
          />
        </div>
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <Card className="mt-6 p-[18px]">
          <div className="divide-y divide-dwel-line">
            {items
              .filter((a) => isValidApplicationId(a.application_id))
              .map((a) => {
              const detailHref = applicationPath(a.application_id);
              const action = nextAction(a);
              if (!detailHref || !action) return null;
              const label = a.progress?.status_label ?? applicationStatusLabel(a.status);
              return (
                <div
                  key={a.application_id}
                  className="grid grid-cols-1 items-center gap-3 py-3.5 sm:grid-cols-[1fr_auto]"
                >
                  <Link href={detailHref} className="min-w-0">
                    <p className="font-semibold text-dwel-ink">
                      {a.listing?.line1 || a.listing?.city || 'Listing'}
                    </p>
                    <p className="text-sm text-dwel-muted">
                      {a.listing?.rent_amount_cents != null
                        ? `${formatCents(a.listing.rent_amount_cents)}/mo`
                        : ''}
                      {a.listing?.city ? ` · ${a.listing.city}` : ''}
                      {a.listing?.state ? `, ${a.listing.state}` : ''}
                      {' · '}
                      Started {new Date(a.created_at).toLocaleDateString()}
                      {a.progress?.last_update_at
                        ? ` · Updated ${new Date(a.progress.last_update_at).toLocaleDateString()}`
                        : ''}
                    </p>
                    <Badge tone={applicationStatusTone(a.status)} className="mt-2">
                      {label}
                    </Badge>
                    {a.progress?.next_action_owner &&
                    a.progress.next_action_owner !== 'none' ? (
                      <p className="mt-1 text-xs text-dwel-muted">
                        Next:{' '}
                        {a.progress.next_action_owner === 'renter'
                          ? 'You'
                          : a.progress.next_action_owner === 'home_provider'
                            ? 'Home Provider'
                            : 'System'}
                      </p>
                    ) : null}
                    {a.progress ? (
                      <ApplicationProgressTimeline progress={a.progress} compact />
                    ) : null}
                  </Link>
                  <Link href={action.href}>
                    <Button
                      variant={action.primary ? 'primary' : 'secondary'}
                      className="!py-2 text-sm"
                    >
                      {action.label}
                    </Button>
                  </Link>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}
    </RenterShell>
  );
}
