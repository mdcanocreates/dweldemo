import { useQuery } from '@tanstack/react-query';
import type { Listing, MatchReason } from '../../types';
import { applySearchFilters } from '../../lib/apply-search-filters';
import { getAllListings, getListingById } from '../../lib/listings';
import { mapApiListing, type ApiListingRaw } from '../../lib/map-listing';
import type { SearchState } from '../../lib/search-state';
import { ApiError } from '../client';
import { isUiPreviewActive } from '../../lib/ui-preview';
import { previewPublicListings } from '../../lib/ui-preview-data';

type ListingsResult = {
  listings: Listing[];
  reasonsById: Record<string, MatchReason[]>;
  source: 'api' | 'fixtures';
  debug?: {
    rawCount: number;
    stages: Record<string, number>;
    unsupported: string[];
  };
};

/**
 * Load inventory from API when available (mapped to Listing shape).
 * Fixtures only when API is empty/unreachable — browse still works offline.
 * Filters always apply; empty stays empty.
 */
async function loadAndFilter(state: SearchState): Promise<ListingsResult> {
  let raw: Listing[] = getAllListings();
  let source: 'api' | 'fixtures' = 'fixtures';

  if (isUiPreviewActive()) {
    const usable = previewPublicListings()
      .map((row) => mapApiListing(row))
      .filter((l): l is Listing => l != null);
    if (usable.length > 0) {
      raw = usable;
      source = 'api';
    }
  } else {
    try {
      const res = await fetch('/v1/listings?limit=200&offset=0', { credentials: 'include' });
      if (res.ok) {
        const body = (await res.json()) as { listings?: ApiListingRaw[] };
        if (Array.isArray(body.listings) && body.listings.length > 0) {
          const usable = body.listings
            .map((row) => mapApiListing(row))
            .filter((l): l is Listing => l != null);
          if (usable.length > 0) {
            raw = usable;
            source = 'api';
          }
        }
      }
    } catch (err) {
      if (!(err instanceof ApiError) && import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug('[Dwel Search] API listings unavailable, using fixtures');
      }
    }
  }

  const filtered = applySearchFilters(raw, state);
  return { ...filtered, source };
}

export function useListings(state: SearchState) {
  return useQuery({
    queryKey: ['listings', state],
    queryFn: () => loadAndFilter(state),
  });
}

export function useListing(id: string | undefined) {
  return useQuery({
    queryKey: ['listing', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<Listing | null> => {
      if (!id) return null;
      if (isUiPreviewActive()) {
        const row = previewPublicListings().find((l) => l.id === id);
        if (row) {
          const mapped = mapApiListing(row);
          if (mapped) return mapped;
        }
        return getListingById(id) ?? null;
      }
      try {
        const res = await fetch(`/v1/listings/${id}`, { credentials: 'include' });
        if (res.ok) {
          const body = (await res.json()) as { listing?: ApiListingRaw } & ApiListingRaw;
          const mapped = mapApiListing(body.listing ?? body);
          if (mapped) return mapped;
        }
      } catch {
        /* fall through */
      }
      return getListingById(id) ?? null;
    },
  });
}

export function logMatchReasons(
  renterId: string | null,
  reasonsById: Record<string, MatchReason[]>,
): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[match_reason]', { renter_id: renterId, reasonsById });
  }
}
