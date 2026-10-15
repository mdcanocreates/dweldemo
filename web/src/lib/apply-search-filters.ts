import type { Listing, MatchReason } from '../types';
import type { SearchLocation, SearchState } from './search-state';

export function normalizeText(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
};

export function normalizeState(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const t = value.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return STATE_NAME_TO_CODE[normalizeText(t)] ?? t.toUpperCase();
}

/** Map UI bed tokens → numeric bed counts. "3+" means beds >= 3. */
function bedTokensToMatcher(beds: string[]): (listingBeds: number) => boolean {
  const exact = new Set<number>();
  let min3 = false;
  for (const raw of beds) {
    const b = normalizeText(raw);
    if (b === 'studio' || b === '0') exact.add(0);
    else if (b === '3+' || b === '3') min3 = true;
    else {
      const n = Number(b);
      if (!Number.isNaN(n)) {
        if (n >= 3) min3 = true;
        else exact.add(n);
      }
    }
  }
  return (listingBeds) => {
    if (min3 && listingBeds >= 3) return true;
    return exact.has(listingBeds);
  };
}

/**
 * Bath UI tokens → minimum baths.
 * "3+" → >= 3; "1.5" → >= 1.5; "2" → >= 2
 */
export function bathTokenToMin(token: string): number | undefined {
  const t = normalizeText(token);
  if (!t) return undefined;
  if (t.endsWith('+')) {
    const n = Number(t.slice(0, -1));
    return Number.isNaN(n) ? undefined : n;
  }
  const n = Number(t);
  return Number.isNaN(n) ? undefined : n;
}

export function filterByLocation(
  listings: Listing[],
  location: SearchLocation | undefined,
): Listing[] {
  if (!location) return listings;

  const type = location.type;
  const city = normalizeText(location.city);
  const county = normalizeText(location.county);
  const state = normalizeState(location.state);
  const zip = location.postalCode?.trim();
  const label = normalizeText(location.label);

  return listings.filter((listing) => {
    const lCity = normalizeText(listing.city);
    const lState = normalizeState(listing.state);
    const lCounty = normalizeText(listing.county);
    const lZip = listing.postal_code?.trim() ?? '';
    const lNeighborhood = normalizeText(listing.neighborhood);

    switch (type) {
      case 'state':
      case 'region':
        return Boolean(state && lState === state);

      case 'county':
        if (!county) return false;
        if (state && lState !== state) return false;
        if (lCounty === county) return true;
        // allow "Palm Beach" to match "Palm Beach County"
        return (
          lCounty.includes(county.replace(/ county$/, '')) ||
          county.replace(/ county$/, '') === lCounty.replace(/ county$/, '')
        );

      case 'zip':
        return Boolean(zip && lZip === zip);

      case 'neighborhood': {
        if (state && lState !== state) return false;
        if (city && lCity !== city) return false;
        if (!city && !state) return false;
        // Prefer neighborhood match; if listing has no neighborhood, city+state is enough
        if (!listing.neighborhood) return Boolean(city || state);
        const needle = label || city;
        return (
          lNeighborhood.includes(needle) ||
          needle.includes(lNeighborhood) ||
          lNeighborhood.includes(city)
        );
      }

      case 'city':
      default: {
        // City searches MUST match city (+ state when present). Never state-only.
        if (city) {
          if (lCity !== city) return false;
          if (state && lState !== state) return false;
          return true;
        }
        // Free-text fallback only when structured city is missing
        if (!label) return false;
        const hay = normalizeText(
          `${listing.city} ${listing.state} ${listing.postal_code} ${listing.county ?? ''} ${listing.neighborhood ?? ''}`,
        );
        return hay.includes(label) || lCity.includes(label);
      }
    }
  });
}

export function filterByRent(
  listings: Listing[],
  minRent: number | undefined,
  maxRent: number | undefined,
): Listing[] {
  return listings.filter((listing) => {
    const dollars = listing.rent_cents / 100;
    if (minRent != null && dollars < minRent) return false;
    if (maxRent != null && dollars > maxRent) return false;
    return true;
  });
}

export function filterByBeds(listings: Listing[], beds: string[] | undefined): Listing[] {
  if (!beds?.length) return listings;
  const match = bedTokensToMatcher(beds);
  return listings.filter((l) => match(l.beds));
}

