-- Phase 7 grants: feature_snapshot + insert-only score (§8.1)

grant select, insert on feature_snapshot to rbit_app, rbit_app_user;

-- Insert-only: score is never updated/deleted (§8.1)
revoke update, delete on score from rbit_app;
revoke update, delete on score from rbit_app_user;
grant select, insert on score to rbit_app, rbit_app_user;

-- feature_snapshot is append-oriented (decision-time snapshots)
revoke update, delete on feature_snapshot from rbit_app;
revoke update, delete on feature_snapshot from rbit_app_user;

grant all on all tables in schema public to rbit_migrator;
grant all on all sequences in schema public to rbit_migrator;

grant usage, select on all sequences in schema public to rbit_app, rbit_app_user;
