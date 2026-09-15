-- Phase 6 grants: solar + model_registry

grant select, insert, update on
  solar_deal,
  solar_partner_remittance,
  solar_deal_remittance
to rbit_app, rbit_app_user;

grant select, insert on
  solar_underwriting_decision,
  model_registry
to rbit_app, rbit_app_user;

-- Insert-only: underwriting decisions are never updated/deleted (§13.3)
revoke update, delete on solar_underwriting_decision from rbit_app;
revoke update, delete on solar_underwriting_decision from rbit_app_user;

grant all on all tables in schema public to rbit_migrator;
grant all on all sequences in schema public to rbit_migrator;

grant usage, select on all sequences in schema public to rbit_app, rbit_app_user;
