import type { ListingSearchParams } from '../types';

export type LocationType = 'city' | 'neighborhood' | 'zip' | 'county' | 'state' | 'region';

export type SearchLocation = {
  label: string;
  type: LocationType;
  city?: string;
  county?: string;
  state?: string;
  postalCode?: string;
  placeId?: string;
  bounds?: { north: number; south: number; east: number; west: number };
};

export type SearchState = {
  location?: SearchLocation;
  moveInDate?: string;
  /** Monthly rent in whole dollars (URL-friendly). */
  minRent?: number;
  maxRent?: number;
  beds?: string[];
  baths?: string[];
  propertyTypes?: string[];
  amenities?: string[];
  petFriendly?: boolean;
  parking?: boolean;
  incentiveAvailable?: boolean;
};

const STATE_NAMES: Record<string, string> = {
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

const STATE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([name, code]) => [code, name.replace(/\b\w/g, (c) => c.toUpperCase())]),
);

/** Known places for free-text resolution (expandable). */
const KNOWN_PLACES: SearchLocation[] = [
  { label: 'Austin, TX', type: 'city', city: 'Austin', state: 'TX' },
  { label: 'Houston, TX', type: 'city', city: 'Houston', state: 'TX' },
  { label: 'Dallas, TX', type: 'city', city: 'Dallas', state: 'TX' },
  { label: 'San Antonio, TX', type: 'city', city: 'San Antonio', state: 'TX' },
  { label: 'Los Angeles, CA', type: 'city', city: 'Los Angeles', state: 'CA' },
  { label: 'San Francisco, CA', type: 'city', city: 'San Francisco', state: 'CA' },
  { label: 'Miami, FL', type: 'city', city: 'Miami', state: 'FL' },
  { label: 'Orlando, FL', type: 'city', city: 'Orlando', state: 'FL' },
  { label: 'Tampa, FL', type: 'city', city: 'Tampa', state: 'FL' },
  { label: 'Palm Beach County, FL', type: 'county', county: 'Palm Beach County', state: 'FL' },
  { label: 'Downtown Austin', type: 'neighborhood', city: 'Austin', state: 'TX' },
  { label: 'East Austin', type: 'neighborhood', city: 'Austin', state: 'TX' },
  { label: 'South Austin', type: 'neighborhood', city: 'Austin', state: 'TX' },
  { label: 'South Congress', type: 'neighborhood', city: 'Austin', state: 'TX' },
  { label: 'Texas', type: 'state', state: 'TX' },
  { label: 'Florida', type: 'state', state: 'FL' },
  { label: 'California', type: 'state', state: 'CA' },
];

export function resolveLocationInput(raw: string): SearchLocation | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const lower = trimmed.toLowerCase().replace(/\s+/g, ' ');

  // ZIP
  if (/^\d{5}(-\d{4})?$/.test(trimmed)) {
    return { label: trimmed.slice(0, 5), type: 'zip', postalCode: trimmed.slice(0, 5) };
  }

  // Exact / prefix known place
  const known =
    KNOWN_PLACES.find((p) => p.label.toLowerCase() === lower) ??
    KNOWN_PLACES.find((p) => p.label.toLowerCase().startsWith(lower));
  if (known) return { ...known };

  // State name or code alone
  if (STATE_NAMES[lower]) {
    const code = STATE_NAMES[lower];
    return { label: STATE_LABEL[code] ?? code, type: 'state', state: code };
  }
  if (/^[A-Za-z]{2}$/.test(trimmed) && STATE_LABEL[trimmed.toUpperCase()]) {
    const code = trimmed.toUpperCase();
    return { label: STATE_LABEL[code] ?? code, type: 'state', state: code };
  }

  // "City, ST"
  const cityState = trimmed.match(/^(.+?),\s*([A-Za-z]{2})$/);
  if (cityState) {
    const city = cityState[1]!.trim();
    const state = cityState[2]!.toUpperCase();
    if (/county$/i.test(city)) {
      return { label: `${city}, ${state}`, type: 'county', county: city, state };
    }
    return { label: `${city}, ${state}`, type: 'city', city, state };
  }

  // County phrase
  if (/county/i.test(trimmed)) {
    return { label: trimmed, type: 'county', county: trimmed };
  }

  // Fallback: treat as city label (substring match in filter)
  return { label: trimmed, type: 'city', city: trimmed };
}

