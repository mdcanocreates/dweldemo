import { Link } from 'react-router-dom';
import type { Listing } from '../../api';
import {
  formatAddress,
  formatBedsBaths,
  formatListedRent,
  hasListedRent,
  titleCaseType,
} from '../../format';
import { isDirectoryListing } from '../../lib/publicInventory';
import { HeartButton } from './HeartButton';
import { ListingMedia } from './ListingMedia';

export function ListingCard({
  listing,
  selected,
  onSelect,
  compact = false,
}: {
  listing: Listing;
  selected: boolean;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  if (isDirectoryListing(listing)) {
    return (
      <DirectoryCard listing={listing} selected={selected} onSelect={onSelect} compact={compact} />
    );
  }
  return <RentalCard listing={listing} selected={selected} onSelect={onSelect} compact={compact} />;
}

function RentalCard({
  listing,
  selected,
  onSelect,
  compact,
}: {
  listing: Listing;
  selected: boolean;
  onSelect: (id: string) => void;
  compact: boolean;
}) {
  const title = listing.property_name?.trim() || formatAddress(listing);
  const img = listing.media?.[0]?.url ?? null;
  const offer = listing.offers?.[0] ?? null;
  const city = [listing.address.city, listing.address.state].filter(Boolean).join(', ');
  const addressLine = [listing.address.line1, city].filter(Boolean).join(' · ');
  const rentLabel = formatListedRent(listing.rent_amount_cents, listing.rent_max_cents);
  const layout = formatBedsBaths(listing.bedrooms, listing.bathrooms);

  return (
    <article
      id={`listing-card-${listing.id}`}
      className={
        selected
          ? `landing-card is-selected${img ? '' : ' landing-card--text'}`
          : `landing-card${img ? '' : ' landing-card--text'}`
      }
      data-testid={`card-listing-${listing.id}`}
      data-inventory-kind={listing.inventory_kind === 'external' ? 'external' : 'rental'}
    >
      <div className="dwel-card-media-wrap">
        <button type="button" className="dwel-listing-select" onClick={() => onSelect(listing.id)}>
          {img ? (
            <ListingMedia
              title={title}
              imageUrl={img}
              compact={compact}
              kind="rental"
              badge={offer?.display_text ?? null}
            />
          ) : (
            <div className={`landing-card-media landing-card-media--empty${compact ? ' landing-card-media--compact' : ''}`}>
              <span className="landing-card-media-empty-label">{titleCaseType(listing.property_type) ?? 'Home'}</span>
              {offer?.display_text ? (
                <span className="landing-card-cash landing-card-cash--mint">{offer.display_text}</span>
              ) : null}
            </div>
          )}
        </button>
        <HeartButton listing={listing} className="dwel-heart--overlay" />
      </div>
      <button type="button" className="dwel-listing-select" onClick={() => onSelect(listing.id)}>
        <div className="landing-card-body">
          <p className="landing-card-meta">
            {titleCaseType(listing.property_type) ?? 'Home'}
            {listing.bedrooms != null ? ` · ${layout}` : ''}
          </p>
          <p className="landing-card-title font-display">{title}</p>
          <p className="landing-card-place">{addressLine || city}</p>
          <div className="landing-card-row">
            <span className="landing-card-rent font-mono">{rentLabel}</span>
          </div>
          {offer?.display_text ? (
            <p className="dwel-incentive-badge">
              <span className="dwel-incentive-badge__tag">Move-in special</span>
              <span className="dwel-incentive-badge__headline font-display">{offer.display_text}</span>
            </p>
          ) : null}
        </div>
      </button>
      <div className="landing-card-actions">
        <Link className="dwel-listing-open" to={`/listings/${listing.id}`}>
          View listing →
        </Link>
        {!hasListedRent(listing.rent_amount_cents) ? (
          <Link className="dwel-listing-open dwel-listing-open--secondary" to={`/listings/${listing.id}`}>
            Request information
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function DirectoryCard({
  listing,
  selected,
  onSelect,
  compact,
}: {
  listing: Listing;
  selected: boolean;
  onSelect: (id: string) => void;
  compact: boolean;
}) {
  const title = listing.property_name?.trim() || formatAddress(listing);
  const city = [listing.address.city, listing.address.state].filter(Boolean).join(', ');
  const addressLine = [listing.address.line1, city].filter(Boolean).join(', ');

  return (
    <article
      id={`listing-card-${listing.id}`}
      className={
        selected
          ? 'landing-card landing-card--directory landing-card--text is-selected'
          : 'landing-card landing-card--directory landing-card--text'
      }
      data-testid={`card-listing-${listing.id}`}
      data-inventory-kind="directory"
      data-compact={compact ? 'true' : 'false'}
    >
      <button type="button" className="dwel-listing-select" onClick={() => onSelect(listing.id)}>
        <div className="landing-card-body">
          <div className="landing-card-row">
            <p className="landing-card-meta">Affordable housing directory</p>
            <HeartButton listing={listing} />
          </div>
          <p className="landing-card-title font-display">{title}</p>
          <p className="landing-card-place">{addressLine}</p>
          <div className="landing-card-row">
            <span>Income-based · availability not confirmed</span>
          </div>
        </div>
      </button>
      <Link className="dwel-listing-open" to={`/listings/${listing.id}`}>
        View property →
      </Link>
    </article>
  );
}
