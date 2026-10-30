export type MapPinInput = {
  id: string;
  latitude: number;
  longitude: number;
  priceLabel: string;
};

export type PreparedPin = {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  listingIds: string[];
};

function isValidPin(listing: MapPinInput): boolean {
  return (
    Boolean(listing.id) &&
    Number.isFinite(listing.latitude) &&
    Number.isFinite(listing.longitude) &&
    Math.abs(listing.latitude) <= 90 &&
    Math.abs(listing.longitude) <= 180
  );
}

/** One pin per listing. Listings that share an approximate area share one marker. */
export function prepareMapPins(listings: readonly MapPinInput[]): PreparedPin[] {
  const unique = new Map<string, MapPinInput>();
  for (const listing of listings) {
    if (!isValidPin(listing)) continue;
    unique.set(listing.id, listing);
  }

  const groups = new Map<string, MapPinInput[]>();
  for (const listing of unique.values()) {
    const key = `${listing.latitude.toFixed(2)}:${listing.longitude.toFixed(2)}`;
    const group = groups.get(key) ?? [];
    group.push(listing);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const first = group[0]!;
    if (group.length === 1) {
      return {
        id: first.id,
        latitude: first.latitude,
        longitude: first.longitude,
        label: first.priceLabel,
        listingIds: [first.id],
      };
    }
    return {
      id: first.id,
      latitude: first.latitude,
      longitude: first.longitude,
      label: String(group.length),
      listingIds: group.map((item) => item.id),
    };
  });
}
