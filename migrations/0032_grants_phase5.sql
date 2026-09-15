-- Phase 5 grants: documents, search, reporting schema

grant select, insert, update on
  document, document_grant, document_access_log,
  search_event, search_demand_daily
to rbit_app;

grant usage, select on all sequences in schema public to rbit_app;

grant usage on schema reporting to rbit_app, rbit_migrator, rbit_admin_reader, rbit_app_user;

grant select, insert, update, delete on all tables in schema reporting to rbit_app;
grant select on all tables in schema reporting to rbit_admin_reader;

grant all on all tables in schema public to rbit_migrator;
grant all on all sequences in schema public to rbit_migrator;
grant all on all tables in schema reporting to rbit_migrator;
grant all on all sequences in schema reporting to rbit_migrator;

grant select, insert, update on
  document, document_grant, document_access_log,
  search_event, search_demand_daily
to rbit_app_user;

grant select, insert, update, delete on all tables in schema reporting to rbit_app_user;
grant usage, select on all sequences in schema public to rbit_app_user;
grant usage, select on all sequences in schema reporting to rbit_app_user;

-- Default privileges for future reporting tables
alter default privileges in schema reporting
  grant select, insert, update, delete on tables to rbit_app, rbit_app_user;
alter default privileges in schema reporting
  grant select on tables to rbit_admin_reader;
