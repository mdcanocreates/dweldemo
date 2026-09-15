-- Consent capture metadata for application-scoped screening consent

alter table screening_consent
  add column if not exists consent_user_agent text;
