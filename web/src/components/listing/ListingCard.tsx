import { useState } from 'react';
import { Link } from 'wouter';
import type { Listing } from '../../types';
import { formatCents } from '../../lib/money';
import { bedLabel } from '../../lib/listings';
import { LISTING_IMAGE_PLACEHOLDER, listingPhotoSrc } from '../../lib/listing-image';
import { CashbackBadge } from './CashbackBadge';
import { useSavedListings } from '../../hooks/useSavedListings';

type Props = {
  listing: Listing;
};

/**
 * Browse card — shopping surface only (design3.md).
 * No Contact / Book a tour. CTA: View home. Entire card navigates.
 * Cashback badge uses real API cashback_cents only (never invented).
 */
export function ListingCard({ listing }: Props) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const [broken, setBroken] = useState<Record<number, boolean>>({});
  const { isSaved, toggle, toast } = useSavedListings();
  const photos = listing.photos.length ? listing.photos : [LISTING_IMAGE_PLACEHOLDER];
  const idx = photoIdx % photos.length;
  const photo = broken[idx] ? LISTING_IMAGE_PLACEHOLDER : listingPhotoSrc(photos[idx]);
  const href = `/listing/${listing.id}`;

  return (
    <article className="overflow-hidden rounded-[16px] border border-dwel-line bg-dwel-surface transition hover:border-dwel-gray-400">
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 max-w-sm -translate-x-1/2 rounded-full border border-dwel-line bg-dwel-surface px-4 py-2 text-center text-sm shadow-lg">
          {toast}
        </div>
      )}
      <div className="relative aspect-[4/3] bg-dwel-surface2">
        <Link href={href} className="block h-full w-full">
          <img
            src={photo}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setBroken((b) => ({ ...b, [idx]: true }))}
          />
        </Link>

        <CashbackBadge
          cashbackCents={listing.cashback_cents}
          className="absolute left-[12px] top-[12px] max-w-[calc(100%-5.5rem)] truncate"
        />

        <button
          type="button"
          aria-pressed={isSaved(listing.id)}
          aria-label={
            isSaved(listing.id)
              ? `Remove ${listing.property_name} from saved`
              : `Save ${listing.property_name}`
          }
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggle(listing.id);
          }}
          className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-dwel-white/95 text-lg shadow-sm outline-none ring-dwel-ink focus-visible:ring-2"
        >
          <span aria-hidden className={isSaved(listing.id) ? 'text-dwel-red' : 'text-dwel-gray-700'}>
            {isSaved(listing.id) ? '♥' : '♡'}
          </span>
        </button>

        {photos.length > 1 && (
          <>
            <span className="absolute bottom-3 right-3 z-[2] rounded-full bg-dwel-ink/70 px-2 py-0.5 text-xs text-white">
              {photos.length} photos
            </span>
            <div className="absolute inset-y-0 left-0 z-[1] flex items-center">
              <button
                type="button"
                aria-label="Previous photo"
                className="m-2 flex h-8 w-8 items-center justify-center rounded-full bg-dwel-white/90 text-sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPhotoIdx((i) => (i - 1 + photos.length) % photos.length);
                }}
              >
                ‹
              </button>
            </div>
            <div className="absolute inset-y-0 right-0 z-[1] flex items-center">
              <button
                type="button"
                aria-label="Next photo"
                className="m-2 flex h-8 w-8 items-center justify-center rounded-full bg-dwel-white/90 text-sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPhotoIdx((i) => (i + 1) % photos.length);
                }}
              >
                ›
              </button>
            </div>
          </>
        )}
      </div>

      <Link href={href} className="block space-y-3 p-4 text-dwel-ink no-underline">
        <div className="flex flex-wrap gap-2 text-xs text-dwel-muted">
          {listing.specials_count > 0 && (
            <span className="rounded-full bg-dwel-surface2 px-2 py-1">
              {listing.specials_count} special{listing.specials_count === 1 ? '' : 's'}
            </span>
          )}
          {listing.pet_friendly && (
            <span className="rounded-full bg-dwel-surface2 px-2 py-1">Pet friendly</span>
          )}
          {listing.parking && (
            <span className="rounded-full bg-dwel-surface2 px-2 py-1">Parking</span>
          )}
          <span className="rounded-full bg-dwel-surface2 px-2 py-1">{bedLabel(listing.beds)}</span>
        </div>

        <div>
          <p className="text-base font-semibold">{listing.property_name}</p>
          <p className="mt-1 text-sm text-dwel-muted">
            {listing.neighborhood ?? listing.city}
          </p>
          {listing.lease_months != null && (
            <p className="mt-0.5 text-sm text-dwel-muted">{listing.lease_months}-mo lease</p>
          )}
        </div>

        <div className="flex items-baseline justify-between">
          <span className="text-lg font-semibold">{formatCents(listing.rent_cents)}/mo</span>
          <span className="text-sm font-semibold underline underline-offset-2">View home →</span>
        </div>
      </Link>
    </article>
  );
}
