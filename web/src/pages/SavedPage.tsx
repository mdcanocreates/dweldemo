import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type Listing } from '../api';
import { useAuth } from '../auth';
import { ListingCard } from '../components/listings/ListingCard';
import { SaveFeedbackToast } from '../components/listings/SaveFeedbackToast';
import { InlineSpinner } from '../components/FrogPageLoader';
import { ErrorState, Shell } from '../components/Shell';
import { useDelayedPending } from '../hooks/useDelayedPending';
import { useSavedHomesContext } from '../savedHomes';

export function SavedPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const {
    savedIds,
    savedCount,
    saveFeedback,
    dismissSaveFeedback,
    estimate,
    dwelFeeCents,
    refreshing,
  } = useSavedHomesContext();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [unavailableIds, setUnavailableIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const idsKey = [...savedIds].sort().join(',');
  const showSpinner = useDelayedPending(
    loading || refreshing || (savedCount > 0 && listings === null && !error),
    400,
  );

  useEffect(() => {
    let cancelled = false;
    const ids = [...savedIds];
    if (ids.length === 0) {
      setListings([]);
      setUnavailableIds([]);
      setError(null);
      return;
    }
    setListings(null);
    void (async () => {
      try {
        const results = await Promise.all(
          ids.map(async (id) => {
            try {
              const data = await api.getListing(id);
              return { id, listing: data.listing as Listing };
            } catch {
              return { id, listing: null };
            }
          }),
        );
        if (cancelled) return;
        const found: Listing[] = [];
        const missing: string[] = [];
        for (const row of results) {
          if (row.listing) found.push(row.listing);
          else missing.push(row.id);
        }
        setListings(found);
        setUnavailableIds(missing);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Saved homes could not be loaded.');
          setListings([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idsKey, savedIds]);

  return (
    <Shell>
      <h1 className="section-title">Saved</h1>
      <p className="muted" data-testid="saved-count-label">
        {loading
          ? 'Checking sign-in…'
          : user
            ? `${savedCount} saved home${savedCount === 1 ? '' : 's'} synced to your account`
            : `${savedCount} saved home${savedCount === 1 ? '' : 's'} on this device`}
      </p>

      {!loading && !user && (
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          Sign in to keep saved homes across devices.{' '}
          <Link to="/sign-in?next=/saved">Sign in →</Link>
        </p>
      )}

      {saveFeedback && (
        <div style={{ marginTop: '1rem', maxWidth: '28rem' }}>
          <SaveFeedbackToast feedback={saveFeedback} onDismiss={dismissSaveFeedback} />
        </div>
      )}
      {!saveFeedback && estimate?.completeEstimate && (
        <p className="muted" style={{ marginTop: '0.75rem' }} data-testid="saved-estimate-readonly">
          Estimated application savings {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(estimate.estimatedSavingsCents / 100)} across {estimate.eligibleHomes} eligible {estimate.eligibleHomes === 1 ? 'home' : 'homes'} after one ${(dwelFeeCents / 100).toFixed(0)} Dwel application. Not money already saved.
        </p>
      )}

      {error && <ErrorState title="Saved homes unavailable">{error}</ErrorState>}
      {showSpinner ? <InlineSpinner label="Loading saved homes…" /> : null}

      {!error && listings && listings.length === 0 && unavailableIds.length === 0 && (
        <div className="panel stack" style={{ maxWidth: '32rem', marginTop: '1.25rem' }}>
          <p>You have not saved a home yet.</p>
          <Link className="btn btn-primary" to="/listings">
            Browse homes
          </Link>
        </div>
      )}

      {listings && listings.length > 0 && (
        <div className="landing-grid" style={{ marginTop: '1.25rem' }} data-testid="saved-homes-grid">
          {listings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              selected={false}
              onSelect={(id) => navigate(`/listings/${id}`)}
            />
          ))}
        </div>
      )}

      {unavailableIds.length > 0 && (
        <ul className="stack" style={{ marginTop: '1.25rem' }} data-testid="saved-unavailable">
          {unavailableIds.map((id) => (
            <li key={id}>
              <span>Saved home no longer available</span>
              <Link to={`/listings/${id}`} style={{ marginLeft: '0.5rem' }}>
                View details
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
