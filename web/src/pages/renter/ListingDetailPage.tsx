import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'wouter';
import { RenterShell } from '../../components/layout/RenterShell';
import { PhotoGallery } from '../../components/listing/PhotoGallery';
import { CashbackBadge } from '../../components/listing/CashbackBadge';
import { InterestAuthSheet } from '../../components/listing/InterestAuthSheet';
import { InterestProfileSheet } from '../../components/listing/InterestProfileSheet';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useListing } from '../../api/queries/listings';
import { api, ApiError, getSessionToken } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { formatCents } from '../../lib/money';
import { bedLabel } from '../../lib/listings';
import { loadPrequal, setPartyRole } from '../../lib/user-flow-store';
import { useSavedListings } from '../../hooks/useSavedListings';
import { pushRecentlyViewed } from '../../lib/auth-return';
import { incomeBandToAnnualCents, isListingUuid } from '../../lib/map-listing';
import type { PrequalProfile } from '../../types';

type PendingIdentity = {
  given_name?: string;
  family_name?: string;
  email?: string;
  phone?: string;
};

function loadPendingIdentity(): PendingIdentity | null {
  try {
    const raw = localStorage.getItem('dwel.pending_profile.v1');
    return raw ? (JSON.parse(raw) as PendingIdentity) : null;
  } catch {
    return null;
  }
}

function savePendingIdentity(input: PendingIdentity): void {
  try {
    localStorage.setItem('dwel.pending_profile.v1', JSON.stringify(input));
  } catch {
    /* ignore */
  }
}

