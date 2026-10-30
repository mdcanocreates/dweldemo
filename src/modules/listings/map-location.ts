/**
 * Public map pins use a coarse area derived from a stored point.
 * Missing or invalid points stay off the map. Exact property pins are not published.
 */
export type PublicMapPrecision = 'area';

export type PublicMapLocation = {
  latitude: number;
  longitude: number;
  precision: PublicMapPrecision;
};

const VERIFIED_GEOCODE = new Set(['rooftop', 'parcel', 'interpolated', 'centroid']);

export function publicAreaLocation(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): PublicMapLocation | null {
  if (latitude == null || longitude == null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {
    latitude: Math.round(latitude * 100) / 100,
    longitude: Math.round(longitude * 100) / 100,
    precision: 'area',
  };
}

/** A public pin requires a stored point and a known geocode class. Precision stays "area". */
export function publishableMapLocation(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  geocodePrecision: string | null | undefined,
): PublicMapLocation | null {
  if (!geocodePrecision || !VERIFIED_GEOCODE.has(geocodePrecision)) return null;
  return publicAreaLocation(latitude, longitude);
}