export function filterByBaths(listings: Listing[], baths: string[] | undefined): Listing[] {
  if (!baths?.length) return listings;
  const mins = baths.map(bathTokenToMin).filter((n): n is number => n != null);
  if (!mins.length) return listings;
  const minBath = Math.min(...mins);
  return listings.filter((l) => l.baths >= minBath);
}

export function filterByType(
  listings: Listing[],
  propertyTypes: string[] | undefined,
): Listing[] {
  if (!propertyTypes?.length) return listings;
  const wanted = new Set(propertyTypes.map(normalizeText));
  return listings.filter(
    (l) => l.property_type != null && wanted.has(normalizeText(l.property_type)),
  );
}

export function filterByPets(
  listings: Listing[],
  petFriendly: boolean | undefined,
): Listing[] {
  if (!petFriendly) return listings;
  return listings.filter((l) => l.pet_friendly === true);
}

export function filterByParking(
  listings: Listing[],
  parking: boolean | undefined,
): Listing[] {
  if (!parking) return listings;
  return listings.filter((l) => l.parking === true);
}

export function filterByIncentive(
  listings: Listing[],
  incentiveAvailable: boolean | undefined,
): Listing[] {
  if (!incentiveAvailable) return listings;
  return listings.filter((l) => l.concession_available === true);
}

/**
 * Move-in date: demo fixtures have `available_on` (unit available on date).
 * Keep listings whose available_on is on or before the selected move-in date
 * (renter can move in then), OR listings with no available_on set.
 * If neither side has dates, do not invent matches — leave unfiltered only when
 * moveInDate is unset.
 */
export function filterByMoveIn(
  listings: Listing[],
  moveInDate: string | undefined,
): { listings: Listing[]; unsupported: boolean } {
  if (!moveInDate) return { listings, unsupported: false };
  // Fixtures support available_on — filter when present
  const out = listings.filter((l) => {
    if (!l.available_on) return true;
    return l.available_on <= moveInDate;
  });
  return { listings: out, unsupported: false };
}

export type ApplySearchFiltersResult = {
  listings: Listing[];
  reasonsById: Record<string, MatchReason[]>;
  debug?: {
    rawCount: number;
    stages: Record<string, number>;
    unsupported: string[];
  };
};

/**
 * ONE filtering pipeline. Never render raw listings on /search.
 * Empty is a valid result — never fall back to the full inventory.
 */
export function applySearchFilters(
  listings: Listing[],
  state: SearchState,
): ApplySearchFiltersResult {
  const live = listings.filter((l) => l.status === 'LIVE' || l.status === 'active');
  const stages: Record<string, number> = { raw: live.length };
  const unsupported: string[] = [];

  let results = live;
  results = filterByLocation(results, state.location);
  stages.location = results.length;

  results = filterByRent(results, state.minRent, state.maxRent);
  stages.rent = results.length;

  results = filterByBeds(results, state.beds);
  stages.beds = results.length;

  results = filterByBaths(results, state.baths);
  stages.baths = results.length;

  results = filterByType(results, state.propertyTypes);
  stages.type = results.length;

  results = filterByPets(results, state.petFriendly);
  stages.pets = results.length;

  results = filterByParking(results, state.parking);
  stages.parking = results.length;

  results = filterByIncentive(results, state.incentiveAvailable);
  stages.incentive = results.length;

  const move = filterByMoveIn(results, state.moveInDate);
  results = move.listings;
  stages.moveIn = results.length;
  if (move.unsupported) unsupported.push('moveInDate');

  const reasonsById: Record<string, MatchReason[]> = {};
  for (const l of results) {
    const reasons: MatchReason[] = [];
    if (state.location?.city) {
      reasons.push({ field: 'city', op: 'eq', value: state.location.city });
    } else if (state.location?.state) {
      reasons.push({ field: 'state', op: 'eq', value: state.location.state });
    }
    if (state.beds?.length) reasons.push({ field: 'beds', op: 'in', value: state.beds.map(Number).filter((n) => !Number.isNaN(n)) });
    if (state.maxRent != null) reasons.push({ field: 'rent', op: 'lte', value: state.maxRent * 100 });
    if (state.minRent != null) reasons.push({ field: 'rent', op: 'gte', value: state.minRent * 100 });
    if (state.petFriendly) reasons.push({ field: 'pet_friendly', op: 'eq', value: true });
    if (state.parking) reasons.push({ field: 'parking', op: 'eq', value: true });
    reasonsById[l.id] = reasons;
  }

  return {
    listings: results,
    reasonsById,
    debug: { rawCount: live.length, stages, unsupported },
  };
}
