-- Broker → Home Provider portfolio delegation (userFlow managed_by_broker_id).
-- Landlord org optionally points at the managing brokerage org.

alter table org
  add column if not exists managed_by_broker_org_id uuid references org(id);

create index if not exists org_managed_by_broker_org_id_idx
  on org (managed_by_broker_org_id)
  where managed_by_broker_org_id is not null;
