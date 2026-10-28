-- Renters read their own applications. Organization isolation stays in place.
-- A renter can also read the listing they already applied to after it leaves
-- the public active catalog, so the tracker keeps that home's address and rent.
--
-- intake_snapshot is not backfilled. A null snapshot stays null unless a stored
-- domain event already contains the submission. That copy is an explicit
-- reconciliation, not part of this migration.

create policy application_party_select on application
  for select
  using (
    party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
  );

create policy listing_applicant_read on listing
  for select
  using (
    exists (
      select 1
      from application a
      where a.listing_id = listing.id
        and a.party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    )
  );
