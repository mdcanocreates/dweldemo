import type { DbClient } from '../../db/pool.js';
import { AppError } from '../shared/errors.js';

export type SavedListingRow = {
  listing_id: string;
  created_at: string;
  status: string;
  rent_amount_cents: number;
  address_line1: string | null;
  city: string | null;
  state: string | null;
};

export async function listSavedListings(
  client: DbClient,
  partyId: string,
): Promise<SavedListingRow[]> {
  const { rows } = await client.query<{
    listing_id: string;
    created_at: Date;
    status: string;
    rent_amount_cents: number;
    address_line1: string | null;
    city: string | null;
    state: string | null;
  }>(
    `select sl.listing_id, sl.created_at, l.status, l.rent_amount_cents,
            addr.line1 as address_line1, addr.city, addr.state
     from saved_listing sl
     join listing l on l.id = sl.listing_id
     join unit u on u.id = l.unit_id
     join property p on p.id = u.property_id
     join address addr on addr.id = p.address_id
     where sl.party_id = $1
     order by sl.created_at desc`,
    [partyId],
  );
  return rows.map((r) => ({
    listing_id: r.listing_id,
    created_at: r.created_at.toISOString(),
    status: r.status,
    rent_amount_cents: r.rent_amount_cents,
    address_line1: r.address_line1,
    city: r.city,
    state: r.state,
  }));
}

export async function addSavedListing(
  client: DbClient,
  input: { partyId: string; listingId: string },
): Promise<{ listing_id: string; created_at: string }> {
  const { rows: listing } = await client.query<{ id: string; status: string }>(
    `select id, status from listing where id = $1`,
    [input.listingId],
  );
  if (!listing[0]) throw new AppError('listing not found', 'listing_not_found', 404);

  const { rows } = await client.query<{ listing_id: string; created_at: Date }>(
    `insert into saved_listing (party_id, listing_id)
     values ($1, $2)
     on conflict (party_id, listing_id) do update set party_id = excluded.party_id
     returning listing_id, created_at`,
    [input.partyId, input.listingId],
  );
  return {
    listing_id: rows[0]!.listing_id,
    created_at: rows[0]!.created_at.toISOString(),
  };
}

export async function removeSavedListing(
  client: DbClient,
  input: { partyId: string; listingId: string },
): Promise<{ removed: boolean }> {
  const { rowCount } = await client.query(
    `delete from saved_listing where party_id = $1 and listing_id = $2`,
    [input.partyId, input.listingId],
  );
  return { removed: (rowCount ?? 0) > 0 };
}