/** Public listing detail — I'm interested posts server-side interest when possible. */
export function ListingDetailPage() {
  const params = useParams<{ id: string }>();
  const { data: listing, isLoading } = useListing(params.id);
  const { user, loading: authLoading, refresh } = useAuth();
  const { isSaved, toggle, toast } = useSavedListings();
  const [interestSent, setInterestSent] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resumeTried = useRef(false);

  useEffect(() => {
    if (params.id) pushRecentlyViewed(params.id);
  }, [params.id]);

  useEffect(() => {
    const onIdentitySaved = () => {
      void continueInterestFlow();
    };
    window.addEventListener('dwel:interest-identity-saved', onIdentitySaved);
    return () => window.removeEventListener('dwel:interest-identity-saved', onIdentitySaved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.id]);

  useEffect(() => {
    if (!listing || !getSessionToken() || authLoading) return;
    let cancelled = false;
    void (async () => {
      try {
        const mine = await api.listMyApplications();
        if (cancelled) return;
        if (mine.applications.some((a) => a.listing_id === listing.id)) {
          setInterestSent(true);
        }
      } catch {
        /* offline / unauthenticated */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listing?.id, user?.party_id, authLoading]);

  useEffect(() => {
    if (authLoading || !listing || interestSent || resumeTried.current) return;
    try {
      const hash = window.location.hash;
      const q = hash.includes('?') ? new URLSearchParams(hash.split('?')[1]) : null;
      if (q?.get('action') === 'interest' && getSessionToken()) {
        resumeTried.current = true;
        setPartyRole('renter');
        void continueInterestFlow();
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.id, authLoading, user?.party_id]);

  async function resolveIdentity(): Promise<{
    given_name: string;
    family_name: string;
    email: string;
    phone: string;
    complete: boolean;
  } | null> {
    const pending = loadPendingIdentity();
    let server: Awaited<ReturnType<typeof api.getRenterProfile>>['profile'] = null;
    if (getSessionToken()) {
      try {
        const res = await api.getRenterProfile();
        server = res.profile;
      } catch {
        /* ignore */
      }
    }

    const given =
      server?.given_name ||
      user?.given_name ||
      pending?.given_name ||
      '';
    const family =
      server?.family_name ||
      user?.family_name ||
      pending?.family_name ||
      '';
    const email =
      server?.email ||
      user?.email ||
      pending?.email ||
      '';
    const phoneRaw =
      server?.phone_e164 ||
      user?.phone_e164 ||
      pending?.phone ||
      '';
    const phone = phoneRaw.replace(/\D/g, '');

    if (given && family && email && phone.length >= 7) {
      savePendingIdentity({
        given_name: given,
        family_name: family,
        email,
        phone: phoneRaw,
      });
      return {
        given_name: given,
        family_name: family,
        email,
        phone,
        complete: true,
      };
    }

    return {
      given_name: given,
      family_name: family,
      email,
      phone,
      complete: false,
    };
  }

  async function persistServerInterest(profile: PrequalProfile) {
    if (!listing) return;
    if (!isListingUuid(listing.id)) {
      setError(
        'This sample listing cannot receive interest. Browse a live listing from search (UUID inventory).',
      );
      return;
    }
    if (!getSessionToken()) {
      setAuthOpen(true);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const identity = await resolveIdentity();
      if (!identity?.complete) {
        setAuthOpen(true);
        setError('Sign in with name, email, and phone so we can save your interest.');
        return;
      }

      await api.upsertRenterProfile({
        given_name: identity.given_name,
        family_name: identity.family_name,
        phone: identity.phone.startsWith('1')
          ? `+${identity.phone}`
          : `+1${identity.phone}`,
        email: identity.email,
        annual_income_cents: incomeBandToAnnualCents(profile.income_band),
        move_in_urgency: 'flexible',
        bedrooms_min: Number(profile.bedrooms[0] || 1) || 1,
        rent_max_cents: profile.budget_max_cents || 300000,
        state: (listing.state || 'TX').slice(0, 2).toUpperCase(),
        has_pets: profile.has_pets,
        household_size: profile.occupant_count || 1,
      });

      await api.upsertRenterIntake({
        occupants: Array.from({ length: profile.occupant_count || 1 }).map((_, i) => ({
          role: i === 0 ? 'primary' : 'occupant',
          index: i,
        })),
        pets: profile.has_pets
          ? (profile.pet_details ?? [{ type: 'pet', breed: '', weight: '' }]).map((p) => ({
              type: p.type,
              breed: 'breed' in p ? p.breed : '',
              weight: 'weight' in p ? p.weight : '',
            }))
          : [],
        monthly_gross_income_cents: Math.round(incomeBandToAnnualCents(profile.income_band) / 12),
        mark_complete: true,
      });

      await api.expressInterest(listing.id);
      await refresh();
      setInterestSent(true);
      setProfileOpen(false);
      setAuthOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send interest. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function continueInterestFlow() {
    if (!getSessionToken()) {
      setAuthOpen(true);
      return;
    }
    setPartyRole('renter');

    const identity = await resolveIdentity();
    if (!identity?.complete) {
      // Authenticated but missing profile fields — do not ask for email if we have it.
      // Reuse auth sheet only when email is missing; otherwise open interest profile
      // after stashing what we have and prompting via auth sheet for remaining identity.
      if (!identity?.email) {
        setAuthOpen(true);
        return;
      }
      // Have email from me/pending — still need name/phone for first interest.
      if (!identity.given_name || !identity.family_name || identity.phone.length < 7) {
        setAuthOpen(true);
        return;
      }
    }

    const pq = loadPrequal();
    if (!pq || pq.status !== 'complete' || !pq.occupant_count) {
      setProfileOpen(true);
      return;
    }
    await persistServerInterest(pq);
  }

  function onInterest() {
    setError(null);
    if (!getSessionToken() || !user) {
      setAuthOpen(true);
      return;
    }
    void continueInterestFlow();
  }

  if (isLoading || authLoading) {
    return (
      <RenterShell>
        <p className="text-sm text-dwel-gray-500">Loading listing…</p>
      </RenterShell>
    );
  }

  if (!listing) {
    return (
      <RenterShell>
        <Card className="p-6">
          <p className="font-medium">Listing not found.</p>
          <Link href="/search" className="mt-2 inline-block text-sm font-semibold underline">
            Back to search
          </Link>
        </Card>
      </RenterShell>
    );
  }

  const neighborhood = listing.neighborhood ?? listing.city;
  const listingPath = `/listing/${listing.id}`;

  return (
    <RenterShell>
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 max-w-sm -translate-x-1/2 rounded-full border border-dwel-gray-200 bg-dwel-white px-4 py-2 text-center text-sm shadow-lg">
          {toast}
        </div>
      )}

      <InterestAuthSheet
        open={authOpen}
        listingPath={`${listingPath}?action=interest`}
        listingName={listing.property_name}
        onClose={() => setAuthOpen(false)}
        prefill={user ? {
          given_name: user.given_name ?? loadPendingIdentity()?.given_name ?? '',
          family_name: user.family_name ?? loadPendingIdentity()?.family_name ?? '',
          email: user.email ?? loadPendingIdentity()?.email ?? '',
          phone: user.phone_e164 ?? loadPendingIdentity()?.phone ?? '',
          hideEmail: Boolean(user.email || loadPendingIdentity()?.email),
        } : {
          given_name: loadPendingIdentity()?.given_name ?? '',
          family_name: loadPendingIdentity()?.family_name ?? '',
          email: loadPendingIdentity()?.email ?? '',
          phone: loadPendingIdentity()?.phone ?? '',
          hideEmail: false,
        }}
      />
      <InterestProfileSheet
        open={profileOpen}
        listingName={listing.property_name}
        onClose={() => setProfileOpen(false)}
        onComplete={(profile) => void persistServerInterest(profile)}
      />

      <div className="space-y-5">
        <PhotoGallery
          photos={listing.photos}
          alt={listing.property_name}
          cashbackCents={listing.cashback_cents}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="mint">Available</Badge>
          <CashbackBadge
            cashbackCents={listing.cashback_cents}
            rentCents={listing.rent_cents}
            compact
            explain
          />
        </div>

        {listing.concession_available && !listing.cashback_cents && (
          <div className="rounded-[10px] border border-dwel-mint bg-dwel-mint/20 px-4 py-3 text-sm">
            Move-in incentive available
            {listing.concession_description ? `: ${listing.concession_description}` : ''}. Terms
            are confirmed in the lease — no money flows through Dwel.
          </div>
        )}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">{listing.property_name}</h1>
            <p className="mt-1 text-dwel-muted">{neighborhood}</p>
            <p className="mt-1 text-xs text-dwel-muted">
              Full address and Home Provider contact are shared only after approval.
            </p>
          </div>
          <button
            type="button"
            onClick={() => toggle(listing.id)}
            className="min-h-11 rounded-full border border-dwel-line bg-dwel-surface px-4 py-2 text-sm font-medium"
          >
            {isSaved(listing.id) ? 'Saved ♥' : 'Save ♡'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-dwel-muted">
          <span className="rounded-full bg-dwel-surface2 px-2 py-1">{bedLabel(listing.beds)}</span>
          <span className="rounded-full bg-dwel-surface2 px-2 py-1">
            {listing.baths} bath{listing.baths === 1 ? '' : 's'}
          </span>
          {listing.sqft != null && (
            <span className="rounded-full bg-dwel-surface2 px-2 py-1">{listing.sqft} sqft</span>
          )}
          {listing.pet_friendly && (
            <span className="rounded-full bg-dwel-surface2 px-2 py-1">Pet friendly</span>
          )}
        </div>

        <div className="flex items-baseline justify-between border-y border-dwel-line py-4">
          <span className="text-dwel-muted">Rent</span>
          <span className="text-2xl font-semibold">{formatCents(listing.rent_cents)}/mo</span>
        </div>

        <Card className="p-[18px]">
          <h2 className="text-lg font-semibold">Move-in snapshot</h2>
          <p className="mt-4 flex justify-between text-sm">
            <span className="text-dwel-muted">First month</span>
            <strong>{formatCents(listing.rent_cents)}</strong>
          </p>
          {listing.deposit_cents != null && listing.deposit_cents >= 0 ? (
            <p className="mt-2 flex justify-between text-sm">
              <span className="text-dwel-muted">Deposit</span>
              <strong>{formatCents(listing.deposit_cents)}</strong>
            </p>
          ) : null}
          {listing.cashback_cents != null && listing.cashback_cents > 0 ? (
            <>
              <p className="mt-2 flex justify-between text-sm">
                <span className="font-medium text-dwel-success">Dwel cash back</span>
                <strong className="text-dwel-success">{formatCents(listing.cashback_cents)}</strong>
              </p>
              <p className="mt-2 text-xs text-dwel-muted">
                Estimate based on 20% of first month&apos;s rent. Final amount and eligibility are
                confirmed at lease — not an unconditional payout.
              </p>
            </>
          ) : null}
        </Card>

        {listing.lease_months != null && (
          <p className="text-sm text-dwel-muted">{listing.lease_months}-mo lease</p>
        )}
        {listing.available_on && (
          <p className="text-sm text-dwel-muted">Available {listing.available_on}</p>
        )}
        {listing.description && (
          <p className="max-w-prose text-sm leading-relaxed text-dwel-muted">
            {listing.description}
          </p>
        )}

        {error && <p className="text-sm text-dwel-red">{error}</p>}

        {interestSent ? (
          <Card className="border-dwel-mint bg-dwel-mint/15 p-4 text-sm">
            Interest sent — the Home Provider will review your profile. This is not a screening
            application. Track status in{' '}
            <Link href="/applications" className="font-semibold underline">
              My applications
            </Link>
            .
          </Card>
        ) : (
          <div>
            <Button
              className="w-full bg-dwel-mint text-dwel-black shadow-none hover:bg-dwel-mint-dark sm:w-auto"
              onClick={onInterest}
              disabled={busy}
            >
              {busy ? 'Sending…' : "I'm interested"}
            </Button>
            <p className="mt-2 text-xs text-dwel-gray-500">
              Free signal to the property — no screening or payment until a Home Provider moves
              forward.
            </p>
          </div>
        )}

        <ReportListingIssue listingId={listing.id} />
      </div>
    </RenterShell>
  );
}

function ReportListingIssue({ listingId }: { listingId: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<
    | 'stale_availability'
    | 'incorrect_price'
    | 'incorrect_photos'
    | 'incorrect_address'
    | 'scam_suspected'
    | 'other_non_sensitive'
  >('stale_availability');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api.reportListingIssue(listingId, {
        category,
        note: note.trim() || undefined,
      });
      setDone(true);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not submit report.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 border-t border-dwel-line pt-4">
      {done ? (
        <p className="text-sm text-dwel-muted">Thanks — we recorded your listing report.</p>
      ) : !open ? (
        <button
          type="button"
          className="text-sm font-semibold text-dwel-muted underline"
          onClick={() => setOpen(true)}
        >
          Report an issue with this listing
        </button>
      ) : (
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">Report listing issue</h2>
          <label className="block text-sm">
            <span className="text-dwel-muted">Category</span>
            <select
              className="mt-1 w-full rounded-[10px] border border-dwel-line px-3 py-2"
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
            >
              <option value="stale_availability">Availability looks outdated</option>
              <option value="incorrect_price">Incorrect price</option>
              <option value="incorrect_photos">Incorrect photos</option>
              <option value="incorrect_address">Incorrect address</option>
              <option value="scam_suspected">Suspected scam</option>
              <option value="other_non_sensitive">Other (non-sensitive)</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-dwel-muted">Optional note</span>
            <textarea
              className="mt-1 w-full rounded-[10px] border border-dwel-line px-3 py-2"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          </label>
          {err ? <p className="text-sm text-dwel-red">{err}</p> : null}
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void submit()}>
              {busy ? 'Sending…' : 'Submit report'}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
