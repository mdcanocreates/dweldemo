/**
 * Custom hash routing that keeps search params IN the hash:
 *   #/search?location=Austin%2C%20TX&beds=2
 *
 * wouter's built-in useHashLocation puts `?query` on `window.location.search`
 * and does not clear it when navigating to a path without query — which broke
 * Search submit, Clear filters, and shareable URLs.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

type NavOpts = { replace?: boolean };

let listeners: Array<() => void> = [];

function emit() {
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void) {
  listeners.push(cb);
  if (listeners.length === 1) {
    window.addEventListener('hashchange', emit);
    window.addEventListener('popstate', emit);
  }
  return () => {
    listeners = listeners.filter((x) => x !== cb);
    if (listeners.length === 0) {
      window.removeEventListener('hashchange', emit);
      window.removeEventListener('popstate', emit);
    }
  };
}

function readFullHashLocation(): string {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return '/' + raw;
}

function readPathOnly(): string {
  const full = readFullHashLocation();
  const q = full.indexOf('?');
  return (q >= 0 ? full.slice(0, q) : full) || '/';
}

export function navigateHash(to: string, opts: NavOpts = {}) {
  const cleaned = to.replace(/^#/, '').replace(/^\//, '');
  const nextHash = '#/' + cleaned;
  const oldURL = window.location.href;
  const base = `${window.location.origin}${window.location.pathname}`;
  // Keep query inside the hash; clear document search so params don't leak/stale.
  const newURL = `${base}${nextHash}`;

  if (opts.replace) {
    window.history.replaceState(null, '', newURL);
  } else {
    window.history.pushState(null, '', newURL);
  }

  const event =
    typeof HashChangeEvent !== 'undefined'
      ? new HashChangeEvent('hashchange', { oldURL, newURL })
      : new Event('hashchange');
  window.dispatchEvent(event);
  emit();
}

export function useAppHashLocation(): [string, (to: string, opts?: NavOpts) => void] {
  const path = useSyncExternalStore(subscribe, readPathOnly, () => '/');
  const navigate = useCallback((to: string, opts?: NavOpts) => {
    navigateHash(to, opts);
  }, []);
  return [path, navigate];
}

/** Query string from inside the hash (`#/search?a=1` → `a=1`). */
export function readAppSearch(): string {
  try {
    const hash = window.location.hash;
    const q = hash.indexOf('?');
    if (q >= 0) return hash.slice(q + 1);
    return window.location.search.replace(/^\?/, '');
  } catch {
    return '';
  }
}

export function useHashSearch(): string {
  const [search, setSearch] = useState(readAppSearch);
  useEffect(() => subscribe(() => setSearch(readAppSearch())), []);
  return search;
}
