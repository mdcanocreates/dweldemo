import { useState } from 'react';
import { LISTING_IMAGE_PLACEHOLDER, listingPhotoSrc } from '../../lib/listing-image';
import { CashbackBadge } from './CashbackBadge';

type Props = {
  photos: string[];
  alt?: string;
  /** Real listing cashback only — badge hidden when absent. */
  cashbackCents?: number | null;
};

export function PhotoGallery({ photos, alt = 'Listing photo', cashbackCents }: Props) {
  const [idx, setIdx] = useState(0);
  const [broken, setBroken] = useState<Record<number, boolean>>({});
  const list = photos.length > 0 ? photos : [LISTING_IMAGE_PLACEHOLDER];
  const safeIdx = idx % list.length;
  const src = broken[safeIdx] ? LISTING_IMAGE_PLACEHOLDER : listingPhotoSrc(list[safeIdx]);

  return (
    <div>
      <div className="relative aspect-[16/10] overflow-hidden rounded-[10px] bg-dwel-gray-200">
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-cover"
          onError={() => setBroken((b) => ({ ...b, [safeIdx]: true }))}
        />
        <CashbackBadge
          cashbackCents={cashbackCents}
          className="absolute left-[12px] top-[12px] max-w-[calc(100%-5.5rem)] truncate"
        />
        <span className="absolute bottom-3 right-3 z-[2] rounded-full bg-dwel-black/70 px-2.5 py-1 text-xs text-white">
          {list.length} photos
        </span>
        {list.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous"
              className="absolute left-3 top-1/2 z-[1] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-dwel-white/95"
              onClick={() => setIdx((i) => (i - 1 + list.length) % list.length)}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next"
              className="absolute right-3 top-1/2 z-[1] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-dwel-white/95"
              onClick={() => setIdx((i) => (i + 1) % list.length)}
            >
              ›
            </button>
          </>
        )}
      </div>
      {list.length > 1 && (
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {list.map((thumb, i) => (
            <button
              key={thumb + i}
              type="button"
              onClick={() => setIdx(i)}
              className={`h-16 w-24 shrink-0 overflow-hidden rounded-md border-2 ${
                i === safeIdx ? 'border-dwel-black' : 'border-transparent'
              }`}
            >
              <img
                src={broken[i] ? LISTING_IMAGE_PLACEHOLDER : listingPhotoSrc(thumb)}
                alt=""
                className="h-full w-full object-cover"
                onError={() => setBroken((b) => ({ ...b, [i]: true }))}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
