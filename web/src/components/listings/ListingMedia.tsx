type Props = {
  title: string;
  imageUrl?: string | null;
  compact?: boolean;
  kind: 'rental' | 'directory' | 'profile';
  badge?: string | null;
};

/** Photo-first media with a truthful, non-photographic fallback when no image exists. */
export function ListingMedia({ title, imageUrl, compact = false, kind, badge }: Props) {
  const textFirst = kind === 'directory' || kind === 'profile' || !imageUrl;
  return (
    <div
      className={[
        'landing-card-media',
        compact || textFirst ? 'landing-card-media--compact' : '',
        kind === 'directory' ? 'landing-card-media--directory' : '',
        kind === 'profile' ? 'landing-card-media--profile' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {imageUrl ? (
        <img src={imageUrl} alt={title} loading="lazy" decoding="async" />
      ) : (
        <div
          className={
            kind === 'directory'
              ? 'landing-card-fallback landing-card-fallback--directory'
              : kind === 'profile'
                ? 'landing-card-fallback landing-card-fallback--profile'
                : 'landing-card-fallback'
          }
          role="img"
          aria-label={
            kind === 'directory'
              ? 'No property photo in directory'
              : kind === 'profile'
                ? 'No licensed property photo on file'
                : 'No property photo available'
          }
        >
          <span className="landing-card-fallback__eyebrow">
            {kind === 'directory' ? 'Directory' : kind === 'profile' ? 'Profile' : 'Photo'}
          </span>
          <span className="landing-card-fallback__title">
            {kind === 'directory'
              ? 'No photo on file'
              : kind === 'profile'
                ? 'Photo available after licensed source approval'
                : 'Photo coming when provided by the property'}
          </span>
        </div>
      )}
      {badge ? <span className="landing-card-cash">{badge}</span> : null}
    </div>
  );
}
