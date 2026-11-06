-- Record authorized hotlink display rights for Rent.com deal-package imagery.
-- Does not copy image bytes into Dwel storage; public media may reference origin URLs.

alter table external_source
  add column if not exists media_policy text
    check (media_policy is null or media_policy in ('host', 'hotlink', 'none'));

insert into external_source (
  provider_key,
  display_name,
  license_evidence_ref,
  permitted_fields,
  attribution_text,
  status,
  media_policy,
  updated_at
) values (
  'rent_com_deal_package',
  'Rent.com deal listing package',
  'ops_authorized_hotlink_display_2026-11-06',
  array[
    'address',
    'rent_range',
    'beds',
    'special_text',
    'coordinates_approximate',
    'photos',
    'media',
    'images'
  ],
  'Property imagery displayed under authorized feed hotlink rights.',
  'approved',
  'hotlink',
  now()
)
on conflict (provider_key) do update set
  license_evidence_ref = excluded.license_evidence_ref,
  permitted_fields = excluded.permitted_fields,
  attribution_text = excluded.attribution_text,
  status = 'approved',
  media_policy = 'hotlink',
  updated_at = now();

comment on column external_source.media_policy is
  'host = copy into Dwel storage; hotlink = render origin URLs; none = do not display media';
