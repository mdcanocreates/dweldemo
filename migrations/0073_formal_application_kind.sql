-- Distinguish an expression of interest from a formal rental application.
-- Existing rows stay interest. They are not rewritten into submitted applications.
-- One open row per renter, listing, and kind. Production apply must confirm
-- there are no duplicate open rows for that key before this index is created.

alter table application
  add column if not exists record_kind text not null default 'interest';

alter table application drop constraint if exists application_record_kind_check;
alter table application
  add constraint application_record_kind_check
  check (record_kind in ('interest', 'formal'));

comment on column application.record_kind is
  'interest is an expression of interest. formal is a rental application draft or submission. Historical rows default to interest.';

create unique index if not exists application_one_open_per_kind
  on application (party_id, listing_id, record_kind)
  where listing_id is not null
    and closed_at is null
    and status not in ('declined', 'withdrawn', 'closed');
