-- Phase 0 foundation: extensions and migration bookkeeping
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

create table if not exists schema_migrations (
  id          text primary key,
  applied_at  timestamptz not null default now()
);
