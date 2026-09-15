-- Phase 4 ingestion: core tables already exist from 0010_ingestion.sql (§6A.2).
-- Additive indexes for delist reconcile + ambiguous queue performance.
-- D-11: no partner display-rule content seeded here (TEST_ONLY in tests only).
-- D-12: no RESO aggregator vendor binding.

create index if not exists source_listing_absent_since_idx
  on source_listing (source_id)
  where absent_since is not null;

create index if not exists sync_run_status_started_idx
  on sync_run (status, started_at desc);
