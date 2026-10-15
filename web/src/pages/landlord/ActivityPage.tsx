import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { LandlordShell } from '../../components/layout/LandlordShell';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { LoadingState } from '../../components/ui/LoadingState';
import { api, ApiError, getSessionToken } from '../../api/client';
import { friendlyApiError } from '../../lib/application-status';
import { isUiPreviewActive } from '../../lib/ui-preview';
import { getUiPreviewUniverse } from '../../lib/ui-preview-data';

const CATEGORIES = [
  { value: 'all', label: 'All categories' },
  { value: 'listing', label: 'Listings' },
  { value: 'applicant', label: 'Applicants' },
  { value: 'screening', label: 'Screenings' },
  { value: 'broker', label: 'Broker' },
  { value: 'settings', label: 'Settings' },
] as const;

type FeedItem = {
  id: string;
  text: string;
  when: string;
  kind: string;
  href?: string;
};

function categorizeEvent(eventType: string): string {
  const t = eventType.toLowerCase();
  if (t.includes('listing')) return 'listing';
  if (t.includes('screen')) return 'screening';
  if (t.includes('broker') || t.includes('invitation')) return 'broker';
  if (t.includes('setting') || t.includes('org.')) return 'settings';
  if (t.includes('applicant') || t.includes('application') || t.includes('decision')) {
    return 'applicant';
  }
  return 'applicant';
}

function formatEvent(eventType: string): string {
  return eventType.replaceAll('_', ' ').replaceAll('.', ' · ');
}

/**
 * Activity feed — GET /v1/landlord/activity (preview uses in-memory events).
 */
export function LandlordActivityPage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      if (isUiPreviewActive()) {
        setItems(
          getUiPreviewUniverse().activity.map((e) => ({
            id: e.id,
            text: e.text,
            when: e.when,
            kind: e.kind,
            href: e.href,
          })),
        );
        return;
      }
      if (!getSessionToken()) throw new Error('Sign in required');
      const res = await api.landlordActivity({
        limit: 100,
        category: category !== 'all' ? category : undefined,
      });
      setItems(
        res.items.map((e, i) => ({
          id: `${e.aggregate_id}-${e.occurred_at}-${i}`,
          text: formatEvent(e.event_type),
          when: new Date(e.occurred_at).toLocaleString(),
          kind: categorizeEvent(e.event_type),
          href: e.application_id
            ? `/landlord/applicants/${e.application_id}`
            : e.listing_id
              ? `/landlord/listings/${e.listing_id}`
              : undefined,
        })),
      );
    } catch (err) {
      setError(
        friendlyApiError(err instanceof ApiError ? err.message : 'Could not load activity.'),
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [category]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((e) => {
      if (isUiPreviewActive() && category !== 'all' && e.kind !== category) return false;
      if (!q) return true;
      return e.text.toLowerCase().includes(q) || e.kind.toLowerCase().includes(q);
    });
  }, [items, query, category]);

  return (
    <LandlordShell>
      <h1 className="text-2xl font-semibold">Activity</h1>
      <p className="mt-1 text-sm text-dwel-muted">
        Listing updates, applicant decisions, screening events, and broker recommendations.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <input
          type="search"
          placeholder="Search activity…"
          aria-label="Search activity"
          className="min-h-11 flex-1 rounded-[10px] border border-dwel-line bg-white px-3 text-sm sm:min-w-[220px]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Filter by category"
          className="min-h-11 rounded-[10px] border border-dwel-line bg-white px-3 text-sm"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

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

      {!loading && !error && filtered.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No matching activity"
            body="Try a different search or category filter."
          />
        </div>
      ) : null}

      {!loading && !error && filtered.length > 0 ? (
        <div className="mt-6 space-y-3">
          {filtered.map((e) => {
            const inner = (
              <>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-dwel-muted">
                    {CATEGORIES.find((c) => c.value === e.kind)?.label ?? e.kind}
                  </p>
                  <p className="mt-1 text-sm font-medium">{e.text}</p>
                </div>
                <span className="text-xs text-dwel-muted">{e.when}</span>
              </>
            );
            return e.href ? (
              <Link key={e.id} href={e.href}>
                <Card className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-4 transition hover:border-dwel-blue hover:bg-[#f8fbff]">
                  {inner}
                </Card>
              </Link>
            ) : (
              <Card key={e.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                {inner}
              </Card>
            );
          })}
        </div>
      ) : null}
    </LandlordShell>
  );
}
