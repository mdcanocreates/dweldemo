import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { RenterShell } from '../../components/layout/RenterShell';
import { SearchBar } from '../../components/listing/SearchBar';
import { ListingCard } from '../../components/listing/ListingCard';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../hooks/useAuth';
import { useSavedListings } from '../../hooks/useSavedListings';
import { logMatchReasons, useListings } from '../../api/queries/listings';
import { useHashSearch } from '../../lib/hash-location';
import {
  activeSearchChips,
  buildSearchUrl,
  isSearchStateActive,
  parseSearchState,
  searchHeading,
  type SearchState,
} from '../../lib/search-state';

/** Public /search — hash query is source of truth; Search commits + Clear filters. */
export function SearchPage() {
  const { user } = useAuth();
  const { toast } = useSavedListings();
  const [, setLocation] = useLocation();
  const hashSearch = useHashSearch();
  const searchState = parseSearchState(hashSearch);
  const { data, isLoading, refetch } = useListings(searchState);
  const chips = activeSearchChips(searchState);
  const active = isSearchStateActive(searchState);

  useEffect(() => {
    if (data?.reasonsById) logMatchReasons(user?.party_id ?? null, data.reasonsById);
  }, [data?.reasonsById, user?.party_id]);

  useEffect(() => {
    if (import.meta.env.DEV && data?.debug) {
      // eslint-disable-next-line no-console
      console.debug('[Dwel Search]', {
        searchState,
        rawCount: data.debug.rawCount,
        filteredCount: data.listings.length,
        stages: data.debug.stages,
        hashSearch,
      });
    }
  }, [searchState, data, hashSearch]);

  function applySearch(next: SearchState) {
    setLocation(buildSearchUrl(next));
    void refetch();
  }

  function clearFilters() {
    setLocation('/search');
  }

  function clearChip(next: SearchState) {
    setLocation(buildSearchUrl(next));
  }

  const filteredListings = data?.listings ?? [];
  const count = isLoading ? null : filteredListings.length;
  const heading = searchHeading(searchState, count);

  return (
    <RenterShell wide>
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 max-w-sm -translate-x-1/2 rounded-full border border-dwel-gray-200 bg-dwel-white px-4 py-2 text-center text-sm shadow-lg">
          {toast}
        </div>
      )}
      <SearchBar value={searchState} onChange={applySearch} variant="full" />
      <p className="mt-4 text-sm text-dwel-gray-500">
        Matches are based only on the rental criteria you choose.
      </p>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        {active && (
          <button
            type="button"
            className="text-sm font-semibold text-dwel-gray-600 underline underline-offset-2 hover:text-dwel-black"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        )}
      </div>

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-dwel-gray-200 bg-dwel-white px-3 py-1.5 text-sm text-dwel-gray-700 hover:border-dwel-gray-400"
              onClick={() => clearChip(chip.clear(searchState))}
              aria-label={`Remove ${chip.label} filter`}
            >
              {chip.label}
              <span aria-hidden className="text-dwel-gray-400">
                ×
              </span>
            </button>
          ))}
          <button
            type="button"
            className="text-sm font-semibold text-dwel-gray-500 underline underline-offset-2"
            onClick={clearFilters}
          >
            Clear all
          </button>
        </div>
      )}

      {isLoading && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[4/3] animate-pulse rounded-[10px] bg-dwel-gray-200"
            />
          ))}
        </div>
      )}

      {!isLoading && filteredListings.length === 0 && (
        <div className="mt-8 rounded-[10px] border border-dashed border-dwel-gray-300 bg-dwel-white/60 px-6 py-14 text-center">
          <p className="text-lg font-semibold">No homes match those filters.</p>
          <p className="mt-2 text-sm text-dwel-gray-500">
            Try widening your location, budget, or other preferences.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Button variant="secondary" onClick={clearFilters}>
              Clear filters
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                document
                  .querySelector<HTMLInputElement>('input[aria-label="Location"]')
                  ?.focus();
              }}
            >
              Edit search
            </Button>
          </div>
        </div>
      )}

      {!isLoading && filteredListings.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredListings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </RenterShell>
  );
}
