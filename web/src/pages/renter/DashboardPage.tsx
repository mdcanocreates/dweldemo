import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { RenterShell } from '../../components/layout/RenterShell';
import { SearchBar } from '../../components/listing/SearchBar';
import { ListingCard } from '../../components/listing/ListingCard';
import { Card } from '../../components/ui/Card';
import { useAuth } from '../../hooks/useAuth';
import { useSavedListings } from '../../hooks/useSavedListings';
import { logMatchReasons, useListings } from '../../api/queries/listings';
import { loadOnboardingPrefs, prefsToSearchParams } from '../../lib/listings';
import { paramsToSearchState, type SearchState } from '../../lib/search-state';

export function RenterDashboardPage() {
  const { user } = useAuth();
  const { count } = useSavedListings();
  const prefs = useMemo(() => loadOnboardingPrefs(), []);
  const [searchState, setSearchState] = useState<SearchState>(() =>
    paramsToSearchState(prefs ? prefsToSearchParams(prefs) : {}),
  );
  const { data, isLoading } = useListings(searchState);

  useEffect(() => {
    if (data?.reasonsById) {
      logMatchReasons(user?.party_id ?? null, data.reasonsById);
    }
  }, [data?.reasonsById, user?.party_id]);

  return (
    <RenterShell>
      <h1 className="text-3xl font-semibold">Your dashboard</h1>
      <p className="mt-2 text-dwel-gray-500">
        Listings that match filters you chose — not recommendations.
      </p>

      <div className="mt-6">
        <SearchBar value={searchState} onChange={setSearchState} />
      </div>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Your listings</h2>
        <p className="mt-1 text-sm text-dwel-gray-500">
          Matching bedrooms, location, budget, and move-in date you selected.
        </p>

        {isLoading && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="overflow-hidden">
                <div className="h-40 animate-pulse bg-dwel-gray-200" />
                <div className="space-y-2 p-4">
                  <div className="h-4 w-2/3 rounded bg-dwel-gray-200" />
                  <div className="h-3 w-1/2 rounded bg-dwel-gray-100" />
                </div>
              </Card>
            ))}
          </div>
        )}

        {!isLoading && data && data.listings.length === 0 && (
          <Card className="mt-4 p-6">
            <p className="font-medium">No listings match those filters yet.</p>
            <p className="mt-1 text-sm text-dwel-gray-500">
              Try widening location or budget, or{' '}
              <Link href="/search" className="font-semibold underline underline-offset-2">
                browse all listings
              </Link>
              .
            </p>
          </Card>
        )}

        {!isLoading && data && data.listings.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </section>

      <Card className="mt-8 p-5">
        <p className="font-semibold">Saved</p>
        <p className="mt-1 text-sm text-dwel-gray-500">
          {count} saved {count === 1 ? 'property' : 'properties'}
        </p>
        <Link
          href="/saved"
          className="mt-2 inline-block text-sm font-semibold underline underline-offset-2"
        >
          Go to saved →
        </Link>
      </Card>
    </RenterShell>
  );
}
