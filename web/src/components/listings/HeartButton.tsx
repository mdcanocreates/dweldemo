import { useState } from 'react';
import type { Listing } from '../../api';
import { useSavedHomesContext } from '../../savedHomes';

export function HeartButton({
  listing,
  className = '',
}: {
  listing: Listing;
  className?: string;
}) {
  const { isSaved, toggleSave } = useSavedHomesContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = isSaved(listing.id);

  return (
    <span className={`dwel-heart-wrap ${className}`.trim()}>
      <button
        type="button"
        className={saved ? 'dwel-heart is-saved' : 'dwel-heart'}
        aria-pressed={saved}
        aria-label={saved ? 'Remove from saved homes' : 'Save this home'}
        disabled={busy}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setBusy(true);
          setError(null);
          void toggleSave(listing)
            .catch(() => setError('Could not update saved homes.'))
            .finally(() => setBusy(false));
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 20.2 10.7 19C5.4 14.4 2 11.3 2 7.5 2 4.5 4.4 2.2 7.4 2.2c1.8 0 3.4.8 4.6 2.1C13.2 3 14.8 2.2 16.6 2.2 19.6 2.2 22 4.5 22 7.5c0 3.8-3.4 6.9-8.7 11.5L12 20.2Z"
            fill={saved ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.8"
          />
        </svg>
      </button>
      {error ? (
        <span className="dwel-heart-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
