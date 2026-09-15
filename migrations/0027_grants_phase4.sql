-- Phase 4 grants (ingestion tables already granted in 0017; refresh sequences)

grant select, insert, update on
  mapping_profile, source_display_rule, source, sync_run, raw_record,
  source_listing, listing_field_provenance, unit_source_conflict, org_claim
to rbit_app;

grant usage, select on all sequences in schema public to rbit_app;

grant all on all tables in schema public to rbit_migrator;
grant all on all sequences in schema public to rbit_migrator;

grant select on all tables in schema public to rbit_admin_reader;

grant select, insert, update on
  mapping_profile, source_display_rule, source, sync_run, raw_record,
  source_listing, listing_field_provenance, unit_source_conflict, org_claim
to rbit_app_user;

grant usage, select on all sequences in schema public to rbit_app_user;