export function parseSearchState(search: string | URLSearchParams): SearchState {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const state: SearchState = {};

  const locationLabel = q.get('location') ?? undefined;
  const locationType = (q.get('locationType') as LocationType | null) ?? undefined;
  const city = q.get('city') ?? undefined;
  const county = q.get('county') ?? undefined;
  const st = q.get('state') ?? undefined;
  const postal = q.get('postalCode') ?? q.get('zip') ?? undefined;

  if (locationLabel || city || county || st || postal) {
    if (locationLabel && !locationType && !city && !county && !st && !postal) {
      state.location = resolveLocationInput(locationLabel);
    } else {
      const type: LocationType =
        locationType ??
        (postal ? 'zip' : county ? 'county' : !city && st ? 'state' : 'city');
      const label =
        locationLabel ??
        (type === 'state' && st
          ? STATE_LABEL[st] ?? st
          : type === 'county' && county
            ? st
              ? `${county}, ${st}`
              : county
            : type === 'zip' && postal
              ? postal
              : city && st
                ? `${city}, ${st}`
                : locationLabel ?? city ?? county ?? st ?? '');
      state.location = {
        label,
        type,
        city,
        county,
        state: st,
        postalCode: postal,
      };
    }
  }

  const moveIn = q.get('moveInDate') ?? q.get('move_in') ?? undefined;
  if (moveIn) state.moveInDate = moveIn;

  const minRent = q.get('minRent') ?? q.get('price_min');
  if (minRent) {
    const n = Number(minRent);
    // Accept cents legacy (>10000) or dollars
    state.minRent = n > 10_000 ? Math.round(n / 100) : n;
  }
  const maxRent = q.get('maxRent') ?? q.get('price_max');
  if (maxRent) {
    const n = Number(maxRent);
    state.maxRent = n > 10_000 ? Math.round(n / 100) : n;
  }

  const beds = q.get('beds');
  if (beds) state.beds = beds.split(',').map((b) => b.trim()).filter(Boolean);

  const baths = q.get('baths');
  if (baths) state.baths = baths.split(',').map((b) => b.trim()).filter(Boolean);

  const propertyTypes = q.get('propertyTypes') ?? q.get('property_type');
  if (propertyTypes) {
    state.propertyTypes = propertyTypes.split(',').map((b) => b.trim()).filter(Boolean);
  }

  if (q.get('petFriendly') === 'true' || q.get('pet_friendly') === '1') {
    state.petFriendly = true;
  }
  if (q.get('parking') === 'true' || q.get('parking') === '1') {
    state.parking = true;
  }
  if (q.get('incentiveAvailable') === 'true' || q.get('incentive') === '1') {
    state.incentiveAvailable = true;
  }

  return state;
}

export function serializeSearchState(state: SearchState): URLSearchParams {
  const q = new URLSearchParams();
  if (state.location) {
    q.set('location', state.location.label);
    q.set('locationType', state.location.type);
    if (state.location.city) q.set('city', state.location.city);
    if (state.location.county) q.set('county', state.location.county);
    if (state.location.state) q.set('state', state.location.state);
    if (state.location.postalCode) q.set('postalCode', state.location.postalCode);
  }
  if (state.moveInDate) q.set('moveInDate', state.moveInDate);
  if (state.minRent != null) q.set('minRent', String(state.minRent));
  if (state.maxRent != null) q.set('maxRent', String(state.maxRent));
  if (state.beds?.length) q.set('beds', state.beds.join(','));
  if (state.baths?.length) q.set('baths', state.baths.join(','));
  if (state.propertyTypes?.length) q.set('propertyTypes', state.propertyTypes.join(','));
  if (state.petFriendly) q.set('petFriendly', 'true');
  if (state.parking) q.set('parking', 'true');
  if (state.incentiveAvailable) q.set('incentiveAvailable', 'true');
  return q;
}

export function buildSearchUrl(state: SearchState): string {
  const qs = serializeSearchState(state).toString();
  return qs ? `/search?${qs}` : '/search';
}

/** Convert canonical SearchState → legacy ListingSearchParams for filterListings. */
export function searchStateToParams(state: SearchState): ListingSearchParams {
  const beds = state.beds
    ?.map((b) => {
      if (b === 'studio' || b === '0') return 0;
      if (b === '3+' || b === '3') return 3;
      const n = Number(b);
      return Number.isNaN(n) ? undefined : n;
    })
    .filter((n): n is number => n !== undefined);

  const baths = state.baths
    ?.map((b) => {
      const t = b.trim();
      if (t.endsWith('+')) {
        const n = Number(t.slice(0, -1));
        return Number.isNaN(n) ? undefined : n;
      }
      const n = Number(t);
      return Number.isNaN(n) ? undefined : n;
    })
    .filter((n): n is number => n !== undefined);

  return {
    location: state.location?.label,
    locationType: state.location?.type,
    city: state.location?.city,
    county: state.location?.county,
    state: state.location?.state,
    postal_code: state.location?.postalCode,
    beds: beds?.length ? beds : undefined,
    baths: baths?.length ? baths : undefined,
    price_min: state.minRent != null ? state.minRent * 100 : undefined,
    price_max: state.maxRent != null ? state.maxRent * 100 : undefined,
    available_after: state.moveInDate,
    pet_friendly: state.petFriendly || undefined,
    parking: state.parking || undefined,
    move_in_incentive: state.incentiveAvailable || undefined,
    property_type: state.propertyTypes,
  };
}

