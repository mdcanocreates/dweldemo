import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type SavedListing } from '../api';
import { useAuth } from '../auth';
import { InlineSpinner } from '../components/FrogPageLoader';
import { ErrorState, Shell } from '../components/Shell';
import { useDelayedPending } from '../hooks/useDelayedPending';

export function SavedPage() {
  const { user, loading } = useAuth();
  const [saved, setSaved] = useState<SavedListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showSpinner = useDelayedPending(loading || (Boolean(user) && saved === null && !error), 400);

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    void api
      .savedListings()
      .then((res) => {
        if (!cancelled) setSaved(res.saved);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Saved homes could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [loading, user]);

  return (
    <Shell>
      <h1 className="section-title">Saved</h1>
      {loading && (showSpinner ? <InlineSpinner label="Checking sign-in…" /> : null)}
      {!loading && !user && (
        <div className="panel stack" style={{ maxWidth: '32rem' }}>
          <p>Sign in to see homes you have saved.</p>
          <Link className="btn btn-primary" to="/sign-in?next=/saved">
            Sign in
          </Link>
        </div>
      )}
      {error && <ErrorState title="Saved homes unavailable">{error}</ErrorState>}
      {user && !error && saved === null && (showSpinner ? <InlineSpinner label="Loading saved homes…" /> : null)}
      {saved && saved.length === 0 && <p className="muted">You have not saved a home yet.</p>}
      {saved && saved.length > 0 && (
        <ul className="stack">
          {saved.map((item) => (
            <li key={item.listing_id}>
              <Link to={`/listings/${item.listing_id}`}>
                {[item.address_line1, item.city, item.state].filter(Boolean).join(', ') || 'Saved home'}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
