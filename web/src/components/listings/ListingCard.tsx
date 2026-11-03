import { Link } from 'react-router-dom';
import type { Listing } from '../../api';
import { formatAddress, formatBedsBaths, moneyFromCents, titleCaseType } from '../../format';
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
  const img = listing.media?.[0]?.url;
  const offer = listing.offers?.[0]?.display_text ?? null;
  const city = [listing.address.city, listing.address.state].filter(Boolean).join(', ');
  const addressLine = [listing.address.line1, city].filter(Boolean).join(' · ');
  const availability =
    listing.available_on != null
      ? `Available ${listing.available_on}`
      : 'Availability confirmed by listing status';

  return (
    <article
      id={`listing-card-${listing.id}`}
      className={selected ? 'landing-card is-selected' : 'landing-card'}
      data-testid={`card-listing-${listing.id}`}
      data-inventory-kind="rental"
    >
      <div className="dwel-card-media-wrap">
        <button type="button" className="dwel-listing-select" onClick={() => onSelect(listing.id)}>
          <ListingMedia title={title} imageUrl={img} compact={compact} kind="rental" badge={offer} />
        </button>
        <HeartButton listing={listing} className="dwel-heart--overlay" />
      </div>
      <button type="button" className="dwel-listing-select" onClick={() => onSelect(listing.id)}>
        <div className="landing-card-body">
          <p className="landing-card-meta">
            {titleCaseType(listing.property_type) ?? 'Home'}
            {listing.bedrooms != null ? ` · ${formatBedsBaths(listing.bedrooms, listing.bathrooms)}` : ''}
          </p>
          <p className="landing-card-title">{title}</p>
          <p className="landing-card-place">{addressLine || city}</p>
          <div className="landing-card-row">
            <span>{moneyFromCents(listing.rent_amount_cents)}/mo</span>
          </div>
          <p className="dwel-offer-disclaimer">{availability}</p>
          {offer ? (
            <p className="dwel-offer-disclaimer">Offer advertised by property; terms apply.</p>
          ) : null}
        </div>
      </button>
      <Link className="dwel-listing-open" to={`/listings/${listing.id}`}>
        View home →
      </Link>
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
          ? 'landing-card landing-card--directory is-selected'
          : 'landing-card landing-card--directory'
      }
      data-testid={`card-listing-${listing.id}`}
      data-inventory-kind="directory"
    >
      <div className="dwel-card-media-wrap">
        <button type="button" className="dwel-listing-select" onClick={() => onSelect(listing.id)}>
          <ListingMedia
            title={title}
            imageUrl={null}
            compact={compact}
            kind="directory"
            badge="Directory"
          />
        </button>
        <HeartButton listing={listing} className="dwel-heart--overlay" />
      </div>
      <button type="button" className="dwel-listing-select" onClick={() => onSelect(listing.id)}>
        <div className="landing-card-body">
          <p className="landing-card-meta">Affordable housing directory</p>
          <p className="landing-card-title">{title}</p>
          <p className="landing-card-place">{addressLine}</p>
          <div className="landing-card-row">
            <span>Income-based · availability not confirmed</span>
          </div>
          <p className="dwel-offer-disclaimer">
            Directory entry only. Contact the property to confirm openings and eligibility. This is not a
            confirmed vacant rental.
          </p>
        </div>
      </button>
      <Link className="dwel-listing-open" to={`/listings/${listing.id}`}>
        View property →
      </Link>
    </article>
  );
}
