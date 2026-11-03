import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, type Listing } from '../api';
import { useAuth } from '../auth';
import {
  calculateApplicationSavings,
  type SavingsEstimate,
} from '../lib/applicationSavings';
import { clearGuestSavedIds, readGuestSavedIds, writeGuestSavedIds } from '../lib/guestSaved';
import { shouldShowSavingsPanel } from '../lib/marketplacePreservation';
import { savingsEstimateEnabled } from '../lib/listingFeatures';

type SavingsPayload = {
  estimate: {
    eligibleHomes: number;
    estimatedSavingsCents: number;
    completeEstimate: boolean;
  } | null;
  eligibleSaved?: number;
  savedCount: number;
};

export type SavedHomesState = {
  savedIds: Set<string>;
  savedCount: number;
  estimate: SavingsEstimate | null;
  estimateStatus: 'loading' | 'unavailable' | 'error' | 'ready';
  savingsPanelVisible: boolean;
  dismissSavings: () => void;
  toggleSave: (listing: Listing) => Promise<void>;
  isSaved: (listingId: string) => boolean;
  refreshing: boolean;
};

function toEstimate(payload: SavingsPayload | null | undefined): SavingsEstimate | null {
  if (!payload?.estimate?.completeEstimate) return null;
  return {
    eligibleHomes: payload.estimate.eligibleHomes,
    baselineFeesCents: 0,
    dwelFeesCents: 0,
    estimatedSavingsCents: payload.estimate.estimatedSavingsCents,
    completeEstimate: true,
  };
}

export function useSavedHomes(): SavedHomesState {
  const { user, loading: authLoading } = useAuth();
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set(readGuestSavedIds()));
  const [estimate, setEstimate] = useState<SavingsEstimate | null>(null);
  const [estimateStatus, setEstimateStatus] = useState<SavedHomesState['estimateStatus']>('unavailable');
  const [refreshing, setRefreshing] = useState(false);
  const [savingsDismissed, setSavingsDismissed] = useState(false);

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

  const toggleSave = useCallback(
    async (listing: Listing) => {
      const listingId = listing.id;
      const currentlySaved = savedIds.has(listingId);

      if (!user) {
        const next = new Set(savedIds);
        if (currentlySaved) next.delete(listingId);
        else {
          next.add(listingId);
          setSavingsDismissed(false);
        }
        setSavedIds(next);
        writeGuestSavedIds([...next]);
        // Guests can save, but fee savings require signed-in verified fee data.
        setEstimate(null);
        setEstimateStatus('unavailable');
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
          const nextEstimate = toEstimate(savings);
          setEstimate(nextEstimate);
          setEstimateStatus(nextEstimate ? 'ready' : 'unavailable');
        } else {
          const result = await api.saveListing(listingId);
          setSavedIds((prev) => new Set(prev).add(listingId));
          setSavingsDismissed(false);
          const nextEstimate = toEstimate(result.savings);
          setEstimate(nextEstimate);
          setEstimateStatus(nextEstimate ? 'ready' : 'unavailable');
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          // Fall back to guest save if session expired mid-click.
          const next = new Set(savedIds);
          if (currentlySaved) next.delete(listingId);
          else {
            next.add(listingId);
            setSavingsDismissed(false);
          }
          setSavedIds(next);
          writeGuestSavedIds([...next]);
          return;
        }
        setEstimateStatus('error');
        throw err;
      }
    },
    [savedIds, user],
  );

  const isSaved = useCallback((listingId: string) => savedIds.has(listingId), [savedIds]);
  const dismissSavings = useCallback(() => setSavingsDismissed(true), []);

  const savingsPanelVisible = shouldShowSavingsPanel({
    enabled: savingsEstimateEnabled(),
    savedCount: savedIds.size,
    dismissed: savingsDismissed,
  });

  return useMemo(
    () => ({
      savedIds,
      savedCount: savedIds.size,
      estimate,
      estimateStatus,
      savingsPanelVisible,
      dismissSavings,
      toggleSave,
      isSaved,
      refreshing,
    }),
    [
      savedIds,
      estimate,
      estimateStatus,
      savingsPanelVisible,
      dismissSavings,
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
    .map((listing) => ({
      listingId: listing.id,
      eligibleForReuse: Boolean(listing.reusable_application_eligible),
      applicationFeeCents:
        listing.application_fee_cents == null ? null : Number(listing.application_fee_cents),
    }));
  return calculateApplicationSavings(candidates, dwelTotalFeeCents);
}
