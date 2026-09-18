import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type Listing } from '../api';
import { FrogPageLoader } from '../components/FrogPageLoader';
import { ErrorState, Shell } from '../components/Shell';
import { formatAddress, formatBedsBaths, moneyFromCents, titleCaseType } from '../format';
import { useDelayedPending } from '../hooks/useDelayedPending';

function ListingCard({ listing }: { listing: Listing }) {
  const title = formatAddress(listing);
  const img = listing.media?.[0]?.url;
  const cash = listing.cashback_cents ?? 0;
  return (
    <Link to={`/listings/${listing.id}`} className="listing-card" data-testid={`card-listing-${listing.id}`}>
      <div className="media">
        {img ? <img src={img} alt={title} /> : <div style={{ width: '100%', height: '100%' }} />}
        <span className="badge-cash">{moneyFromCents(cash)} back</span>
        {listing.property_type && (
          <span className="badge-type">{titleCaseType(listing.property_type)}</span>
        )}
      </div>
      <div className="body">
        <div className="rent">{moneyFromCents(listing.rent_amount_cents)}/mo</div>
        <div className="meta">{title}</div>
        <div className="meta">{formatBedsBaths(listing.bedrooms, listing.bathrooms)}</div>
      </div>
    </Link>
  );
}

export function ListingsPage() {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [searchPending, setSearchPending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState('');
  const [queryApplied, setQueryApplied] = useState('');
  const [beds, setBeds] = useState('');
  const [baths, setBaths] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [sort, setSort] = useState<'cashback' | 'rent_asc' | 'rent_desc'>('cashback');
  const limit = 20;
  const showFrog = useDelayedPending(initialLoading || searchPending || loadingMore, 400);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setInitialLoading(true);
      try {
        const data = await api.listListings(limit, 0);
        if (!cancelled) {
          setListings(data.listings);
          setTotal(data.pagination.total);
          setOffset(data.listings.length);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Listings could not be loaded.');
        }
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runSearch() {
    setQueryApplied(query);
    setSearchPending(true);
    try {
      const data = await api.listListings(limit, 0);
      setListings(data.listings);
      setTotal(data.pagination.total);
      setOffset(data.listings.length);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed.');
    } finally {
      setSearchPending(false);
    }
  }

  const filtered = useMemo(() => {
    if (!listings) return null;
    let rows = [...listings];
    if (queryApplied.trim()) {
      const q = queryApplied.trim().toLowerCase();
      rows = rows.filter((l) => formatAddress(l).toLowerCase().includes(q));
    }
    if (beds) {
      const n = Number(beds);
      rows = rows.filter((l) => Number(l.bedrooms ?? 0) >= n);
    }
    if (baths) {
      const n = Number(baths);
      rows = rows.filter((l) => Number(l.bathrooms ?? 0) >= n);
    }
    if (propertyType) {
      rows = rows.filter(
        (l) => (l.property_type ?? '').toLowerCase() === propertyType.toLowerCase(),
      );
    }
    rows.sort((a, b) => {
      if (sort === 'rent_asc') return a.rent_amount_cents - b.rent_amount_cents;
      if (sort === 'rent_desc') return b.rent_amount_cents - a.rent_amount_cents;
      return (b.cashback_cents ?? 0) - (a.cashback_cents ?? 0);
    });
    return rows;
  }, [listings, queryApplied, beds, baths, propertyType, sort]);

  async function loadMore() {
    if (loadingMore || !listings) return;
    setLoadingMore(true);
    try {
      const data = await api.listListings(limit, offset);
      setListings([...listings, ...data.listings]);
      setOffset(offset + data.listings.length);
      setTotal(data.pagination.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more listings.');
    } finally {
      setLoadingMore(false);
    }
  }

  const matchCount = filtered?.length ?? 0;
  const matchLabel =
    listings === null
      ? null
      : matchCount === 1
        ? '1 home matches your search'
        : `${matchCount} homes match your search`;

  return (
    <Shell>
      {showFrog && <FrogPageLoader />}
      <div className="dwel-cube-bg listings-page-wash">
        {matchLabel && <p className="listings-match-count">{matchLabel}</p>}
        <h1 className="section-title">Find a home</h1>
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
              <option value="cashback">Top cashback</option>
              <option value="rent_asc">Rent: low to high</option>
              <option value="rent_desc">Rent: high to low</option>
            </select>
          </div>
        </div>

        {error && <ErrorState title="Listings unavailable">{error}</ErrorState>}
        {!error && listings === null && (
          <div className="listing-grid" style={{ marginTop: '1rem' }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: '16rem' }} />
            ))}
          </div>
        )}

        {filtered && filtered.length === 0 && (
          <div className="empty-state" style={{ marginTop: '1.5rem' }}>
            No homes match your search. Adjust your filters or check back — new listings are added
            daily.
          </div>
        )}

        {filtered && filtered.length > 0 && (
          <>
            <div className="listing-grid" style={{ marginTop: '1.25rem' }}>
              {filtered.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
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
    </Shell>
  );
}
