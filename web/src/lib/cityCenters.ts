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
  // Empty search = national overview. Never force Austin while nationwide cards load.
  if (!raw) return { ...DEFAULT };
  for (const city of CITIES) {
    if (raw.includes(city.name)) return city;
  }
  // Tampa / Orlando / Miami / San Diego / LA used by deal inventory.
  const extras: CityCenter[] = [
    { name: 'tampa', state: 'fl', latitude: 27.9506, longitude: -82.4572, zoom: 11 },
    { name: 'orlando', state: 'fl', latitude: 28.5383, longitude: -81.3792, zoom: 11 },
    { name: 'miami', state: 'fl', latitude: 25.7617, longitude: -80.1918, zoom: 11 },
    { name: 'jacksonville', state: 'fl', latitude: 30.3322, longitude: -81.6557, zoom: 11 },
    { name: 'san diego', state: 'ca', latitude: 32.7157, longitude: -117.1611, zoom: 11 },
    { name: 'los angeles', state: 'ca', latitude: 34.0522, longitude: -118.2437, zoom: 11 },
    { name: 'brooklyn', state: 'ny', latitude: 40.6782, longitude: -73.9442, zoom: 12 },
    { name: 'new york', state: 'ny', latitude: 40.7128, longitude: -74.006, zoom: 11 },
  ];
  for (const city of extras) {
    if (raw.includes(city.name)) return city;
  }
  return DEFAULT;
}
