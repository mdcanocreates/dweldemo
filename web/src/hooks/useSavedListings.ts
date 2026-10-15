import { useCallback, useEffect, useState } from 'react';
import { api, getSessionToken } from '../api/client';
import { isUiPreviewActive } from '../lib/ui-preview';

const ANON_KEY = 'dwel.saved.anon.v1';
const AUTH_KEY = 'dwel.saved.v1';
const INTEREST_KEY = 'dwel.interest.v1';

function readIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

/** Merge anonymous local saves into authenticated store; clear anon after. */
export function mergeAnonymousSaves(): string[] {
  const anon = readIds(ANON_KEY);
  const auth = readIds(AUTH_KEY);
  const merged = [...new Set([...anon, ...auth])];
  writeIds(AUTH_KEY, merged);
  writeIds(ANON_KEY, []);
  return merged;
}

export function useSavedListings() {
  const authed = Boolean(getSessionToken());
  const storageKey = authed ? AUTH_KEY : ANON_KEY;
  const [savedIds, setSavedIds] = useState<string[]>(() => {
    if (authed) return mergeAnonymousSaves();
    return readIds(ANON_KEY);
  });
  const [toast, setToast] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Cache overlay for offline / optimistic UI
  useEffect(() => {
    writeIds(storageKey, savedIds);
  }, [savedIds, storageKey]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Server is source of truth when authenticated
  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    void (async () => {
      setSyncing(true);
      try {
        const local = mergeAnonymousSaves();
        // Push local-only ids to server (best-effort)
        for (const id of local) {
          try {
            await api.addSavedListing(id);
          } catch {
            /* ignore per-id failures */
          }
        }
        const res = await api.listSavedListings();
        if (cancelled) return;
        const ids = res.saved.map((s) => s.listing_id);
        setSavedIds(ids);
        writeIds(AUTH_KEY, ids);
      } catch {
        /* keep local cache if API unavailable */
      } finally {
        if (!cancelled) setSyncing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authed]);

  const isSaved = useCallback((id: string) => savedIds.includes(id), [savedIds]);

  const toggle = useCallback(
    (id: string) => {
      const currentlySaved = savedIds.includes(id);
      setSavedIds((prev) =>
        currentlySaved ? prev.filter((x) => x !== id) : [...prev, id],
      );

      if (!getSessionToken() && !isUiPreviewActive()) {
        if (!currentlySaved) {
          setToast('Saved on this device. Sign in to keep your saved homes everywhere.');
        }
        return;
      }

      void (async () => {
        try {
          if (currentlySaved) await api.removeSavedListing(id);
          else await api.addSavedListing(id);
        } catch {
          // Revert on failure
          setSavedIds((prev) => {
            if (currentlySaved) {
              return prev.includes(id) ? prev : [...prev, id];
            }
            return prev.filter((x) => x !== id);
          });
          setToast('Could not update saved homes. Try again.');
        }
      })();
    },
    [savedIds],
  );

  return {
    savedIds,
    isSaved,
    toggle,
    count: savedIds.length,
    toast,
    clearToast: () => setToast(null),
    syncing,
  };
}

export function useInterest() {
  const [ids, setIds] = useState<string[]>(() => readIds(INTEREST_KEY));

  useEffect(() => {
    writeIds(INTEREST_KEY, ids);
  }, [ids]);

  const hasInterest = useCallback((id: string) => ids.includes(id), [ids]);

  const mark = useCallback((id: string) => {
    setIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  return { interestIds: ids, hasInterest, mark };
}
