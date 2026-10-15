import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { LandlordShell } from '../../components/layout/LandlordShell';
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

type Listing = {
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

type Applicant = {
  application_id: string;
  status: string;
  created_at: string;
  score_band: string;
  contact: null | { given_name: string | null; family_name: string | null };
};

/** Home Provider listing detail — stays inside HP shell. */
export function LandlordListingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [listing, setListing] = useState<Listing | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!id || !getSessionToken()) {
      setLoading(false);
      setError('Sign in as a Home Provider to view this listing.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.landlordListings();
      const found = res.listings.find((l) => l.id === id) ?? null;
      if (!found) {
        setError('Listing not found in your organization.');
        setListing(null);
        return;
      }
      setListing(found);
      const apps = await api.landlordApplicants(id);
      setApplicants(apps.applicants);
    } catch (err) {
      setError(friendlyApiError(err instanceof ApiError ? err.message : 'Could not load listing.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function confirmFresh() {
    if (!id) return;
    setBusy(true);
    try {
      await api.confirmListingFreshness(id);
      await load();
    } catch (err) {
      setError(
        friendlyApiError(err instanceof ApiError ? err.message : 'Could not confirm freshness.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: 'active' | 'paused' | 'rented') {
    if (!id) return;
    setBusy(true);
    try {
      await api.updateListingStatus(id, status);
      await load();
    } catch (err) {
      setError(friendlyApiError(err instanceof ApiError ? err.message : 'Status update failed.'));
    } finally {
      setBusy(false);
    }
  }

  function applicantLabel(a: Applicant): string {
    if (a.contact) {
      return (
        [a.contact.given_name, a.contact.family_name?.slice(0, 1)]
          .filter(Boolean)
          .join(' ')
          .trim() || 'Applicant'
      );
    }
    return `Applicant · ${a.score_band}`;
  }

  return (
    <LandlordShell>
      <Link href="/listings">
        <Button variant="secondary" className="!py-2 text-sm">
          ← Back to listings
        </Button>
      </Link>

      {loading ? <div className="mt-6"><LoadingState /></div> : null}
      {error ? <div className="mt-6"><ErrorState message={error} onRetry={() => void load()} /></div> : null}

      {listing ? (
        <>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-[32px] font-semibold tracking-tight">{listing.line1 || 'Listing'}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={applicationStatusTone(listing.status)}>
                  {applicationStatusLabel(listing.status)}
                </Badge>
                <span className="text-sm text-dwel-muted">
                  {listing.city}, {listing.state}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/landlord/listings/${listing.id}/edit`}>
                <Button variant="secondary" className="!py-2 text-sm">
                  Edit listing
                </Button>
              </Link>
              <a
                href={`#/listing/${listing.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex"
              >
                <Button variant="secondary" className="!py-2 text-sm">
                  View as renter ↗
                </Button>
              </a>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="flex h-[290px] items-center justify-center overflow-hidden rounded-[16px] bg-dwel-surface2">
                {listing.photo_url ? (
                  <img
                    src={listing.photo_url}
                    alt={listing.line1 || 'Listing photo'}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-dwel-muted">No photo yet</span>
                )}
              </div>
              <div className="mt-3.5 grid grid-cols-3 gap-3">
                <Card className="p-4">
                  <span className="text-xs text-dwel-muted">Monthly rent</span>
                  <strong className="mt-1 block text-[22px]">
                    {formatCents(listing.rent_amount_cents)}
                  </strong>
                </Card>
                <Card className="p-4">
                  <span className="text-xs text-dwel-muted">Layout</span>
                  <strong className="mt-1 block text-[22px]">
                    {listing.bedrooms ?? '—'} bd · {listing.bathrooms ?? '—'} ba
                  </strong>
                </Card>
                <Card className="p-4">
                  <span className="text-xs text-dwel-muted">Interests</span>
                  <strong className="mt-1 block text-[22px]">
                    {Number(listing.applicant_count || 0)}
                  </strong>
                </Card>
              </div>
            </div>

            <Card className="p-[18px]">
              <h2 className="text-xl font-semibold">Status controls</h2>
              <p className="mt-2 text-sm text-dwel-muted">
                Pause or close without leaving the Home Provider portal.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {listing.status !== 'paused' ? (
                  <Button
                    variant="secondary"
                    className="!py-2 text-sm"
                    disabled={busy}
                    onClick={() => void setStatus('paused')}
                  >
                    Pause listing
                  </Button>
                ) : (
                  <Button
                    className="!py-2 text-sm"
                    disabled={busy}
                    onClick={() => void setStatus('active')}
                  >
                    Resume listing
                  </Button>
                )}
                <Button
                  variant="destructive"
                  className="!py-2 text-sm"
                  disabled={busy}
                  onClick={() => void setStatus('rented')}
                >
                  Mark rented
                </Button>
                <Button
                  variant="secondary"
                  className="!py-2 text-sm"
                  disabled={busy}
                  onClick={() => void confirmFresh()}
                >
                  Confirm still available
                </Button>
              </div>
              <p className="mt-6 text-sm text-dwel-muted">
                Confirming availability updates listing freshness for marketplace trust signals.
              </p>
            </Card>
          </div>

          <div className="mt-8 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Applicants for this listing</h2>
            <Link href="/listings/applicants" className="text-sm font-semibold underline">
              View all
            </Link>
          </div>
          <Card className="mt-3 p-[18px]">
            {applicants.length === 0 ? (
              <EmptyState title="No applicants yet" body="Renter interest will appear here." />
            ) : (
              <div className="divide-y divide-dwel-line">
                {applicants.map((a) => (
                  <div
                    key={a.application_id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3.5"
                  >
                    <div>
                      <p className="font-semibold">{applicantLabel(a)}</p>
                      <Badge tone={applicationStatusTone(a.status)} className="mt-1">
                        {applicationStatusLabel(a.status)}
                      </Badge>
                    </div>
                    <Link href={`/listings/applicants?app=${a.application_id}`}>
                      <Button variant="secondary" className="!py-2 text-sm">
                        Review
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}
    </LandlordShell>
  );
}
