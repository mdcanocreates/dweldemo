import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { BrokerShell } from './BrokerDashboard';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { api, ApiError, getSessionToken } from '../../api/client';
import { formatCents } from '../../lib/money';
import { LISTING_IMAGE_PLACEHOLDER } from '../../lib/listing-image';

type ListingRow = {
  id: string;
  org_id: string;
  provider_name: string;
  status: string;
  rent_amount_cents: number;
  line1: string | null;
  city: string | null;
  state: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  applicant_count: number;
  screening_count: number;
  photo_url: string | null;
};

/** Broker-scoped listing detail — stays inside /broker/* workspace. */
export function BrokerListingDetailPage() {
  const params = useParams<{ id: string }>();
  const [listing, setListing] = useState<ListingRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getSessionToken() || !params.id) {
      setLoading(false);
      setError('Sign in as a broker to view delegated listings.');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.brokerPortfolioListings();
        const row = res.listings.find((l) => l.id === params.id) ?? null;
        if (!cancelled) {
          if (!row) setError('Listing not found in your delegated portfolio.');
          setListing(row);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load listing');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  return (
    <BrokerShell>
      <Link href="/broker/listings" className="text-sm text-dwel-muted underline">
        ← Broker listings
      </Link>
      {loading && <p className="mt-4 text-sm text-dwel-muted">Loading…</p>}
      {error && <p className="mt-4 text-sm text-dwel-red">{error}</p>}
      {listing && (
        <div className="mt-4 space-y-4">
          <div className="overflow-hidden rounded-[16px] border border-dwel-line bg-dwel-surface">
            <img
              src={listing.photo_url || LISTING_IMAGE_PLACEHOLDER}
              alt=""
              className="aspect-[16/9] w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src = LISTING_IMAGE_PLACEHOLDER;
              }}
            />
            <div className="space-y-2 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="mint">{listing.status}</Badge>
                <span className="text-sm text-dwel-muted">{listing.provider_name}</span>
              </div>
              <h1 className="text-2xl font-semibold">{listing.line1 ?? 'Listing'}</h1>
              <p className="text-sm text-dwel-muted">
                {[listing.city, listing.state].filter(Boolean).join(', ')}
              </p>
              <p className="text-xl font-semibold">{formatCents(listing.rent_amount_cents)}/mo</p>
              <p className="text-sm text-dwel-muted">
                {listing.bedrooms ?? '—'} bed · {listing.bathrooms ?? '—'} bath ·{' '}
                {listing.applicant_count} applicants · {listing.screening_count} screenings
              </p>
            </div>
          </div>
          <Card className="flex flex-wrap gap-3 p-4">
            <Link href={`/broker/applicants?listing=${listing.id}`}>
              <Button>View applicants</Button>
            </Link>
            <Link href={`/broker/providers/${listing.org_id}`}>
              <Button variant="secondary">Provider</Button>
            </Link>
            <a
              href={`#/listing/${listing.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex"
            >
              <Button variant="secondary">View as renter (new tab)</Button>
            </a>
          </Card>
          <p className="text-xs text-dwel-muted">
            Broker links stay in the broker workspace. Final approve/decline remains with the Home
            Provider unless an approved delegation policy says otherwise.
          </p>
        </div>
      )}
    </BrokerShell>
  );
}
