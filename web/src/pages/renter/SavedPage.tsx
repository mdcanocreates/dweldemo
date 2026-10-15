import { Link } from 'wouter';
import { RenterShell } from '../../components/layout/RenterShell';
import { ListingCard } from '../../components/listing/ListingCard';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useSavedListings } from '../../hooks/useSavedListings';
import { getAllListings } from '../../lib/listings';
import { getSessionToken } from '../../api/client';
import { buildLoginHref, setAuthReturn } from '../../lib/auth-return';

export function SavedPage() {
  const { savedIds, toast, count } = useSavedListings();
  const listings = getAllListings().filter((l) => savedIds.includes(l.id));
  const authed = Boolean(getSessionToken());

  return (
    <RenterShell>
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 max-w-sm -translate-x-1/2 rounded-full border border-dwel-gray-200 bg-dwel-white px-4 py-2 text-center text-sm shadow-lg">
          {toast}
        </div>
      )}
      <h1 className="text-2xl font-semibold">Saved</h1>
      <p className="mt-1 text-sm text-dwel-gray-500">
        {authed
          ? `${listings.length} saved home${listings.length === 1 ? '' : 's'} (synced to your account)`
          : `${listings.length} saved home${listings.length === 1 ? '' : 's'} on this device`}
      </p>

      {!authed && (
        <p className="mt-3 text-sm text-dwel-gray-600">
          Sign in to keep your saved homes across devices.{' '}
          <Link
            href={buildLoginHref('/saved')}
            className="font-semibold underline underline-offset-2"
            onClick={() => setAuthReturn({ returnTo: '/saved' })}
          >
            Sign in →
          </Link>
        </p>
      )}

      {listings.length === 0 ? (
        <Card className="mt-6 p-6">
          <p className="font-medium">Nothing saved yet.</p>
          <Link href="/search" className="mt-2 inline-block text-sm font-semibold underline">
            Browse listings →
          </Link>
        </Card>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}

      {!authed && count >= 2 && (
        <div className="mt-8">
          <Link
            href={buildLoginHref('/saved')}
            onClick={() => setAuthReturn({ returnTo: '/saved' })}
          >
            <Button variant="secondary">Sign in to sync them →</Button>
          </Link>
        </div>
      )}
    </RenterShell>
  );
}
