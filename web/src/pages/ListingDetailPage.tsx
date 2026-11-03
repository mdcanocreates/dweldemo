import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type Listing, type RenterApplicationSummary } from '../api';
import { useAuth } from '../auth';
import { HeartButton } from '../components/listings/HeartButton';
import { ListingMedia } from '../components/listings/ListingMedia';
import { applicationStatusLabel } from '../lib/application-status';
import { InlineSpinner } from '../components/FrogPageLoader';
import { ErrorState, Shell } from '../components/Shell';
import { formatAddress, formatBedsBaths, moneyFromCents, titleCaseType } from '../format';
import { track } from '../lib/analytics';
import { useDelayedPending } from '../hooks/useDelayedPending';
import { isDirectoryListing } from '../lib/publicInventory';
import { useSavedHomesContext } from '../savedHomes';

const TERMINAL_STATUS = new Set(['declined', 'withdrawn', 'closed']);

export function ListingDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toggleSave, isSaved } = useSavedHomesContext();
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

  const directory = isDirectoryListing(listing);
  const title = listing.property_name?.trim() || formatAddress(listing);
  const media = listing.media?.filter((item) => item.url) ?? [];
  const hero = media[photoIndex]?.url ?? media[0]?.url;

  async function saveHome() {
    setSavedNote(null);
    const wasSaved = isSaved(listing!.id);
    try {
      await toggleSave(listing!);
      if (wasSaved) {
        setSavedNote('Removed from saved homes. The savings estimate updates automatically.');
      } else if (user) {
        setSavedNote('Saved to your account.');
      } else {
        setSavedNote('Saved on this device. Sign in to sync across devices.');
      }
    } catch (err) {
      setSavedNote(err instanceof ApiError ? err.message : 'Could not update saved homes.');
    }
  }

  async function requestInfo() {
    setSavedNote(null);
    try {
      const result = await api.createListingInquiry({
        listing_id: listing!.id,
        requested_action: 'request_information',
        consent_version: 'listing_inquiry_v1',
        contact_share_scope: ['name', 'email', 'phone'],
        idempotency_key: `inq-${listing!.id}-${Date.now()}`,
      });
      setSavedNote(
        result.notification.transport === 'mock'
          ? 'Request recorded. Leasing-office delivery stays mocked until outreach is authorized.'
          : 'Request submitted.',
      );
    } catch (err) {
      setSavedNote(err instanceof ApiError ? err.message : 'Could not send this request.');
    }
  }

  return (
    <Shell>
      <Link to="/listings" style={{ fontWeight: 700, color: 'hsl(var(--muted-foreground))' }}>
        ← Back to homes
      </Link>
      <div className="dwel-detail-hero">
        {hero ? (
          <img src={hero} alt={title} loading="eager" />
        ) : (
          <ListingMedia title={title} imageUrl={null} kind={directory ? 'directory' : 'rental'} />
        )}
        <HeartButton listing={listing} className="dwel-heart--overlay dwel-heart--detail" />
      </div>
      {media.length > 1 && (
        <div className="dwel-detail-gallery" data-testid="listing-gallery">
          {media.map((item, index) => (
            <button
              key={item.url}
              type="button"
              className={photoIndex === index ? 'is-active' : undefined}
              aria-label={`Photo ${index + 1}`}
              onClick={() => setPhotoIndex(index)}
            >
              <img src={item.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <div className="dwel-detail-layout">
        <div>
          <p className="section-eyebrow">
            {directory
              ? 'Affordable housing directory'
              : listing.property_type
                ? titleCaseType(listing.property_type)
                : 'Home'}{' '}
            · {listing.address.city}
          </p>
          <h1 className="section-title">{title}</h1>
          <p className="dwel-detail-address">
            {[listing.address.line1, listing.address.city, listing.address.state, listing.address.postal_code]
              .filter(Boolean)
              .join(', ')}
          </p>
          {directory ? (
            <p className="dwel-detail-rent">Income-based · availability not confirmed</p>
          ) : (
            <p className="dwel-detail-rent">
              {moneyFromCents(listing.rent_amount_cents)}
              <span>/mo</span>
            </p>
          )}
          {!directory && listing.bedrooms != null && (
            <p style={{ color: 'hsl(var(--muted-foreground))' }}>
              {formatBedsBaths(listing.bedrooms, listing.bathrooms)}
            </p>
          )}
          {!directory && listing.available_on && (
            <p style={{ color: 'hsl(var(--muted-foreground))' }}>Available {listing.available_on}</p>
          )}
          {listing.description && (
            <p style={{ marginTop: '1rem', maxWidth: '40rem' }}>{listing.description}</p>
          )}
        </div>

        <aside className="card dwel-detail-aside">
          <p className="section-eyebrow">Next step</p>
          {directory ? (
            <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
              Directory entry only. Saving does not contact the property or confirm vacancy.
            </p>
          ) : listing.offers?.[0] ? (
            <>
              <p style={{ fontWeight: 700 }}>{listing.offers[0].display_text}</p>
              <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.85rem' }}>
                {listing.offers[0].qualifier_text ?? 'Offer advertised by property; terms apply.'}
              </p>
            </>
          ) : (
            <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.9rem' }}>
              {listing.listing_channel ?? 'Partner listing'}. Saving does not contact the leasing office.
            </p>
          )}
          {applicationLookup === 'failed' && !directory && (
            <p>
              Could not check whether you already applied. Submitting again reuses an open
              application for this home instead of creating a second one.
            </p>
          )}
          <button
            type="button"
            className="btn btn-outline"
            style={{ width: '100%', marginTop: '0.75rem' }}
            onClick={() => void saveHome()}
          >
            {isSaved(listing.id) ? 'Remove from saved' : 'Save this home'}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            style={{ width: '100%', marginTop: '0.5rem' }}
            onClick={() => void requestInfo()}
          >
            Request information
          </button>
          {savedNote && <p>{savedNote}</p>}
          {!directory && existing ? (
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
          ) : !directory ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '0.75rem' }}
              onClick={() => navigate(`/apply/${id}`)}
            >
              Start application
            </button>
          ) : null}
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
