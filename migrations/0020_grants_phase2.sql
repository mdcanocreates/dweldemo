-- Phase 2 grants

grant select, insert, update on
  screening_package, screening_order, screening_report, screening_report_access,
  income_verification, screening_rebate, fraud_signal,
  vendor_webhook_event, vendor_request_archive, vendor_response_archive,
  vendor_cost_entry, screening_saga_state
to rbit_app;

grant usage, select on all sequences in schema public to rbit_app;

grant all on all tables in schema public to rbit_migrator;
grant all on all sequences in schema public to rbit_migrator;

grant select on all tables in schema public to rbit_admin_reader;

grant select, insert, update on all tables in schema public to rbit_app_user;
grant usage, select on all sequences in schema public to rbit_app_user;
revoke update, delete on admin_action_log from rbit_app_user;
grant select, insert on admin_action_log to rbit_app_user;

-- Append-only cost attribution: no UPDATE/DELETE for app role on vendor_cost_entry
revoke update, delete on vendor_cost_entry from rbit_app;
revoke update, delete on vendor_cost_entry from rbit_app_user;
grant select, insert on vendor_cost_entry to rbit_app;
grant select, insert on vendor_cost_entry to rbit_app_user;
