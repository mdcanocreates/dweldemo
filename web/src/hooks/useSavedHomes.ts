import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, type Listing } from '../api';
import { useAuth } from '../auth';
import {
  calculateApplicationSavings,
  type SavingsEstimate,
} from '../lib/applicationSavings';
import { clearGuestSavedIds, readGuestSavedIds, writeGuestSavedIds } from '../lib/guestSaved';
import { isDirectoryListing } from '../lib/publicInventory';
import type { SaveFeedback } from '../components/listings/SaveFeedbackToast';

type SavingsPayload = {
  estimate: {
    eligibleHomes: number;
    estimatedSavingsCents: number;
    completeEstimate: boolean;
  } | null;
  eligibleSaved?: number;
  savedCount: number;
  dwelApplicationFeeCents?: number;
};

export type SavedHomesState = {
  savedIds: Set<string>;
  savedCount: number;
  estimate: SavingsEstimate | null;
  estimateStatus: 'loading' | 'unavailable' | 'error' | 'ready';
  dwelFeeCents: number;
  saveFeedback: SaveFeedback | null;
  dismissSaveFeedback: () => void;
  toggleSave: (listing: Listing) => Promise<void>;
  isSaved: (listingId: string) => boolean;
  refreshing: boolean;
};

const DEFAULT_DWEL_FEE_CENTS = 4900;

function toEstimate(payload: SavingsPayload | null | undefined): SavingsEstimate | null {
  if (!payload?.estimate?.completeEstimate) return null;
  return {
    eligibleHomes: payload.estimate.eligibleHomes,
    baselineFeesCents: 0,
    dwelFeesCents: payload.dwelApplicationFeeCents ?? DEFAULT_DWEL_FEE_CENTS,
    estimatedSavingsCents: payload.estimate.estimatedSavingsCents,
    completeEstimate: true,
  };
}

function feedbackForSave(
  listing: Listing,
  savedCount: number,
  estimate: SavingsEstimate | null,
  dwelFeeCents: number,
): SaveFeedback {
  if (isDirectoryListing(listing)) {
    return { kind: 'directory', savedCount, estimate: null, dwelFeeCents };
  }
  if (!listing.reusable_application_eligible) {
    return { kind: 'unclaimed', savedCount, estimate: null, dwelFeeCents };
  }
  if (estimate?.completeEstimate) {
    return { kind: 'estimate', savedCount, estimate, dwelFeeCents };
  }
  return { kind: 'participating', savedCount, estimate: null, dwelFeeCents };
}

