-- Application and audit roles. Ledger immutability grants land in Phase 3;
-- admin_action_log is insert-only for the application role from Phase 0.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'rbit_app') then
    create role rbit_app nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'rbit_migrator') then
    create role rbit_migrator nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'rbit_admin_reader') then
    create role rbit_admin_reader nologin;
  end if;
end $$;

grant usage on schema public to rbit_app, rbit_migrator, rbit_admin_reader;

grant select, insert, update on
  org, party, data_encryption_key, party_identity, external_identity_ref,
  party_role, party_features, org_claim, permission, role_permission,
  dual_approval_request, impersonation_session, config_version, domain_event
to rbit_app;

grant usage, select on all sequences in schema public to rbit_app;

grant select, insert on admin_action_log to rbit_app;

grant all on all tables in schema public to rbit_migrator;
grant all on all sequences in schema public to rbit_migrator;

grant select on all tables in schema public to rbit_admin_reader;

-- Non-superuser login role for RLS behavioral tests (superusers bypass RLS).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'rbit_app_user') then
    create role rbit_app_user login password 'rbit_app_user' nosuperuser nocreatedb nocreaterole;
  end if;
end $$;

grant rbit_app to rbit_app_user;
grant usage on schema public to rbit_app_user;
grant select, insert, update on all tables in schema public to rbit_app_user;
grant usage, select on all sequences in schema public to rbit_app_user;
revoke update, delete on admin_action_log from rbit_app_user;
grant select, insert on admin_action_log to rbit_app_user;
