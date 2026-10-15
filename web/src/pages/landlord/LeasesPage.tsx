import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { LandlordShell } from '../../components/layout/LandlordShell';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { LoadingState } from '../../components/ui/LoadingState';
import { api, ApiError, getSessionToken } from '../../api/client';
import { friendlyApiError } from '../../lib/application-status';
import { isUiPreviewActive } from '../../lib/ui-preview';

type LeaseRow = {
  id: string;
  listing_id: string;
  listing_label: string;
  application_id: string | null;
  original_filename: string;
  created_at: string;
};

/** Home Provider lease documents overview — `#/landlord/leases`. */
export function LandlordLeasesPage() {
  const [rows, setRows] = useState<LeaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      if (isUiPreviewActive()) {
        setRows([]);
        return;
      }
      if (!getSessionToken()) throw new Error('Sign in required');
      const listings = await api.landlordListings();
      const all: LeaseRow[] = [];
      for (const listing of listings.listings) {
        try {
          const res = await api.listListingLeases(listing.id);
          for (const lease of res.leases) {
            all.push({
              id: lease.id,
              listing_id: listing.id,
              listing_label: listing.line1 || listing.city || listing.id,
              application_id: lease.application_id,
              original_filename: lease.original_filename,
              created_at: lease.created_at,
            });
          }
        } catch {
          /* skip listing without lease access */
        }
      }
      setRows(all);
    } catch (err) {
      setError(friendlyApiError(err instanceof ApiError ? err.message : 'Could not load leases.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <LandlordShell>
      <h1 className="text-2xl font-semibold">Leases</h1>
      <p className="mt-1 text-sm text-dwel-muted">
        Uploaded lease documents across your listings. Upload from an approved applicant workspace.
        [PLACEHOLDER] counsel lease templates not included.
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

      {!loading && !error && rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No lease documents yet"
            body="After you approve an applicant, upload the lease from their detail page."
          />
        </div>
      ) : null}

      {!loading && rows.length > 0 ? (
        <div className="mt-6 space-y-3">
          {rows.map((r) => (
            <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-semibold">{r.original_filename}</p>
                <p className="mt-1 text-sm text-dwel-muted">
                  {r.listing_label}
                  {r.application_id ? (
                    <>
                      {' · '}
                      <Link
                        href={`/landlord/applicants/${r.application_id}`}
                        className="font-semibold underline"
                      >
                        Applicant
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
              <span className="text-xs text-dwel-muted">
                {new Date(r.created_at).toLocaleString()}
              </span>
            </Card>
          ))}
        </div>
      ) : null}
    </LandlordShell>
  );
}
