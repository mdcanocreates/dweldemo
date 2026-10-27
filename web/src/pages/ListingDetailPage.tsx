import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type Listing } from '../api';
import { InlineSpinner } from '../components/FrogPageLoader';
import { ErrorState, Shell } from '../components/Shell';
import { formatAddress, formatBedsBaths, moneyFromCents, titleCaseType } from '../format';
import { track } from '../lib/analytics';
import { useDelayedPending } from '../hooks/useDelayedPending';

export function ListingDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const showInline = useDelayedPending(loading && !listing && !error, 400);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const data = await api.getListing(id);
        if (!cancelled) {
          setListing(data.listing);
          setError(null);
          track('listing_viewed', {
            product: 'dwel',
            property_type: data.listing.property_type || 'unknown',
            bedrooms: data.listing.bedrooms ?? 0,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Listing unavailable');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error && !listing) {
    return (
      <Shell>
        <ErrorState title="Listing unavailable">{error}</ErrorState>
        <Link to="/listings">Back to homes</Link>
      </Shell>
    );
  }

  if (!listing) {
    return <Shell>{showInline ? <InlineSpinner label="Loading this home…" /> : null}</Shell>;
  }

  const title = formatAddress(listing);
  const hero = listing.media?.[0]?.url;

  return (
    <Shell>
      <Link to="/listings" style={{ fontWeight: 700, color: 'hsl(var(--muted-foreground))' }}>
        ← Back to homes
      </Link>
      <div
        style={{
          marginTop: '1rem',
          borderRadius: '1.5rem',
          overflow: 'hidden',
          background: 'hsl(var(--muted))',
          minHeight: '16rem',
        }}
      >
        {hero ? (
          <img src={hero} alt={title} style={{ width: '100%', maxHeight: '28rem', objectFit: 'cover' }} />
        ) : null}
      </div>

      <div
        style={{
          display: 'grid',
          gap: '1.5rem',
          marginTop: '1.5rem',
          gridTemplateColumns: '1fr minmax(16rem, 20rem)',
        }}
      >
        <div>
          <p className="section-eyebrow">
            {listing.property_type ? titleCaseType(listing.property_type) : 'Home'} ·{' '}
            {listing.address.city}
          </p>
          <h1 className="section-title">{title}</h1>
          <p style={{ fontSize: '1.35rem', fontFamily: 'var(--font-d)', fontWeight: 700 }}>
            {moneyFromCents(listing.rent_amount_cents)}
            <span style={{ fontSize: '0.95rem', color: 'hsl(var(--muted-foreground))' }}>/mo</span>
          </p>
          <p style={{ color: 'hsl(var(--muted-foreground))' }}>
            {formatBedsBaths(listing.bedrooms, listing.bathrooms)}
          </p>
          {listing.available_on && (
            <p style={{ color: 'hsl(var(--muted-foreground))' }}>Available {listing.available_on}</p>
          )}
          {listing.description && (
            <p style={{ marginTop: '1rem', maxWidth: '40rem' }}>{listing.description}</p>
          )}
        </div>

        <aside className="card" style={{ padding: '1.25rem', alignSelf: 'start' }}>
          <p className="section-eyebrow">Interest</p>
          <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
            Estimated cashback {moneyFromCents(listing.cashback_cents ?? 0)}.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '0.75rem' }}
            onClick={() => navigate(`/apply/${id}`)}
          >
            I&apos;m interested
          </button>
          <Link
            to="/applications"
            style={{ display: 'inline-block', marginTop: '0.85rem', fontWeight: 700 }}
          >
            View applications →
          </Link>
        </aside>
      </div>
    </Shell>
  );
}
