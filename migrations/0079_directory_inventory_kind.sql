-- Inquiry-only affordable-housing directory inventory, distinct from confirmed rentals.
-- Extends 0077 inventory_kind without rewriting historical rows.

alter table listing drop constraint if exists listing_inventory_kind_check;

alter table listing
  add constraint listing_inventory_kind_check
  check (inventory_kind in ('partner', 'external', 'demo', 'directory'));

alter table property
  add column if not exists display_name text;

alter table listing
  add column if not exists public_description text;

comment on column property.display_name is
  'Public property name for directory and partner cards; never copy restricted feed titles verbatim when rights are unclear.';

comment on column listing.public_description is
  'Original Dwel public copy for directory or partner listings when no licensed source_listing description is available.';
