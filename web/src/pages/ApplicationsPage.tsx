import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type RenterApplicationSummary } from '../api';
import { useAuth } from '../auth';
import { ErrorState, Shell } from '../components/Shell';
import { moneyFromCents } from '../format';
import { applicationStatusLabel, listingStatusLabel, nextActorLabel } from '../lib/application-status';

function actionHref(
  app: { application_id: string; listing_id: string | null },
  hint: string | null | undefined,
): string {
  if (hint === 'apply' && app.listing_id) return `/applications/new/${app.listing_id}`;
  if (hint === 'screening') return `/applications/${app.application_id}/consent`;
  if (hint === 'search') return '/listings';
  return `/applications/${app.application_id}/details`;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return 'No recorded update';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'No recorded update';
  return date.toLocaleString();
}

export function ApplicationsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<RenterApplicationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/sign-in?return=/applications');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await api.listMyApplications();
        if (!cancelled) {
          setRows(data.applications);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load applications');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading, navigate]);

  return (
    <Shell>
      <p className="section-eyebrow">Your pipeline</p>
      <h1 className="section-title">Applications</h1>
      {error && <ErrorState title="Could not load applications">{error}</ErrorState>}
      {rows === null && !error && <div className="skeleton" style={{ height: '8rem', marginTop: '1rem' }} />}
      {rows && rows.length === 0 && (
        <div className="empty-state" style={{ marginTop: '1.5rem' }}>
          No applications yet.{' '}
          <Link to="/listings" style={{ fontWeight: 700, color: 'hsl(var(--teal))' }}>
            Browse homes
          </Link>
        </div>
      )}
      {rows && rows.length > 0 && (
        <div style={{ display: 'grid', gap: '1rem', marginTop: '1.25rem' }}>
          {rows.map((app) => {
            const label = app.progress?.status_label ?? applicationStatusLabel(app.status);
            const address = [
              app.listing?.line1,
              app.listing?.city,
              app.listing?.state,
              app.listing?.postal_code,
            ]
              .filter(Boolean)
              .join(', ');
            const action = app.progress?.primary_action;
            return (
              <article key={app.application_id} className="card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '5.5rem 1fr', gap: '1rem' }}>
                  <div
                    style={{
                      width: '5.5rem',
                      height: '5.5rem',
                      borderRadius: '0.75rem',
                      overflow: 'hidden',
                      background: 'hsl(var(--muted))',
                    }}
                  >
                    {app.listing?.thumbnail_url ? (
                      <img
                        src={app.listing.thumbnail_url}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : null}
                  </div>
                  <div>
                    <p className="section-eyebrow">{app.listing?.property_type ?? 'Home'}</p>
                    <h2 className="font-display" style={{ fontSize: '1.4rem', margin: 0 }}>
                      {app.listing?.line1 ?? 'Property address not on file'}
                    </h2>
                    <p style={{ margin: '0.25rem 0 0', color: 'hsl(var(--muted-foreground))' }}>
                      {address || 'Address not on file'}
                    </p>
                    {app.listing?.rent_amount_cents != null && (
                      <p style={{ margin: '0.25rem 0 0', color: 'hsl(var(--muted-foreground))' }}>
                        {moneyFromCents(app.listing.rent_amount_cents)}/mo
                      </p>
                    )}
                  </div>
                </div>
                <p style={{ fontWeight: 700, marginTop: '0.85rem' }}>{label}</p>
                <p className="muted" style={{ margin: '0.2rem 0' }}>
                  Listing: {listingStatusLabel(app.listing?.status)}
                </p>
                <p className="muted" style={{ margin: '0.2rem 0' }}>
                  {app.record_kind === 'formal' ? 'Rental application' : 'Interest'}
                </p>
                <p className="muted" style={{ margin: '0.2rem 0' }}>
                  {app.record_kind === 'formal'
                    ? app.submitted_at
                      ? `Submitted ${formatWhen(app.submitted_at)}`
                      : `Started ${formatWhen(app.created_at)}`
                    : `Interest sent ${formatWhen(app.created_at)}`}
                </p>
                <p className="muted" style={{ margin: '0.2rem 0' }}>
                  Current stage: {app.progress?.current_label ?? 'Not recorded'}
                </p>
                <p className="muted" style={{ margin: '0.2rem 0' }}>
                  Most recent update: {formatWhen(app.progress?.last_update_at ?? app.created_at)}
                </p>
                <p style={{ margin: '0.2rem 0' }}>
                  Next step: {app.progress?.next_step ?? 'No next step is recorded for this application.'}
                </p>
                <p style={{ margin: '0.2rem 0' }}>
                  Next action: {nextActorLabel(app.progress?.next_action_owner)}
                </p>
                {app.progress?.action_required && (
                  <p>{app.progress.action_required}</p>
                )}
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.85rem' }}>
                  {action && (
                    <Link className="btn btn-primary" to={actionHref(app, action.href_hint)}>
                      {action.label}
                    </Link>
                  )}
                  <Link className="btn btn-secondary" to={`/applications/${app.application_id}/details`}>
                    View submitted details
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
