import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { ErrorState, Shell } from '../components/Shell';
import { moneyFromCents } from '../format';

const STATUS_DISPLAY: Record<string, string> = {
  draft: 'Draft application',
  awaiting_landlord_interest: 'Waiting for landlord review',
  mutual_interest: 'Landlord interested — screening next',
  awaiting_consent: 'Complete your screening',
  screening_authorized: 'Background check in progress',
  screening_running: 'Background check in progress',
  screening_in_progress: 'Background check in progress',
  screened: 'Results ready — landlord reviewing',
  screening_complete: 'Results ready — landlord reviewing',
  approved: 'Approved',
  declined: 'Not selected',
  withdrawn: 'Withdrawn',
  closed: 'Closed',
  submitted: 'Submitted',
  prescreen: 'Pre-screen in progress',
};

const TIMELINE = [
  'awaiting_landlord_interest',
  'mutual_interest',
  'awaiting_consent',
  'screening_running',
  'screened',
  'approved',
];

function timelineIndex(status: string): number {
  if (status === 'declined' || status === 'withdrawn' || status === 'closed') return -1;
  if (status === 'draft') return 0;
  if (status === 'screening_authorized' || status === 'screening_in_progress') return 3;
  if (status === 'screening_complete') return 4;
  const idx = TIMELINE.indexOf(status);
  return idx >= 0 ? idx : 0;
}

export function ApplicationsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.listMyApplications>>['applications'] | null>(null);
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
      {error && <ErrorState title="Unavailable">{error}</ErrorState>}
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
            const label = STATUS_DISPLAY[app.status] ?? app.status;
            const current = timelineIndex(app.status);
            return (
              <article key={app.application_id} className="card" style={{ padding: '1.25rem' }}>
                <p className="section-eyebrow">
                  {app.listing?.city ?? 'Listing'} · {app.listing?.state ?? ''}
                </p>
                <h2 className="font-display" style={{ fontSize: '1.4rem', margin: 0 }}>
                  {app.listing?.line1 ?? app.listing_id ?? 'Application'}
                </h2>
                {app.listing?.rent_amount_cents != null && (
                  <p style={{ margin: '0.25rem 0 0', color: 'hsl(var(--muted-foreground))' }}>
                    {moneyFromCents(app.listing.rent_amount_cents)}/mo
                  </p>
                )}
                <p style={{ fontWeight: 700, marginTop: '0.75rem' }}>{label}</p>
                {app.status === 'declined' && (
                  <p style={{ color: 'hsl(var(--muted-foreground))' }}>
                    This application was not selected. No additional detail is available.
                  </p>
                )}
                {app.status === 'awaiting_consent' && (
                  <Link
                    className="btn btn-primary"
                    style={{ marginTop: '0.75rem', display: 'inline-flex' }}
                    to={`/applications/${app.application_id}/consent`}
                  >
                    Complete screening
                  </Link>
                )}
                {app.status === 'approved' && (
                  <div className="card" style={{ marginTop: '0.85rem', padding: '0.85rem', background: 'hsl(var(--primary) / 0.15)' }}>
                    Cashback confirmation will appear here after lease execution.
                  </div>
                )}
                <ol className="timeline">
                  {TIMELINE.map((step, index) => (
                    <li key={step}>
                      <span className={`dot ${current >= index ? 'done' : ''}`}>{index + 1}</span>
                      <span>{STATUS_DISPLAY[step] ?? step}</span>
                    </li>
                  ))}
                </ol>
                <Link
                  to={`/applications/${app.application_id}/details`}
                  style={{ display: 'inline-block', marginTop: '0.75rem', fontWeight: 700 }}
                >
                  View my application →
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