export function useSavedHomes(): SavedHomesState {
  const { user, loading: authLoading } = useAuth();
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set(readGuestSavedIds()));
  const [estimate, setEstimate] = useState<SavingsEstimate | null>(null);
  const [estimateStatus, setEstimateStatus] = useState<SavedHomesState['estimateStatus']>('unavailable');
  const [dwelFeeCents, setDwelFeeCents] = useState(DEFAULT_DWEL_FEE_CENTS);
  const [refreshing, setRefreshing] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback | null>(null);

  const refreshAccount = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);
    setEstimateStatus('loading');
    try {
      const guestIds = readGuestSavedIds();
      for (const listingId of guestIds) {
        try {
          await api.saveListing(listingId);
        } catch {
          // Keep going; guest id may already be saved or listing may be gone.
        }
      }
      if (guestIds.length > 0) clearGuestSavedIds();

      const data = await api.savedListings();
      setSavedIds(new Set(data.saved.map((row) => row.listing_id)));
      const savings = (data as { savings?: SavingsPayload }).savings;
      if (savings?.dwelApplicationFeeCents) setDwelFeeCents(savings.dwelApplicationFeeCents);
      const next = toEstimate(savings);
      setEstimate(next);
      setEstimateStatus(next ? 'ready' : 'unavailable');
    } catch {
      setEstimateStatus('error');
    } finally {
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setSavedIds(new Set(readGuestSavedIds()));
      setEstimate(null);
      setEstimateStatus('unavailable');
      return;
    }
    void refreshAccount();
  }, [authLoading, user, refreshAccount]);

  const dismissSaveFeedback = useCallback(() => setSaveFeedback(null), []);

  const toggleSave = useCallback(
    async (listing: Listing) => {
      const listingId = listing.id;
      const currentlySaved = savedIds.has(listingId);

      if (!user) {
        const next = new Set(savedIds);
        if (currentlySaved) {
          next.delete(listingId);
          setSavedIds(next);
          writeGuestSavedIds([...next]);
          setSaveFeedback(null);
          setEstimate(null);
          setEstimateStatus('unavailable');
          return;
        }
        next.add(listingId);
        setSavedIds(next);
        writeGuestSavedIds([...next]);
        setEstimate(null);
        setEstimateStatus('unavailable');
        setSaveFeedback(feedbackForSave(listing, next.size, null, dwelFeeCents));
        return;
      }

      try {
        if (currentlySaved) {
          const result = await api.unsaveListing(listingId);
          setSavedIds((prev) => {
            const next = new Set(prev);
            next.delete(listingId);
            return next;
          });
          const savings = (result as { savings?: SavingsPayload }).savings;
          if (savings?.dwelApplicationFeeCents) setDwelFeeCents(savings.dwelApplicationFeeCents);
          const nextEstimate = toEstimate(savings);
          setEstimate(nextEstimate);
          setEstimateStatus(nextEstimate ? 'ready' : 'unavailable');
          setSaveFeedback(null);
        } else {
          const result = await api.saveListing(listingId);
          const nextCount = savedIds.size + 1;
          setSavedIds((prev) => new Set(prev).add(listingId));
          if (result.savings?.dwelApplicationFeeCents) {
            setDwelFeeCents(result.savings.dwelApplicationFeeCents);
          }
          const nextEstimate = toEstimate(result.savings);
          setEstimate(nextEstimate);
          setEstimateStatus(nextEstimate ? 'ready' : 'unavailable');
          setSaveFeedback(
            feedbackForSave(
              listing,
              result.savings?.savedCount ?? nextCount,
              nextEstimate,
              result.savings?.dwelApplicationFeeCents ?? dwelFeeCents,
            ),
          );
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          const next = new Set(savedIds);
          if (currentlySaved) next.delete(listingId);
          else next.add(listingId);
          setSavedIds(next);
          writeGuestSavedIds([...next]);
          if (!currentlySaved) {
            setSaveFeedback(feedbackForSave(listing, next.size, null, dwelFeeCents));
          }
          return;
        }
        setEstimateStatus('error');
        throw err;
      }
    },
    [savedIds, user, dwelFeeCents],
  );

  const isSaved = useCallback((listingId: string) => savedIds.has(listingId), [savedIds]);

  return useMemo(
    () => ({
      savedIds,
      savedCount: savedIds.size,
      estimate,
      estimateStatus,
      dwelFeeCents,
      saveFeedback,
      dismissSaveFeedback,
      toggleSave,
      isSaved,
      refreshing,
    }),
    [
      savedIds,
      estimate,
      estimateStatus,
      dwelFeeCents,
      saveFeedback,
      dismissSaveFeedback,
      toggleSave,
      isSaved,
      refreshing,
    ],
  );
}

/** Local estimate from currently loaded listing fee fields (signed-in list pages). */
export function estimateFromListings(
  listings: readonly Listing[],
  savedIds: ReadonlySet<string>,
  dwelTotalFeeCents: number | null,
): SavingsEstimate | null {
  const candidates = listings
    .filter((listing) => savedIds.has(listing.id))
    .filter((listing) => !isDirectoryListing(listing))
    .map((listing) => ({
      listingId: listing.id,
      eligibleForReuse: Boolean(listing.reusable_application_eligible),
      applicationFeeCents:
        listing.application_fee_cents == null ? null : Number(listing.application_fee_cents),
    }));
  return calculateApplicationSavings(candidates, dwelTotalFeeCents);
}
