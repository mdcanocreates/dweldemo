import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { LandlordShell } from '../../components/layout/LandlordShell';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { api, ApiError, getSessionToken } from '../../api/client';
import { formatCents } from '../../lib/money';

type ApiListing = {
  id: string;
  status: string;
  rent_amount_cents: number;
  city: string | null;
  state: string | null;
  line1: string | null;
  bedrooms: number | null;
  bathrooms?: number | null;
  applicant_count: number | string;
  photo_url?: string | null;
};

/** Production Home Provider listings — API-backed (not localStorage). */
export function LandlordListingsPage() {
  const [listings, setListings] = useState<ApiListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [screeningByListing, setScreeningByListing] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!getSessionToken()) {
      setLoading(false);
      setError('Sign in as a Home Provider to view listings.');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.landlordListings();
        if (cancelled) return;
        setListings(res.listings);
        const screens: Record<string, number> = {};
        for (const l of res.listings) {
          try {
            const apps = await api.landlordApplicants(l.id);
            screens[l.id] = apps.applicants.filter((a) =>
              [
                'awaiting_consent',
                'screening_authorized',
                'screening_running',
                'screened',
                'screening_complete',
                'awaiting_provider_configuration',
              ].includes(a.status),
            ).length;
          } catch {
            screens[l.id] = 0;
          }
        }
        if (!cancelled) setScreeningByListing(screens);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load listings.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <LandlordShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Listings</h1>
          <p className="mt-1 text-sm text-dwel-gray-500">
            Homes you publish on Dwel. Interest and screening counts come from live applications.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/listings/new">
            <Button>Create listing</Button>
          </Link>
          <Link href="/listings/applicants">
            <Button variant="secondary">Applicants</Button>
          </Link>
        </div>
      </div>

      {loading && <p className="mt-6 text-sm text-dwel-gray-500">Loading…</p>}
      {error && <p className="mt-4 text-sm text-dwel-red">{error}</p>}

      {!loading && listings.length === 0 && (
        <Card className="mt-6 p-6 text-sm text-dwel-gray-500">
          No listings yet. Seeded or published homes will appear here with cover photos.
        </Card>
      )}

      <div className="mt-6 space-y-3">
        {listings.map((l) => (
          <Card key={l.id} className="overflow-hidden p-0">
            <div className="flex flex-col sm:flex-row">
              <div className="h-36 w-full shrink-0 bg-dwel-gray-200 sm:h-auto sm:w-44">
                {l.photo_url ? (
                  <img
                    src={l.photo_url}
                    alt={l.line1 || 'Listing'}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-36 items-center justify-center text-xs text-dwel-gray-400 sm:h-full">
                    No photo
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-wrap items-start justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold">{l.line1 || 'Listing'}</p>
                  <p className="text-sm text-dwel-gray-500">
                    {[l.city, l.state].filter(Boolean).join(', ')} ·{' '}
                    {formatCents(l.rent_amount_cents)}/mo
                    {l.bedrooms != null ? ` · ${l.bedrooms} bed` : ''}
                  </p>
                  <p className="mt-2 text-xs text-dwel-gray-500">
                    {Number(l.applicant_count)} interest · {screeningByListing[l.id] ?? 0} screening
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge tone={l.status === 'active' ? 'mint' : 'amber'}>{l.status}</Badge>
                  <Link
                    href={`/landlord/listings/${l.id}`}
                    className="text-sm font-semibold underline"
                  >
                    Open
                  </Link>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </LandlordShell>
  );
}
