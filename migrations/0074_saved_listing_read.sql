-- A renter who saved a listing can still read that row after it leaves
-- the public active catalog. Public search stays limited to status = 'active'.
-- This policy does not grant update, and it does not publish the listing.

create policy listing_saved_read on listing
  for select
  using (
    exists (
      select 1
      from saved_listing s
      where s.listing_id = listing.id
        and s.party_id = nullif(current_setting('rbit.current_party_id', true), '')::uuid
    )
  );

-- A home provider can read the renter profile attached to an application
-- for their organization. Discoverable search stays a separate policy.
create policy renter_profile_applicant_read on renter_profile
  for select
  using (
    exists (
      select 1
      from application a
      where a.renter_profile_id = renter_profile.id
        and a.org_id = nullif(current_setting('rbit.current_org_id', true), '')::uuid
    )
  );
