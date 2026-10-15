import {
  buildSearchUrl,
  resolveLocationInput,
  type SearchState,
} from './search-state';

const KEY = 'dwel.discovery.v1';

/** Level 0 — anonymous search criteria (design3.md). Not a server profile. */
export type DiscoveryState = {
  bedrooms: string[]; // studio | 1 | 2 | 3+
  locations: string[];
  budget_max: number;
  budget_min?: number;
  move_timing: 'asap' | '30_days' | '1_3_months' | 'pick_date';
  move_in_date?: string;
  must_haves: string[];
};

export function loadDiscovery(): DiscoveryState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DiscoveryState) : null;
  } catch {
    return null;
  }
}

export function saveDiscovery(state: DiscoveryState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function discoveryToSearchState(state: DiscoveryState): SearchState {
  const bedMap: Record<string, string> = {
    studio: '0',
    '1': '1',
    '2': '2',
    '3+': '3',
  };
  const beds = state.bedrooms.map((b) => bedMap[b]).filter(Boolean);

  let moveInDate: string | undefined;
  const today = new Date();
  if (state.move_timing === 'asap') {
    moveInDate = today.toISOString().slice(0, 10);
  } else if (state.move_timing === '30_days') {
    const d = new Date(today);
    d.setDate(d.getDate() + 30);
    moveInDate = d.toISOString().slice(0, 10);
  } else if (state.move_timing === '1_3_months') {
    const d = new Date(today);
    d.setMonth(d.getMonth() + 1);
    moveInDate = d.toISOString().slice(0, 10);
  } else if (state.move_in_date) {
    moveInDate = state.move_in_date;
  }

  const locRaw = state.locations[0];
  const location = locRaw ? resolveLocationInput(locRaw) : undefined;

  return {
    location,
    beds: beds.length ? beds : undefined,
    minRent: state.budget_min,
    maxRent: state.budget_max,
    moveInDate,
    petFriendly: state.must_haves.includes('Pet friendly') || undefined,
    parking: state.must_haves.includes('Parking') || undefined,
  };
}

export function discoveryToSearchUrl(state: DiscoveryState): string {
  return buildSearchUrl(discoveryToSearchState(state));
}

/** @deprecated use discoveryToSearchUrl */
export function discoveryToSearchQuery(state: DiscoveryState): string {
  const url = discoveryToSearchUrl(state);
  return url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
}
