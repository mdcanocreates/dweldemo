/**
 * A submitted snapshot may carry the listing card from submit time.
 * Live listing status stays on the current row so availability can change
 * without rewriting the address and rent the renter already submitted.
 */

export type ListingCard = {
  line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  property_type: string | null;
  rent_amount_cents: number | null;
  thumbnail_url?: string | null;
  status?: string | null;
};

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function frozenListingFromSnapshot(snapshot: unknown): ListingCard | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const listing = (snapshot as { listing?: unknown }).listing;
  if (!listing || typeof listing !== 'object' || Array.isArray(listing)) return null;
  const row = listing as Record<string, unknown>;
  const rent = row.rent_amount_cents;
  return {
    line1: textOrNull(row.line1),
    city: textOrNull(row.city),
    state: textOrNull(row.state),
    postal_code: textOrNull(row.postal_code),
    property_type: textOrNull(row.property_type),
    rent_amount_cents: typeof rent === 'number' && Number.isFinite(rent) ? rent : null,
  };
}

export function presentListingCard(live: ListingCard, snapshot: unknown): ListingCard {
  const frozen = frozenListingFromSnapshot(snapshot);
  if (!frozen) return live;
  return {
    line1: frozen.line1 ?? live.line1,
    city: frozen.city ?? live.city,
    state: frozen.state ?? live.state,
    postal_code: frozen.postal_code ?? live.postal_code,
    property_type: frozen.property_type ?? live.property_type,
    rent_amount_cents: frozen.rent_amount_cents ?? live.rent_amount_cents,
    thumbnail_url: live.thumbnail_url,
    status: live.status,
  };
}
