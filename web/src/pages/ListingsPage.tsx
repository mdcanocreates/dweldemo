import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, type Listing } from '../api';
import { ApplicationSavingsCard } from '../components/listings/ApplicationSavingsCard';
import { InventoryWaitlist } from '../components/listings/InventoryWaitlist';
import { ListingMap, type MapListing } from '../components/listings/ListingMap';
import { ErrorState, Shell } from '../components/Shell';
import { formatAddress, formatBedsBaths, moneyFromCents, titleCaseType } from '../format';
import { useDelayedPending } from '../hooks/useDelayedPending';
import { mapStyleUrl, savingsEstimateEnabled } from '../lib/listingFeatures';
import { publishablePublicListings } from '../lib/publicInventory';

function ListingCard({
  listing,
  selected,
  onSelect,
  compact = false,
}: {
  listing: Listing;
  selected: boolean;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  const title = formatAddress(listing);
  const img = listing.media?.[0]?.url;
  const offer = listing.offers?.[0]?.display_text ?? null;
  const city = [listing.address.city, listing.address.state].filter(Boolean).join(', ');
  return (
    <article
      id={`listing-card-${listing.id}`}
      className={selected ? 'landing-card is-selected' : 'landing-card'}
      data-testid={`card-listing-${listing.id}`}
    >
      <button type="button" className="dwel-listing-select" onClick={() => onSelect(listing.id)}>
        <div className={compact ? 'landing-card-media landing-card-media--compact' : 'landing-card-media'}>
          {img ? <img src={img} alt={title} /> : <div className="landing-card-fallback" />}
          {offer && <span className="landing-card-cash">{offer}</span>}
        </div>
        <div className="landing-card-body">
          <p className="landing-card-meta">
            {titleCaseType(listing.property_type) ?? 'Home'}
            {listing.bedrooms != null ? ` · ${formatBedsBaths(listing.bedrooms, listing.bathrooms)}` : ''}
            {listing.listing_channel ? ` · ${listing.listing_channel}` : ''}
          </p>
          <p className="landing-card-title">{title}</p>
          <p className="landing-card-place">{city}</p>
          <div className="landing-card-row">
            <span>{moneyFromCents(listing.rent_amount_cents)}/mo</span>
          </div>
          {offer && (
            <p className="dwel-offer-disclaimer">Offer advertised by property; terms apply.</p>
          )}
        </div>
      </button>
      <Link className="dwel-listing-open" to={`/listings/${listing.id}`}>
        View home →
      </Link>
    </article>
  );
}

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
  const [sort, setSort] = useState<'cashback' | 'rent_asc' | 'rent_desc'>('rent_asc');
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [reloadToken, setReloadToken] = useState(0);
  const limit = 20;
  const showFrog = useDelayedPending(initialLoading || searchPending || loadingMore, 400);
  const styleUrl = mapStyleUrl();
  const showDollarEstimate = savingsEstimateEnabled();
  const catalogEmpty = !error && listings !== null && listings.length === 0;
  const catalogErrored = Boolean(error);
  const mapMode = viewMode === 'map' && !catalogEmpty && !catalogErrored;

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
          if (publishable.length === 0) setViewMode('list');
        }
      } catch (err) {
        if (!cancelled) {
          setListings(null);
          setTotal(0);
          setError(err instanceof ApiError ? err.message : 'Listings could not be loaded.');
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
  }, [queryApplied, beds, baths, propertyType, sort, reloadToken]);

  const matchLabel =
    listings === null || error
      ? null
      : catalogEmpty
        ? null
        : total === 1
          ? '1 home matches your search'
          : `${total} homes match your search`;

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

  const mapListings: MapListing[] = (listings ?? []).flatMap((listing) => {
    const location = listing.map_location;
    if (!location) return [];
    return [{
      id: listing.id,
      latitude: location.latitude,
      longitude: location.longitude,
      priceLabel: moneyFromCents(listing.rent_amount_cents),
    }];
  });

  const savingsStatus = catalogEmpty || !showDollarEstimate
    ? 'unavailable'
    : error
      ? 'error'
      : initialLoading
        ? 'loading'
        : 'unavailable';

  return (
    <Shell fullBleed={mapMode}>
      {showFrog ? <p className="muted">Loading homes…</p> : null}
      <div
        className={mapMode ? 'dwel-listings-shell dwel-listings-shell--map' : 'dwel-listings-shell'}
        data-view={mapMode ? 'map' : 'list'}
        data-catalog={catalogEmpty ? 'empty' : 'ready'}
      >
        <div className="dwel-listings-toolbar">
          <div className="dwel-listings-toolbar__intro">
            {matchLabel && <p className="listings-match-count">{matchLabel}</p>}
            <h1 className="section-title">Find a home</h1>
          </div>
          {!catalogEmpty && !catalogErrored && (
            <div className="dwel-listings-toolbar__modes" role="group" aria-label="List or map">
              <button type="button" aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')}>
                List
              </button>
              <button type="button" aria-pressed={viewMode === 'map'} onClick={() => setViewMode('map')}>
                Map
              </button>
            </div>
          )}
          {!catalogEmpty && !catalogErrored && showDollarEstimate && (
            <div className="dwel-listings-toolbar__savings">
              <ApplicationSavingsCard estimate={null} status={savingsStatus} />
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

        {!catalogEmpty && !catalogErrored && (
          <>
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
            <div className="filter-bar">
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
          </>
        )}

        {catalogEmpty ? (
          <InventoryWaitlist initialCity={queryApplied || query} />
        ) : catalogErrored ? null : mapMode ? (
          <div className="dwel-map-workspace" data-testid="listings-map-workspace">
            <div className="dwel-map-workspace__map">
              <ListingMap
                listings={mapListings}
                selectedListingId={selectedListingId}
                onSelectListing={selectListing}
                styleUrl={styleUrl}
              />
            </div>
            <aside className="dwel-map-workspace__rail" aria-label="Matching homes">
              {error && <ErrorState title="Listings unavailable">{error}</ErrorState>}
              {!error && listings === null && (
                <div className="listing-grid">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="skeleton" style={{ height: '12rem' }} />
                  ))}
                </div>
              )}
              {!error && listings && listings.length > 0 && (
                <>
                  <div className="dwel-map-workspace__cards">
                    {listings.map((listing) => (
                      <ListingCard
                        key={listing.id}
                        listing={listing}
                        selected={listing.id === selectedListingId}
                        onSelect={selectListing}
                        compact
                      />
                    ))}
                  </div>
                  {listings.length < total && (
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
            </aside>
          </div>
        ) : (
          <div className="dwel-listings-results" data-testid="listings-list-workspace">
            {error && <ErrorState title="Listings unavailable">{error}</ErrorState>}
            {!error && listings === null && (
              <div className="listing-grid" style={{ marginTop: '1rem' }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton" style={{ height: '16rem' }} />
                ))}
              </div>
            )}
            {!error && listings && listings.length > 0 && (
              <>
                <div className="landing-grid" style={{ marginTop: '1.25rem' }}>
                  {listings.map((listing) => (
                    <ListingCard
                      key={listing.id}
                      listing={listing}
                      selected={listing.id === selectedListingId}
                      onSelect={selectListing}
                    />
                  ))}
                </div>
                {listings.length < total && (
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
