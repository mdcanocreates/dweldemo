-- Optional advertised rent ceiling for ranges (rent_amount_cents remains the floor/asking).
alter table listing
  add column if not exists rent_max_cents integer
    check (rent_max_cents is null or rent_max_cents >= 0);

comment on column listing.rent_max_cents is
  'Optional maximum advertised rent in cents. Null when only a single rent or floor is known.';
