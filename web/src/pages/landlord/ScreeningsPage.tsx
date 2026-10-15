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
import {
  applicationStatusLabel,
  applicationStatusTone,
  friendlyApiError,
} from '../../lib/application-status';

type Row = {
  application_id: string;
  status: string;
  created_at: string;
  listing_label: string;
  listing_id: string;
  label: string;
};

export function LandlordScreeningsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!getSessionToken()) {
      setLoading(false);
      setError('Sign in as a Home Provider to view screenings.');
      return;
    }
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    if (params.get('status') === 'in_progress') setFilter('in_progress');
    let cancelled = false;
    void (async () => {
      try {
        const listings = await api.landlordListings();
        const out: Row[] = [];
        for (const l of listings.listings) {
          const apps = await api.landlordApplicants(l.id);
          for (const a of apps.applicants) {
            if (
              ![
                'awaiting_consent',
                'screening_authorized',
                'screening_running',
                'screening_in_progress',
                'screened',
                'screening_complete',
                'awaiting_provider_configuration',
              ].includes(a.status)
            ) {
              continue;
            }
            const name = a.contact
              ? [a.contact.given_name, a.contact.family_name?.slice(0, 1)]
                  .filter(Boolean)
                  .join(' ')
              : `Applicant · ${a.score_band}`;
            out.push({
              application_id: a.application_id,
              status: a.status,
              created_at: a.created_at,
              listing_id: l.id,
              listing_label: l.line1 || l.city || l.id,
              label: name || 'Applicant',
            });
          }
        }
        out.sort((a, b) => b.created_at.localeCompare(a.created_at));
        if (!cancelled) setRows(out);
      } catch (err) {
        if (!cancelled) {
          setError(
            friendlyApiError(err instanceof ApiError ? err.message : 'Could not load screenings.'),
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

  const awaiting = rows.filter((r) => r.status === 'awaiting_consent').length;
  const inProgress = rows.filter((r) =>
    ['screening_authorized', 'screening_running', 'screening_in_progress'].includes(r.status),
  ).length;
  const complete = rows.filter((r) =>
    ['screened', 'screening_complete'].includes(r.status),
  ).length;

  const filtered = rows.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'awaiting') return r.status === 'awaiting_consent';
    if (filter === 'in_progress') {
      return ['screening_authorized', 'screening_running', 'screening_in_progress'].includes(
        r.status,
      );
    }
    if (filter === 'complete') return ['screened', 'screening_complete'].includes(r.status);
    return true;
  });

  return (
    <LandlordShell>
      <h1 className="text-[32px] font-semibold tracking-tight">Screenings</h1>
      <p className="mt-1 text-sm text-dwel-muted">
        Track consent, progress, and completed reports.
      </p>

      {loading ? <div className="mt-6"><LoadingState /></div> : null}
      {error ? <div className="mt-6"><ErrorState message={error} /></div> : null}

      {!loading && !error ? (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <MetricCard label="Awaiting consent" value={awaiting} />
            <MetricCard label="In progress" value={inProgress} />
            <MetricCard label="Complete" value={complete} />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <select
              className="min-h-11 rounded-[10px] border border-dwel-line bg-white px-3"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter screenings"
            >
              <option value="all">All</option>
              <option value="awaiting">Awaiting consent</option>
              <option value="in_progress">In progress</option>
              <option value="complete">Complete</option>
            </select>
          </div>

          <Card className="mt-4 overflow-x-auto p-0">
            {filtered.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No screenings need your attention"
                  body="Request screening from an applicant to start a report."
                />
              </div>
            ) : (
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-dwel-muted">
                    <th className="px-3 py-3 font-bold">Applicant</th>
                    <th className="px-3 py-3 font-bold">Listing</th>
                    <th className="px-3 py-3 font-bold">Status</th>
                    <th className="px-3 py-3 font-bold">Updated</th>
                    <th className="px-3 py-3 font-bold" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.application_id} className="border-t border-dwel-line">
                      <td className="px-3 py-3 font-semibold">{r.label}</td>
                      <td className="px-3 py-3">{r.listing_label}</td>
                      <td className="px-3 py-3">
                        <Badge tone={applicationStatusTone(r.status)}>
                          {applicationStatusLabel(r.status)}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-dwel-muted">
                        {new Date(r.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link href={`/listings/applicants?app=${r.application_id}`}>
                          <Button variant="secondary" className="!py-2 text-sm">
                            {['screened', 'screening_complete'].includes(r.status)
                              ? 'Review'
                              : 'View'}
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      ) : null}
    </LandlordShell>
  );
}
