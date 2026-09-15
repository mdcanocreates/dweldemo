-- Grants for Phase 1 public API tables

grant select, insert, update on
  application_access_token, screening_consent
to rbit_app;

grant select, insert, update on
  application_access_token, screening_consent
to rbit_app_user;
