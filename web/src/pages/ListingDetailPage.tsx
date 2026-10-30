import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type Listing, type RenterApplicationSummary } from '../api';
import { useAuth } from '../auth';
import { applicationStatusLabel } from '../lib/application-status';
import { InlineSpinner } from '../components/FrogPageLoader';
import { ErrorState, Shell } from '../components/Shell';
import { formatAddress, formatBedsBaths, moneyFromCents, titleCaseType } from '../format';
import { track } from '../lib/analytics';
import { useDelayedPending } from '../hooks/useDelayedPending';

const TERMINAL_STATUS = new Set(['declined', 'withdrawn', 'closed']);

export function ListingDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [listing, setListing] = useState<Listing | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [existing, setExisting] = useState<RenterApplicationSummary | null>(null);
  const [applicationLookup, setApplicationLookup] = useState<'idle' | 'ok' | 'failed'>('idle');
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

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setExisting(null);
      setApplicationLookup('ok');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await api.listMyApplications();
        if (cancelled) return;
        const match =
          data.applications.find(
            (app) => app.listing_id === id && !TERMINAL_STATUS.has(app.status),
          ) ?? null;
        setExisting(match);
        setApplicationLookup('ok');
      } catch {
        if (!cancelled) {
          setExisting(null);
          setApplicationLookup('failed');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, id]);

  if (error && !listing) {
    const unavailable = error.toLowerCase().includes('not found') || error.toLowerCase().includes('unavailable');
    return (
      <Shell>
        <ErrorState title={unavailable ? 'This home is no longer available' : 'Listing unavailable'}>
          {unavailable
            ? 'It is not in the public catalog. An application you already submitted stays on your tracker.'
            : error}
        </ErrorState>
        <Link to="/listings">Back to homes</Link>
        {existing && (
          <p>
            <Link to={`/applications/${existing.application_id}/details`}>View your application</Link>
          </p>
        )}
      </Shell>
    );
  }

  if (!listing) {
    return <Shell>{showInline ? <InlineSpinner label="Loading this home…" /> : null}</Shell>;
  }

  const title = formatAddress(listing);
  const media = listing.media?.filter((item) => item.url) ?? [];
  const hero = media[photoIndex]?.url ?? media[0]?.url;

  async function saveHome() {
    setSavedNote(null);
    try {
      await api.saveListing(listing!.id);
      setSavedNote('Saved to your account.');
    } catch (err) {
      setSavedNote(err instanceof ApiError ? err.message : 'Could not save this home.');
    }
  }

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
      {media.length > 1 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }} data-testid="listing-gallery">
          {media.map((item, index) => (
            <button
              key={item.url}
              type="button"
              className="btn btn-outline"
              aria-label={`Photo ${index + 1}`}
              onClick={() => setPhotoIndex(index)}
            >
              {index + 1}
            </button>
          ))}
        </div>
      )}

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
          {applicationLookup === 'failed' && (
            <p>
              Could not check whether you already applied. Submitting again reuses an open
              application for this home instead of creating a second one.
            </p>
          )}
          {user && (
            <button
              type="button"
              className="btn btn-outline"
              style={{ width: '100%', marginTop: '0.75rem' }}
              onClick={() => void saveHome()}
            >
              Save this home
            </button>
          )}
          {savedNote && <p>{savedNote}</p>}
          {existing ? (
            <>
              <p style={{ fontWeight: 700 }}>
                You applied.{' '}
                {existing.progress?.status_label ?? applicationStatusLabel(existing.status)}
              </p>
              {existing.progress?.next_step && <p>{existing.progress.next_step}</p>}
              <Link
                className="btn btn-primary"
                style={{ width: '100%', marginTop: '0.75rem' }}
                to={`/applications/${existing.application_id}/details`}
              >
                View your application
              </Link>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '0.75rem' }}
              onClick={() => navigate(`/apply/${id}`)}
            >
              I&apos;m interested
            </button>
          )}
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
