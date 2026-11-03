/** Small local city gazetteer for initial map centering — no remote geocoder. */
export type CityCenter = {
  name: string;
  state?: string;
  latitude: number;
  longitude: number;
  zoom: number;
};

const CITIES: CityCenter[] = [
  { name: 'austin', state: 'tx', latitude: 30.2672, longitude: -97.7431, zoom: 11 },
  { name: 'dallas', state: 'tx', latitude: 32.7767, longitude: -96.797, zoom: 11 },
  { name: 'houston', state: 'tx', latitude: 29.7604, longitude: -95.3698, zoom: 11 },
  { name: 'san antonio', state: 'tx', latitude: 29.4241, longitude: -98.4936, zoom: 11 },
  { name: 'fort worth', state: 'tx', latitude: 32.7555, longitude: -97.3308, zoom: 11 },
  { name: 'denver', state: 'co', latitude: 39.7392, longitude: -104.9903, zoom: 11 },
  { name: 'phoenix', state: 'az', latitude: 33.4484, longitude: -112.074, zoom: 11 },
  { name: 'atlanta', state: 'ga', latitude: 33.749, longitude: -84.388, zoom: 11 },
  { name: 'chicago', state: 'il', latitude: 41.8781, longitude: -87.6298, zoom: 11 },
  { name: 'nashville', state: 'tn', latitude: 36.1627, longitude: -86.7816, zoom: 11 },
];

const DEFAULT: CityCenter = {
  name: 'united states',
  latitude: 39.5,
  longitude: -98.35,
  zoom: 4,
};

export function resolveCityCenter(query: string | null | undefined): CityCenter {
  const raw = String(query ?? '').trim().toLowerCase();
  if (!raw) return { ...CITIES[0]! };
  for (const city of CITIES) {
    if (raw.includes(city.name)) return city;
    if (city.state && (raw === city.state || raw.endsWith(` ${city.state}`))) {
      // Prefer Austin for bare TX searches in this market.
      if (city.state === 'tx') return CITIES[0]!;
    }
  }
  return DEFAULT;
}
