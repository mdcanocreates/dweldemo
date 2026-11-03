import { useState } from 'react';

type Props = {
  title: string;
  imageUrl?: string | null;
  compact?: boolean;
  kind: 'rental' | 'directory' | 'profile';
  badge?: string | null;
};

/** Renders a real property photo. No striped placeholder when the photo is missing. */
export function ListingMedia({ title, imageUrl, compact = false, kind, badge }: Props) {
  const [failed, setFailed] = useState(false);
  if (!imageUrl || failed) return null;
  return (
    <div
      className={['landing-card-media', compact ? 'landing-card-media--compact' : '', kind === 'directory' ? 'landing-card-media--directory' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <img
        src={imageUrl}
        alt={title}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
      {badge ? <span className="landing-card-cash">{badge}</span> : null}
    </div>
  );
}
