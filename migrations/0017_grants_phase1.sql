-- Phase 1 grants for application / migrator / admin reader roles

grant select, insert, update on
  submarket, address, property, unit, listing,
  mapping_profile, source_display_rule, source, sync_run, raw_record,
  source_listing, listing_field_provenance, unit_source_conflict,
  auth_magic_token, session,
  renter_profile, application, score,
  landlord_interest, landlord_decision, placement, placement_queue_entry,
  placement_outcome,
  notification, notification_preference, notification_suppression
to rbit_app;

grant usage, select on all sequences in schema public to rbit_app;

grant all on all tables in schema public to rbit_migrator;
grant all on all sequences in schema public to rbit_migrator;

grant select on all tables in schema public to rbit_admin_reader;

grant select, insert, update on all tables in schema public to rbit_app_user;
grant usage, select on all sequences in schema public to rbit_app_user;
revoke update, delete on admin_action_log from rbit_app_user;
grant select, insert on admin_action_log to rbit_app_user;
