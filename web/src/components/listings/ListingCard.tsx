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
  if (listing.inventory_kind === 'external' || !listing.rent_amount_cents) {
    return (
      <ProfileCard listing={listing} selected={selected} onSelect={onSelect} compact={compact} />
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
      className={selected ? `landing-card is-selected${img ? '' : ' landing-card--text'}` : `landing-card${img ? '' : ' landing-card--text'}`}
      data-testid={`card-listing-${listing.id}`}
      data-inventory-kind="rental"
    >
      {img ? (
        <div className="dwel-card-media-wrap">
          <button type="button" className="dwel-listing-select" onClick={() => onSelect(listing.id)}>
            <ListingMedia title={title} imageUrl={img} compact={compact} kind="rental" badge={offer} />
          </button>
          <HeartButton listing={listing} className="dwel-heart--overlay" />
        </div>
      ) : null}
      <button type="button" className="dwel-listing-select" onClick={() => onSelect(listing.id)}>
        <div className="landing-card-body">
          <div className="landing-card-row">
            <p className="landing-card-meta">
              {titleCaseType(listing.property_type) ?? 'Home'}
              {listing.bedrooms != null ? ` · ${formatBedsBaths(listing.bedrooms, listing.bathrooms)}` : ''}
            </p>
            {img ? null : <HeartButton listing={listing} />}
          </div>
          <p className="landing-card-title">{title}</p>
          <p className="landing-card-place">{addressLine || city}</p>
          <div className="landing-card-row">
            <span>{moneyFromCents(listing.rent_amount_cents)}/mo</span>
          </div>
          <p className="dwel-offer-disclaimer">{availability}</p>
          {offer ? (
            <p className="dwel-offer-disclaimer">Offer advertised by property; terms apply.</p>
          ) : null}
          {!listing.reusable_application_eligible ? (
            <p className="dwel-offer-disclaimer">Provider has not accepted Dwel applications yet.</p>
          ) : null}
        </div>
      </button>
      <Link className="dwel-listing-open" to={`/listings/${listing.id}`}>
        View home →
      </Link>
    </article>
  );
}

/** External deal / unconfirmed market profile — text-first, inquiry only. */
function ProfileCard({
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
  const city = [listing.address.city, listing.address.state].filter(Boolean).join(', ');
  const addressLine = [listing.address.line1, city].filter(Boolean).join(', ');

  return (
    <article
      id={`listing-card-${listing.id}`}
      className={
        selected
          ? `landing-card landing-card--profile is-selected${img ? '' : ' landing-card--text'}`
          : `landing-card landing-card--profile${img ? '' : ' landing-card--text'}`
      }
      data-testid={`card-listing-${listing.id}`}
      data-inventory-kind="external"
    >
      {img ? (
        <div className="dwel-card-media-wrap">
          <button type="button" className="dwel-listing-select" onClick={() => onSelect(listing.id)}>
            <ListingMedia title={title} imageUrl={img} compact={compact} kind="profile" badge="Inquire" />
          </button>
          <HeartButton listing={listing} className="dwel-heart--overlay" />
        </div>
      ) : null}
      <button type="button" className="dwel-listing-select" onClick={() => onSelect(listing.id)}>
        <div className="landing-card-body">
          <div className="landing-card-row">
            <p className="landing-card-meta">
              Property profile
              {listing.property_type ? ` · ${titleCaseType(listing.property_type)}` : ''}
              {listing.bedrooms != null ? ` · ${formatBedsBaths(listing.bedrooms, listing.bathrooms)}` : ''}
            </p>
            {img ? null : <HeartButton listing={listing} />}
          </div>
          <p className="landing-card-title">{title}</p>
          <p className="landing-card-place">{addressLine}</p>
          <div className="landing-card-row">
            <span>Inquire about availability</span>
          </div>
          <p className="dwel-offer-disclaimer">
            Factual property profile. Rent, specials, and vacancy are not confirmed on Dwel until the leasing
            office claims this listing.
          </p>
        </div>
      </button>
      <Link className="dwel-listing-open" to={`/listings/${listing.id}`}>
        View property →
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
