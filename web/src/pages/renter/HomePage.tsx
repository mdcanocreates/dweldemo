import { Link, useLocation } from 'wouter';
import { useState } from 'react';
import { RenterShell } from '../../components/layout/RenterShell';
import { ListingCard } from '../../components/listing/ListingCard';
import { SearchBar } from '../../components/listing/SearchBar';
import { Button } from '../../components/ui/Button';
import { useListings } from '../../api/queries/listings';
import { useSavedListings } from '../../hooks/useSavedListings';
import { buildSearchUrl, type SearchState } from '../../lib/search-state';

/** Marketing landing — glass hero over dwelBackdrop; inventory + how-it-works unchanged. */
export function HomePage() {
  const [, setLocation] = useLocation();
  const [heroState, setHeroState] = useState<SearchState>({});
  const { data, isLoading } = useListings({});
  const { toast } = useSavedListings();
  const homes = (data?.listings ?? []).slice(0, 6);

  function onHeroSearch(next: SearchState) {
    setHeroState(next);
    setLocation(buildSearchUrl(next));
  }

  return (
    <RenterShell fullBleed workspace={false}>
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 max-w-sm -translate-x-1/2 rounded-full border border-dwel-gray-200 bg-dwel-white px-4 py-2 text-center text-sm shadow-lg">
          {toast}
        </div>
      )}

      <section className="landing-hero" aria-label="Dwel">
        <div
          className="landing-hero-bg"
          style={{ backgroundImage: 'url(/dwelBackdrop.png)' }}
          aria-hidden
        />
        <div className="landing-hero-scrim" aria-hidden />
        <div className="landing-hero-content">
          <div className="landing-hero-pane">
            <p className="landing-hero-eyebrow">RENT SMARTER · SAVE MORE · MOVE EASIER</p>
            <h1 className="landing-hero-title">
              Move with
              <br />
              <span className="landing-hero-accent">more back.</span>
            </h1>
            <p className="landing-hero-copy">
              One Dwel application. Unlimited listings. When your rental qualifies, receive the
              stated cashback benefit.
            </p>
            <div className="landing-hero-search">
              <SearchBar value={heroState} onChange={onHeroSearch} variant="hero" />
            </div>
            <p className="landing-hero-alt">
              <Link href="/cashback-terms">How cashback works</Link>
              {' · '}
              Prefer guided matching?{' '}
              <Link href="/discover">Start your profile →</Link>
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1098px] px-4 py-12 sm:px-6 lg:px-12">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Featured homes</h2>
            <p className="mt-1 text-sm text-dwel-gray-500">
              {isLoading
                ? 'Loading…'
                : homes.length > 0
                  ? 'A sample of places available to browse'
                  : 'No listings available yet'}
            </p>
          </div>
          <Link href="/search" className="text-sm font-semibold underline underline-offset-2">
            View all →
          </Link>
        </div>

        {!isLoading && homes.length === 0 && (
          <div className="mt-8 rounded-[10px] border border-dashed border-dwel-gray-300 bg-dwel-white/60 px-6 py-16 text-center">
            <p className="text-lg font-semibold">Nothing listed in this market yet</p>
            <p className="mt-2 text-sm text-dwel-gray-500">
              Check back soon, or broaden your search.
            </p>
            <Link href="/search" className="mt-4 inline-block">
              <Button variant="secondary">Browse all filters</Button>
            </Link>
          </div>
        )}

        {homes.length > 0 && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {homes.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-dwel-gray-200/80 bg-dwel-white/50" aria-labelledby="how-dwel-works">
        <div className="mx-auto max-w-[1098px] px-4 py-14 sm:px-6 lg:px-12">
          <h2 id="how-dwel-works" className="text-2xl font-semibold">
            How Dwel works
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-dwel-muted">
            Expressing interest does not guarantee a home, an approval, or cashback.
          </p>
          <div className="mt-8 grid gap-10 sm:grid-cols-3">
            {[
              {
                n: '01',
                t: 'Find a home',
                b: 'Browse available listings without creating an account.',
              },
              {
                n: '02',
                t: 'Express interest',
                b: 'Create a renter profile and submit interest to participating Home Providers.',
              },
              {
                n: '03',
                t: 'Move with more back',
                b: 'If your rental qualifies and you complete required steps, receive the stated cashback benefit.',
              },
            ].map((s) => (
              <div key={s.n}>
                <p className="font-mono text-xs text-dwel-gray-400">{s.n}</p>
                <h3 className="mt-2 text-lg font-semibold">{s.t}</h3>
                <p className="mt-2 max-w-[32ch] text-sm leading-relaxed text-dwel-gray-600">{s.b}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-sm">
            <Link href="/cashback-terms" className="font-semibold underline underline-offset-2">
              How cashback works →
            </Link>
          </p>
        </div>
      </section>
    </RenterShell>
  );
}
