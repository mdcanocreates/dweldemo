-- §5 Geography (PostGIS)

create extension if not exists postgis;

create table submarket (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  metro_code text not null,
  boundary   geography(Polygon, 4326) not null,
  version    text not null,
  is_active  boolean not null default true
);

create table address (
  id                 uuid primary key default gen_random_uuid(),
  raw_input          text not null,
  line1              text,
  line2              text,
  city               text,
  state              char(2),
  postal_code        text,
  postal_plus4       text,
  is_dpv_confirmed   boolean,
  normalized_hash    text not null,
  geom               geography(Point, 4326),
  geocode_precision  text check (geocode_precision in
                       ('rooftop','parcel','interpolated','centroid')),
  tract_geoid        text,
  block_group_geoid  text,
  county_fips        char(5),
  cbsa_code          text,
  h3_r7              text,
  h3_r8              text,
  h3_r9              text,
  submarket_id       uuid references submarket(id),
  normalizer_vendor  text not null,
  normalizer_version text not null,
  normalized_at      timestamptz not null default now()
);
create unique index on address (normalized_hash);
create index on address using gist (geom);
create index on address (submarket_id, tract_geoid);
