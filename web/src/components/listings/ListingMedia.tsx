type Props = {
  title: string;
  imageUrl?: string | null;
  compact?: boolean;
  kind: 'rental' | 'directory';
  badge?: string | null;
};

/** Photo-first media with a truthful, non-photographic fallback when no image exists. */
export function ListingMedia({ title, imageUrl, compact = false, kind, badge }: Props) {
  return (
    <div
      className={
        compact
          ? 'landing-card-media landing-card-media--compact'
          : kind === 'directory'
            ? 'landing-card-media landing-card-media--directory'
            : 'landing-card-media'
      }
    >
      {imageUrl ? (
        <img src={imageUrl} alt={title} loading="lazy" decoding="async" />
      ) : (
        <div
          className={
            kind === 'directory' ? 'landing-card-fallback landing-card-fallback--directory' : 'landing-card-fallback'
          }
          role="img"
          aria-label={kind === 'directory' ? 'No property photo in directory' : 'No property photo available'}
        >
          <span className="landing-card-fallback__eyebrow">
            {kind === 'directory' ? 'Directory' : 'Photo'}
          </span>
          <span className="landing-card-fallback__title">
            {kind === 'directory' ? 'No photo on file' : 'Photo coming when provided by the property'}
          </span>
        </div>
      )}
      {badge ? <span className="landing-card-cash">{badge}</span> : null}
    </div>
  );
}
