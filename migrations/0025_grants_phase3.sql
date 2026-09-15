-- Phase 3 grants + ledger immutability (§11.1)

grant select, insert, update on
  broker_profile, broker_coverage, broker_performance,
  broker_balance, broker_balance_txn,
  lead, lead_offer, lead_purchase_evidence, lead_offer_saga_state,
  payment_event, reconciliation_run
to rbit_app;

-- Ledger: INSERT + SELECT only — no UPDATE/DELETE for application role
grant select, insert on ledger_account, ledger_transaction, ledger_entry to rbit_app;
revoke update, delete on ledger_account, ledger_transaction, ledger_entry from rbit_app;

grant usage, select on all sequences in schema public to rbit_app;

grant all on all tables in schema public to rbit_migrator;
grant all on all sequences in schema public to rbit_migrator;

grant select on all tables in schema public to rbit_admin_reader;

grant select, insert, update on
  broker_profile, broker_coverage, broker_performance,
  broker_balance, broker_balance_txn,
  lead, lead_offer, lead_purchase_evidence, lead_offer_saga_state,
  payment_event, reconciliation_run
to rbit_app_user;

grant select, insert on ledger_account, ledger_transaction, ledger_entry to rbit_app_user;
revoke update, delete on ledger_account, ledger_transaction, ledger_entry from rbit_app_user;

grant usage, select on all sequences in schema public to rbit_app_user;

revoke update, delete on admin_action_log from rbit_app_user;
grant select, insert on admin_action_log to rbit_app_user;
