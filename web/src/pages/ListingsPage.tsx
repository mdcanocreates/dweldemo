import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError, type Listing } from '../api';
import { ApplicationSavingsCard } from '../components/listings/ApplicationSavingsCard';
import { InventoryWaitlist } from '../components/listings/InventoryWaitlist';
import { ListingCard } from '../components/listings/ListingCard';
import { ListingMap, type MapListing } from '../components/listings/ListingMap';
import { ErrorState, Shell } from '../components/Shell';
import { moneyFromCents } from '../format';
import { useDelayedPending } from '../hooks/useDelayedPending';
import { mapStyleUrl, savingsEstimateEnabled } from '../lib/listingFeatures';
import {
  emptyRentalsMode,
  filtersActive,
  shouldShowDirectoryFilters,
  shouldShowRentalFilters,
  type InventoryTab,
} from '../lib/marketplacePreservation';
import { partitionPublicInventory, publishablePublicListings } from '../lib/publicInventory';
import { useSavedHomesContext } from '../savedHomes';

export function ListingsPage() {
  const [params] = useSearchParams();
  const initialQuery = params.get('q') ?? '';
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [searchPending, setSearchPending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [queryApplied, setQueryApplied] = useState(initialQuery);
  const [beds, setBeds] = useState('');
  const [baths, setBaths] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [maxRent, setMaxRent] = useState('');
  const [sort, setSort] = useState<'cashback' | 'rent_asc' | 'rent_desc'>('rent_asc');
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [inventoryTab, setInventoryTab] = useState<InventoryTab>('rentals');
  const [reloadToken, setReloadToken] = useState(0);
  const limit = 20;
  const showFrog = useDelayedPending(initialLoading || searchPending || loadingMore, 400);
  const styleUrl = mapStyleUrl();
  const showDollarEstimate = savingsEstimateEnabled();
  const {
    estimate,
    estimateStatus,
    savedCount,
    savingsPanelVisible,
    dismissSavings,
  } = useSavedHomesContext();

  useEffect(() => {
    let cancelled = false;
    setSearchPending(true);
    (async () => {
      try {
        const data = await api.listListings({
          limit,
          offset: 0,
          q: queryApplied.trim() || undefined,
          minBeds: beds || undefined,
          minBaths: baths || undefined,
          propertyType: propertyType || undefined,
          maxRentCents: maxRent || undefined,
          sort,
        });
        if (!cancelled) {
          const publishable = publishablePublicListings(data.listings);
          setListings(publishable);
          setTotal(publishable.length < data.listings.length ? publishable.length : data.pagination.total);
          setOffset(data.listings.length);
          setError(null);
          setSelectedListingId((current) =>
            current && publishable.some((listing) => listing.id === current) ? current : null,
          );
          const parts = partitionPublicInventory(publishable);
          const activeFilters = Boolean(
            queryApplied.trim() || beds || baths || propertyType || maxRent,
          );
          // Preserve the rentals tab when filters produced zero matches so controls stay visible.
          // On a pristine load with only directory inventory, still open the directory tab.
          setInventoryTab((current) => {
            if (current === 'rentals' && parts.rentals.length > 0) return 'rentals';
            if (current === 'directory' && parts.directory.length > 0) return 'directory';
            if (current === 'rentals' && activeFilters) return 'rentals';
            if (parts.rentals.length > 0) return 'rentals';
            if (parts.directory.length > 0) return 'directory';
            return current;
          });
        }
      } catch (err) {
        if (!cancelled) {
          setListings(null);
          setTotal(0);
          setError(err instanceof ApiError ? err.message : 'Listings could not be loaded.');
          setViewMode('list');
        }
      } finally {
        if (!cancelled) {
          setInitialLoading(false);
          setSearchPending(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryApplied, beds, baths, propertyType, maxRent, sort, reloadToken]);

  const partitions = useMemo(
    () => partitionPublicInventory(listings ?? []),
    [listings],
  );
  const visibleListings =
    inventoryTab === 'rentals' ? partitions.rentals : partitions.directory;
  const rentalCount = partitions.rentals.length;
  const directoryCount =
    listings !== null && rentalCount === 0 ? total : partitions.directory.length;
  const catalogErrored = Boolean(error);
  const rentalsEmpty = !error && listings !== null && rentalCount === 0;
  const directoryEmpty = !error && listings !== null && directoryCount === 0;
  const visibleEmpty =
    !error && listings !== null && visibleListings.length === 0;
  const mapAvailable = Boolean(styleUrl) && !catalogErrored;
  const mapMode = viewMode === 'map' && mapAvailable;
  const searchFiltersActive = filtersActive({
    queryApplied,
    beds,
    baths,
    propertyType,
    maxRent,
  });
  const rentalsEmptyMode = emptyRentalsMode({
    rentalsEmpty,
    filtersActive: searchFiltersActive,
  });
  const showRentalFilters = shouldShowRentalFilters({ inventoryTab, catalogErrored });
  const showDirectoryFilters = shouldShowDirectoryFilters({ inventoryTab, catalogErrored });

  const matchLabel =
    listings === null || error
      ? null
      : inventoryTab === 'rentals'
        ? rentalCount === 0
          ? null
          : rentalCount === 1
            ? '1 rental matches your search'
            : `${rentalCount} rentals match your search`
        : directoryCount === 0
          ? null
          : directoryCount === 1
            ? '1 directory property'
            : `${directoryCount} directory properties`;

  function runSearch() {
    setQueryApplied(query);
  }

  function selectListing(id: string) {
    setSelectedListingId(id);
    document.getElementById(`listing-card-${id}`)?.scrollIntoView({ block: 'nearest' });
  }

  async function loadMore() {
    if (loadingMore || !listings || error) return;
    setLoadingMore(true);
    try {
      const data = await api.listListings({
        limit,
        offset,
        q: queryApplied.trim() || undefined,
        minBeds: beds || undefined,
        minBaths: baths || undefined,
        propertyType: propertyType || undefined,
        maxRentCents: maxRent || undefined,
        sort,
      });
      const more = publishablePublicListings(data.listings);
      const merged = [...listings, ...more];
      setListings(merged);
      setOffset(offset + data.listings.length);
      setTotal(merged.length);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more listings.');
    } finally {
      setLoadingMore(false);
    }
  }

  const mapListings: MapListing[] = visibleListings.flatMap((listing) => {
    const location = listing.map_location;
    if (!location) return [];
    return [
      {
        id: listing.id,
        latitude: location.latitude,
        longitude: location.longitude,
        priceLabel:
          listing.inventory_kind === 'directory'
            ? 'Dir'
            : moneyFromCents(listing.rent_amount_cents),
      },
    ];
  });

  const savingsCardStatus =
    !showDollarEstimate
      ? 'unavailable'
      : error
        ? 'error'
        : initialLoading
          ? 'loading'
          : estimateStatus;

  function renderEmptyRentals() {
    if (rentalsEmptyMode === 'no_match') {
      return (
        <p className="muted" style={{ marginTop: '1.5rem' }} data-testid="listings-no-match">
          No homes match your search. Adjust your filters.
        </p>
      );
    }
    return <InventoryWaitlist initialCity={queryApplied || query} />;
  }

  return (
    <Shell fullBleed={mapMode}>
      {showFrog ? <p className="muted">Loading homes…</p> : null}
      <div
        className={mapMode ? 'dwel-listings-shell dwel-listings-shell--map' : 'dwel-listings-shell'}
        data-view={mapMode ? 'map' : 'list'}
        data-catalog={visibleEmpty ? 'empty' : 'ready'}
        data-inventory-tab={inventoryTab}
      >
        <div className="dwel-listings-toolbar">
          <div className="dwel-listings-toolbar__intro">
            {matchLabel && <p className="listings-match-count">{matchLabel}</p>}
            <h1 className="section-title">Find a home</h1>
          </div>
          {mapAvailable && (
            <div className="dwel-listings-toolbar__modes" role="group" aria-label="List or map">
              <button type="button" aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')}>
                List
              </button>
              <button type="button" aria-pressed={viewMode === 'map'} onClick={() => setViewMode('map')}>
                Map
              </button>
            </div>
          )}
          {savingsPanelVisible && (
            <div className="dwel-listings-toolbar__savings">
              <ApplicationSavingsCard
                estimate={estimate}
                status={savingsCardStatus}
                savedCount={savedCount}
                onDismiss={dismissSavings}
              />
            </div>
          )}
        </div>

        {catalogErrored && (
          <div className="dwel-listings-error" data-testid="listings-server-error">
            <ErrorState title="We could not load homes">{error}</ErrorState>
            <p className="muted">
              This is a temporary service problem, not an empty catalog. Try again in a moment.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setError(null);
                setListings(null);
                setInitialLoading(true);
                setReloadToken((n) => n + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}

        {!catalogErrored && (
          <>
            <div className="dwel-inventory-tabs" role="tablist" aria-label="Inventory type">
              <button
                type="button"
                role="tab"
                aria-selected={inventoryTab === 'rentals'}
                className={inventoryTab === 'rentals' ? 'is-active' : undefined}
                onClick={() => setInventoryTab('rentals')}
              >
                Available rentals
                <span>{rentalCount}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={inventoryTab === 'directory'}
                className={inventoryTab === 'directory' ? 'is-active' : undefined}
                onClick={() => setInventoryTab('directory')}
              >
                Housing directory
                <span>{directoryCount}</span>
              </button>
            </div>
            <div className="search-row">
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="loc">Location</label>
                <input
                  id="loc"
                  placeholder="City, neighborhood, or address"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                style={{ alignSelf: 'end' }}
                onClick={() => void runSearch()}
                disabled={searchPending}
              >
                Search homes
              </button>
            </div>
            {showRentalFilters && (
              <div className="filter-bar" data-testid="rental-filter-bar">
                <div className="field">
                  <label htmlFor="price">Price</label>
                  <select id="price" value={maxRent} onChange={(e) => setMaxRent(e.target.value)}>
                    <option value="">Any</option>
                    <option value="150000">Up to $1,500</option>
                    <option value="200000">Up to $2,000</option>
                    <option value="250000">Up to $2,500</option>
                    <option value="300000">Up to $3,000</option>
                    <option value="400000">Up to $4,000</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="beds">Beds</label>
                  <select id="beds" value={beds} onChange={(e) => setBeds(e.target.value)}>
                    <option value="">Any</option>
                    <option value="1">1+</option>
                    <option value="2">2+</option>
                    <option value="3">3+</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="baths">Baths</label>
                  <select id="baths" value={baths} onChange={(e) => setBaths(e.target.value)}>
                    <option value="">Any</option>
                    <option value="1">1+</option>
                    <option value="2">2+</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ptype">Property type</label>
                  <select id="ptype" value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
                    <option value="">Any</option>
                    <option value="multifamily">Multifamily</option>
                    <option value="single_family">Single family</option>
                    <option value="condo">Condo</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="sort">Sort</label>
                  <select
                    id="sort"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as typeof sort)}
                  >
                    <option value="rent_asc">Rent: low to high</option>
                    <option value="rent_desc">Rent: high to low</option>
                    <option value="cashback">Verified cashback</option>
                  </select>
                </div>
              </div>
            )}
            {showDirectoryFilters && (
              <div className="filter-bar" data-testid="directory-filter-bar">
                <div className="field">
                  <label htmlFor="dir-ptype">Property type</label>
                  <select
                    id="dir-ptype"
                    value={propertyType}
                    onChange={(e) => setPropertyType(e.target.value)}
                  >
                    <option value="">Any</option>
                    <option value="multifamily">Multifamily</option>
                    <option value="single_family">Single family</option>
                    <option value="condo">Condo</option>
                    <option value="residential">Residential</option>
                  </select>
                </div>
              </div>
            )}
            {inventoryTab === 'directory' && !directoryEmpty && (
              <p className="dwel-directory-banner">
                Affordable housing directory entries are not confirmed vacant rentals. Availability and
                eligibility must be verified with each property.
              </p>
            )}
          </>
        )}

        {catalogErrored ? null : mapMode ? (
          <div className="dwel-map-workspace" data-testid="listings-map-workspace">
            <div className="dwel-map-workspace__map">
              <ListingMap
                listings={mapListings}
                selectedListingId={selectedListingId}
                onSelectListing={selectListing}
                styleUrl={styleUrl}
                searchQuery={queryApplied || query}
              />
            </div>
            <aside className="dwel-map-workspace__rail" aria-label="Matching homes">
              {visibleEmpty ? (
                inventoryTab === 'rentals' ? (
                  renderEmptyRentals()
                ) : (
                  <p className="muted">No directory properties match this search.</p>
                )
              ) : (
                <>
                  {!error && listings === null && (
                    <div className="listing-grid">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="skeleton" style={{ height: '12rem' }} />
                      ))}
                    </div>
                  )}
                  {visibleListings.length > 0 && (
                    <>
                      <div className="dwel-map-workspace__cards">
                        {visibleListings.map((listing) => (
                          <ListingCard
                            key={listing.id}
                            listing={listing}
                            selected={listing.id === selectedListingId}
                            onSelect={selectListing}
                            compact
                          />
                        ))}
                      </div>
                      {listings && listings.length < total && (
                        <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-outline"
                            onClick={() => void loadMore()}
                            disabled={loadingMore}
                          >
                            {loadingMore ? 'Loading…' : 'Load more'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </aside>
          </div>
        ) : visibleEmpty ? (
          inventoryTab === 'rentals' ? (
            renderEmptyRentals()
          ) : (
            <p className="muted" style={{ marginTop: '1.5rem' }}>
              No directory properties match this search.
            </p>
          )
        ) : (
          <div className="dwel-listings-results" data-testid="listings-list-workspace">
            {listings === null && (
              <div className="listing-grid" style={{ marginTop: '1rem' }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton" style={{ height: '16rem' }} />
                ))}
              </div>
            )}
            {visibleListings.length > 0 && (
              <>
                <div
                  className={
                    inventoryTab === 'directory' ? 'landing-grid landing-grid--directory' : 'landing-grid'
                  }
                  style={{ marginTop: '1.25rem' }}
                >
                  {visibleListings.map((listing) => (
                    <ListingCard
                      key={listing.id}
                      listing={listing}
                      selected={listing.id === selectedListingId}
                      onSelect={selectListing}
                    />
                  ))}
                </div>
                {listings && listings.length < total && (
                  <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => void loadMore()}
                      disabled={loadingMore}
                    >
                      {loadingMore ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