export function paramsToSearchState(params: ListingSearchParams): SearchState {
  const state: SearchState = {};
  if (params.location || params.city || params.county || params.state || params.postal_code) {
    if (params.locationType || params.city || params.county || params.state || params.postal_code) {
      state.location = {
        label:
          params.location ??
          (params.city && params.state
            ? `${params.city}, ${params.state}`
            : params.county && params.state
              ? `${params.county}, ${params.state}`
              : params.state
                ? STATE_LABEL[params.state] ?? params.state
                : params.postal_code ?? ''),
        type: params.locationType ?? (params.postal_code ? 'zip' : params.county ? 'county' : !params.city && params.state ? 'state' : 'city'),
        city: params.city,
        county: params.county,
        state: params.state,
        postalCode: params.postal_code,
      };
    } else if (params.location) {
      state.location = resolveLocationInput(params.location);
    }
  }
  if (params.available_after) state.moveInDate = params.available_after;
  if (params.price_min != null) state.minRent = Math.round(params.price_min / 100);
  if (params.price_max != null) state.maxRent = Math.round(params.price_max / 100);
  if (params.beds?.length) state.beds = params.beds.map(String);
  if (params.baths?.length) state.baths = params.baths.map(String);
  if (params.property_type?.length) state.propertyTypes = params.property_type;
  if (params.pet_friendly) state.petFriendly = true;
  if (params.parking) state.parking = true;
  if (params.move_in_incentive) state.incentiveAvailable = true;
  return state;
}

export function searchHeading(state: SearchState, count: number | null): string {
  const place = state.location?.label;
  if (!place) return 'Browse homes';
  if (count == null) return `Homes in ${place}`;
  const noun = count === 1 ? 'home' : 'homes';
  return `${count} ${noun} in ${place}`;
}

export function isSearchStateActive(state: SearchState): boolean {
  return Boolean(
    state.location ||
      state.moveInDate ||
      state.minRent != null ||
      state.maxRent != null ||
      state.beds?.length ||
      state.baths?.length ||
      state.propertyTypes?.length ||
      state.amenities?.length ||
      state.petFriendly ||
      state.parking ||
      state.incentiveAvailable,
  );
}

export type SearchChip = { key: string; label: string; clear: (s: SearchState) => SearchState };

export function activeSearchChips(state: SearchState): SearchChip[] {
  const chips: SearchChip[] = [];
  if (state.location) {
    chips.push({
      key: 'location',
      label: state.location.label,
      clear: (s) => ({ ...s, location: undefined }),
    });
  }
  if (state.moveInDate) {
    chips.push({
      key: 'moveIn',
      label: `Move-in ${state.moveInDate}`,
      clear: (s) => ({ ...s, moveInDate: undefined }),
    });
  }
  if (state.minRent != null || state.maxRent != null) {
    const label =
      state.minRent != null && state.maxRent != null
        ? `$${state.minRent.toLocaleString()}–$${state.maxRent.toLocaleString()}`
        : state.maxRent != null
          ? `Under $${state.maxRent.toLocaleString()}`
          : `From $${state.minRent!.toLocaleString()}`;
    chips.push({
      key: 'rent',
      label,
      clear: (s) => ({ ...s, minRent: undefined, maxRent: undefined }),
    });
  }
  if (state.beds?.length) {
    const bedLabel = state.beds
      .map((b) => (b === '0' ? 'Studio' : b === '3+' || b === '3' ? '3+ Beds' : `${b} Beds`))
      .join(', ');
    chips.push({
      key: 'beds',
      label: bedLabel,
      clear: (s) => ({ ...s, beds: undefined }),
    });
  }
  if (state.baths?.length) {
    chips.push({
      key: 'baths',
      label: `${state.baths.join(', ')} Baths`,
      clear: (s) => ({ ...s, baths: undefined }),
    });
  }
  if (state.propertyTypes?.length) {
    chips.push({
      key: 'type',
      label: state.propertyTypes.join(', '),
      clear: (s) => ({ ...s, propertyTypes: undefined }),
    });
  }
  if (state.petFriendly) {
    chips.push({
      key: 'pets',
      label: 'Pet friendly',
      clear: (s) => ({ ...s, petFriendly: undefined }),
    });
  }
  if (state.parking) {
    chips.push({
      key: 'parking',
      label: 'Parking',
      clear: (s) => ({ ...s, parking: undefined }),
    });
  }
  if (state.incentiveAvailable) {
    chips.push({
      key: 'incentive',
      label: 'Move-in incentive',
      clear: (s) => ({ ...s, incentiveAvailable: undefined }),
    });
  }
  return chips;
}

export function locationSuggestions(query: string, limit = 8): SearchLocation[] {
  const q = query.trim().toLowerCase();
  if (!q) return KNOWN_PLACES.filter((p) => p.type === 'city' || p.type === 'state').slice(0, limit);
  return KNOWN_PLACES.filter((p) => p.label.toLowerCase().includes(q)).slice(0, limit);
}
