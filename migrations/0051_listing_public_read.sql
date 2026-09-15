-- Public listing browse without bypass: active listings are readable anonymously.
-- Existing org isolation policy remains; PostgreSQL OR's permissive policies.

drop policy if exists listing_public_active_read on listing;
create policy listing_public_active_read on listing
  for select
  using (status = 'active');

-- Source display rule + source_listing joins needed for public serializers.
-- source_listing is org-scoped; allow SELECT of rows whose listing is active.
drop policy if exists source_listing_public_active_read on source_listing;
create policy source_listing_public_active_read on source_listing
  for select
  using (
    exists (
      select 1 from listing l
      where l.primary_source_listing_id = source_listing.id
        and l.status = 'active'
    )
  );

drop policy if exists source_public_active_read on source;
create policy source_public_active_read on source
  for select
  using (
    exists (
      select 1 from source_listing sl
      join listing l on l.primary_source_listing_id = sl.id
      where sl.source_id = source.id
        and l.status = 'active'
    )
  );
