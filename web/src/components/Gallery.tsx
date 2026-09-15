import { useState } from 'react';

export function ListingGallery({
  media,
  label,
}: {
  media?: Array<{ url: string }> | null;
  label: string;
}) {
  const images = (media ?? []).filter((m) => m.url);
  const [idx, setIdx] = useState(0);

  if (images.length === 0) {
    return (
      <div className="gallery-main media-frame" role="img" aria-label={`${label} — photo coming soon`}>
        <div className="media-fallback">Photos coming soon</div>
      </div>
    );
  }

  const current = images[Math.min(idx, images.length - 1)]!;

  return (
    <div className="gallery">
      <div className="gallery-main">
        <img src={current.url} alt={label} loading="eager" />
      </div>
      {images.length > 1 && (
        <div className="gallery-thumbs" role="list">
          {images.map((img, i) => (
            <button
              key={`${img.url}-${i}`}
              type="button"
              role="listitem"
              aria-label={`Photo ${i + 1}`}
              aria-current={i === idx ? 'true' : undefined}
              onClick={() => setIdx(i)}
            >
              <img src={img.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ListingThumb({
  media,
  label,
}: {
  media?: Array<{ url: string }> | null;
  label: string;
}) {
  const first = media?.find((m) => m.url)?.url;
  return (
    <div className="media-frame">
      {first ? (
        <img src={first} alt={label} loading="lazy" />
      ) : (
        <div className="media-fallback">Photos coming soon</div>
      )}
    </div>
  );
}
