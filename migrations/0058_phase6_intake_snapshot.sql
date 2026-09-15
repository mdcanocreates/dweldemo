-- Part L-1a: freeze submitted intake on the application so later dossier edits
-- do not rewrite landlord-facing review content for in-progress applications.

alter table application
  add column if not exists intake_snapshot jsonb;

comment on column application.intake_snapshot is
  'Copy of renter_application_intake (+ contact) at interest/submit time; immutable for landlord review';
