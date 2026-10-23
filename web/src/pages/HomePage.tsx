import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Listing } from '../api';
import { ProductFooter, ProductHeader } from '../components/ProductChrome';
import { formatAddress, formatBedsBaths, moneyFromCents, titleCaseType } from '../format';

/** Marketing landing — same composition as the Netlify reference. */
export function HomePage() {
  const navigate = useNavigate();
  const [homes, setHomes] = useState<Listing[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .listListings(6, 0)
      .then((data) => {
        if (!cancelled) setHomes(data.listings);
      })
      .catch(() => {
        if (!cancelled) setHomes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get('q') ?? '').trim();
    navigate(q ? `/listings?q=${encodeURIComponent(q)}` : '/listings');
  }

  return (
    <div className="landing">
      <ProductHeader />

      <section className="landing-hero" aria-label="Dwel">
        <div
          className="landing-hero-bg"
          style={{ backgroundImage: 'url(/dwelBackdrop.png)' }}
          aria-hidden
        />
        <div className="landing-hero-scrim" aria-hidden />
        <div className="landing-hero-content">
          <div className="landing-hero-pane">
            <p className="landing-hero-eyebrow">Rent smarter · Save more · Move easier</p>
            <h1 className="landing-hero-title">
              Move with
              <br />
              <span className="landing-hero-accent">more back.</span>
            </h1>
            <p className="landing-hero-copy">
              One Dwel application. Unlimited listings. When your rental qualifies, receive the
              stated cashback benefit.
            </p>
            <form className="landing-hero-search" onSubmit={onSearch}>
              <input
                name="q"
                aria-label="Where do you want to move?"
                placeholder="Where do you want to move?  e.g. Austin, TX or 78704"
                autoComplete="off"
              />
              <button type="submit">Search</button>
            </form>
            <p className="landing-hero-alt">
              <a href="#how-dwel-works">How cashback works</a>
              {' · '}
              Prefer guided matching? <Link to="/discover">Start your profile →</Link>
            </p>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-head">
          <div>
            <h2>Featured homes</h2>
            <p>
              {homes === null
                ? 'Loading…'
                : homes.length > 0
                  ? 'A sample of places available to browse'
                  : 'No listings available yet'}
            </p>
          </div>
          <Link to="/listings">View all →</Link>
        </div>
        {homes && homes.length === 0 && (
          <div className="landing-empty">
            <p>Nothing listed in this market yet</p>
            <p>Check back soon, or broaden your search.</p>
            <Link to="/listings">Browse all filters</Link>
          </div>
        )}
        {homes && homes.length > 0 && (
          <div className="landing-grid">
            {homes.map((listing) => (
              <FeaturedHome key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </section>

      <section className="landing-how" aria-labelledby="how-dwel-works">
        <div className="landing-section">
          <h2 id="how-dwel-works">How Dwel works</h2>
          <p className="landing-how-lead">
            Expressing interest does not guarantee a home, an approval, or cashback.
          </p>
          <div className="landing-steps">
            <div>
              <p>01</p>
              <h3>Find a home</h3>
              <p>Browse available listings without creating an account.</p>
            </div>
            <div>
              <p>02</p>
              <h3>Express interest</h3>
              <p>Create a renter profile and submit interest to participating home providers.</p>
            </div>
            <div>
              <p>03</p>
              <h3>Move with more back</h3>
              <p>
                If your rental qualifies and you complete required steps, receive the stated
                cashback benefit.
              </p>
            </div>
          </div>
          <p className="landing-how-link">
            <a href="#how-dwel-works">How cashback works →</a>
          </p>
        </div>
      </section>

      <ProductFooter />
    </div>
  );
}

function FeaturedHome({ listing }: { listing: Listing }) {
  const photo = listing.media?.[0]?.url;
  const city = [listing.address.city, listing.address.state].filter(Boolean).join(', ');
  return (
    <Link to={`/listings/${listing.id}`} className="landing-card">
      <div className="landing-card-media">
        {photo ? <img src={photo} alt="" /> : <div className="landing-card-fallback" />}
        <span className="landing-card-cash">{moneyFromCents(listing.cashback_cents)} back</span>
      </div>
      <div className="landing-card-body">
        <p className="landing-card-meta">
          {titleCaseType(listing.property_type) ?? 'Home'}
          {listing.bedrooms != null ? ` · ${formatBedsBaths(listing.bedrooms, listing.bathrooms)}` : ''}
        </p>
        <p className="landing-card-title">{formatAddress(listing)}</p>
        <p className="landing-card-place">{city}</p>
        <div className="landing-card-row">
          <span>{moneyFromCents(listing.rent_amount_cents)}/mo</span>
          <span>View home →</span>
        </div>
      </div>
    </Link>
  );
}
