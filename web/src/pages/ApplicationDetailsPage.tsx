import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type ApplicationDetail, type DossierText } from '../api';
import { useAuth } from '../auth';
import { ErrorState, Shell } from '../components/Shell';
import { moneyFromCents } from '../format';
import { applicationStatusLabel, nextActorLabel } from '../lib/application-status';

function missingCopy(mode: 'frozen_snapshot' | 'live_dossier' | undefined, readable: boolean): string {
  if (readable === false) return 'Stored snapshot could not be read.';
  if (mode === 'frozen_snapshot') return 'Not included in the submitted application.';
  return 'Not on file.';
}

function TextValue({
  field,
  missing,
  format,
}: {
  field: DossierText | undefined;
  missing: string;
  format?: (value: string) => string;
}) {
  if (!field || field.source === 'not_on_file' || !field.value) {
    return <span className="muted">{missing}</span>;
  }
  return <>{format ? format(field.value) : field.value}</>;
}

function peopleList(value: unknown, missing: string) {
  if (!Array.isArray(value) || value.length === 0) return <p className="muted">{missing}</p>;
  return (
    <ul>
      {value.map((item, index) => {
        const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        const label = [row.name, row.relationship, row.species, row.breed, row.age_band]
          .filter((part) => typeof part === 'string' && part.trim())
          .join(' · ');
        return <li key={index}>{label || 'Recorded, with no readable fields'}</li>;
      })}
    </ul>
  );
}

export function ApplicationDetailsPage() {
  const { id = '' } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate(`/sign-in?return=${encodeURIComponent(`/applications/${id}/details`)}`);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const detail = await api.getApplicationDetails(id);
        if (!cancelled) setData(detail);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load application details.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading, id, navigate]);

  async function openDocument(documentId: string) {
    setDocError(null);
    try {
      const signed = await api.missingInfoDocumentUrl(id, documentId);
      window.open(signed.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setDocError(err instanceof ApiError ? err.message : 'Could not open that document.');
    }
  }

  const dossier = data?.dossier;
  const missing = missingCopy(dossier?.mode, dossier?.snapshot_readable !== false);
  const contact = dossier?.contact;
  const residence = dossier?.residence;
  const employment = dossier?.employment;
  const listing = data?.listing;
  const address = [listing?.line1, listing?.city, listing?.state, listing?.postal_code]
    .filter(Boolean)
    .join(', ');
  const statusLabel = data?.progress?.status_label ?? (data ? applicationStatusLabel(data.status) : '');

  return (
    <Shell>
      <Link to="/applications" style={{ fontWeight: 700 }}>
        ← Applications
      </Link>
      <p className="section-eyebrow" style={{ marginTop: '1rem' }}>
        Submitted content
      </p>
      <h1 className="section-title">My application</h1>
      {error && <ErrorState title="Could not load this application">{error}</ErrorState>}
      {!data && !error && <p>Loading…</p>}
      {data && dossier && (
        <div className="stack" style={{ marginTop: '1rem', maxWidth: '40rem' }}>
          <div className="panel stack">
            <h2>{listing?.line1 ?? 'Property'}</h2>
            {listing?.thumbnail_url ? (
              <img
                src={listing.thumbnail_url}
                alt=""
                style={{ width: '100%', maxHeight: '14rem', objectFit: 'cover', borderRadius: '0.75rem' }}
              />
            ) : (
              <p className="muted">No photo on file for this home.</p>
            )}
            <p>{address || 'Address not on file'}</p>
            {listing?.rent_amount_cents != null && <p>{moneyFromCents(listing.rent_amount_cents)}/mo</p>}
          </div>
          <p>
            Status: <strong>{statusLabel}</strong>
          </p>
          <p className="muted">
            {dossier.mode === 'frozen_snapshot'
              ? `Submitted snapshot${dossier.captured_at ? ` from ${new Date(dossier.captured_at).toLocaleString()}` : ''}. Later profile edits do not change this submission.`
              : 'No frozen snapshot is stored. The sections below are the current dossier, not a historical submission.'}
          </p>
          {dossier.snapshot_readable === false && (
            <ErrorState title="Snapshot unreadable">
              A snapshot is stored for this application, but it is not in a recognized format. Fields
              were not filled in from your current profile.
            </ErrorState>
          )}
          <p className="muted">
            Current stage: {data.progress?.current_label ?? 'Not recorded'} · Next action:{' '}
            {nextActorLabel(data.progress?.next_action_owner)}
          </p>
          <div className="panel stack">
            <h2>Contact</h2>
            <p>
              <TextValue field={contact?.given_name} missing={missing} />{' '}
              <TextValue field={contact?.family_name} missing="" />
            </p>
            <p>
              <TextValue field={contact?.email} missing={missing} /> ·{' '}
              <TextValue field={contact?.phone} missing={missing} />
            </p>
          </div>
          <div className="panel stack">
            <h2>Address</h2>
            <p>
              <TextValue field={residence?.line1} missing={missing} />
              {residence?.city?.value || residence?.state?.value || residence?.postal?.value
                ? `, ${[residence?.city?.value, residence?.state?.value, residence?.postal?.value].filter(Boolean).join(', ')}`
                : ''}
            </p>
            <p className="muted">
              Moved in: <TextValue field={residence?.move_in} missing={missing} />
            </p>
          </div>
          <div className="panel stack">
            <h2>Employment</h2>
            <p>
              <TextValue field={employment?.employer_name} missing={missing} /> ·{' '}
              <TextValue field={employment?.job_title} missing={missing} />
            </p>
            <p>
              Phone <TextValue field={employment?.employer_phone} missing={missing} /> ·{' '}
              <TextValue field={employment?.employment_length_months} missing={missing} format={(v) => `${v} mo`} />
            </p>
            <p>
              Monthly income:{' '}
              <TextValue
                field={employment?.monthly_gross_income_cents}
                missing={missing}
                format={(v) => moneyFromCents(Number(v))}
              />
            </p>
          </div>
          <div className="panel stack">
            <h2>Occupants</h2>
            {peopleList(dossier.occupants.value, missing)}
          </div>
          <div className="panel stack">
            <h2>Pets</h2>
            {peopleList(dossier.pets.value, missing)}
          </div>
          <div className="panel stack">
            <h2>Emergency contact</h2>
            {dossier.emergency_contact.value && typeof dossier.emergency_contact.value === 'object' ? (
              <p>
                {Object.values(dossier.emergency_contact.value as Record<string, unknown>)
                  .filter((part) => typeof part === 'string' && part.trim())
                  .join(' · ') || missing}
              </p>
            ) : (
              <p className="muted">{missing}</p>
            )}
          </div>
          <div className="panel stack">
            <h2>Vehicle</h2>
            {dossier.vehicle.value && typeof dossier.vehicle.value === 'object' ? (
              <p>
                {Object.values(dossier.vehicle.value as Record<string, unknown>)
                  .filter((part) => typeof part === 'string' && part.trim())
                  .join(' · ') || missing}
              </p>
            ) : (
              <p className="muted">{missing}</p>
            )}
          </div>
          <div className="panel stack">
            <h2>Supporting documents</h2>
            {data.documents_retrieval === 'unavailable' && (
              <p>Supporting documents could not be loaded. This is not the same as having none on file.</p>
            )}
            {data.documents_retrieval === 'ok' && data.documents.length === 0 && (
              <p className="muted">No supporting documents on file.</p>
            )}
            {data.documents_retrieval === 'ok' &&
              data.documents.map((doc) => (
                <p key={doc.document_id}>
                  {doc.doc_type.replaceAll('_', ' ')} · {new Date(doc.created_at).toLocaleString()} ·{' '}
                  {doc.scan_status}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginLeft: '0.75rem' }}
                    onClick={() => void openDocument(doc.document_id)}
                  >
                    Open
                  </button>
                </p>
              ))}
            {docError && <p>{docError}</p>}
          </div>
          <div className="panel stack">
            <h2>Recorded updates</h2>
            {data.recorded_updates.length === 0 ? (
              <p className="muted">No status timestamps are stored for this application.</p>
            ) : (
              <ul>
                {data.recorded_updates.map((update) => (
                  <li key={`${update.at}-${update.label}`}>
                    {new Date(update.at).toLocaleString()} — {update.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {dossier.current_account && (
            <div className="panel stack">
              <h2>Current profile</h2>
              <p className="muted">
                This is the account profile today. It was not copied into the submitted application.
              </p>
              <p>
                {dossier.current_account.contact.given_name.value}{' '}
                {dossier.current_account.contact.family_name.value} ·{' '}
                {dossier.current_account.contact.email.value} · {dossier.current_account.contact.phone.value}
              </p>
              <p>
                {[
                  dossier.current_account.residence.line1.value,
                  dossier.current_account.residence.city.value,
                  dossier.current_account.residence.state.value,
                  dossier.current_account.residence.postal.value,
                ]
                  .filter(Boolean)
                  .join(', ') || 'Address not on the current profile.'}
              </p>
              <p>
                {dossier.current_account.employment.employer_name.value ?? 'Employer not on the current profile.'}
                {dossier.current_account.employment.job_title.value
                  ? ` · ${dossier.current_account.employment.job_title.value}`
                  : ''}
              </p>
            </div>
          )}
          {dossier.retrieval.profile === 'absent' && (
            <p className="muted">No renter profile is stored for this account.</p>
          )}
          <p className="hint">
            Editing your profile updates the account dossier only. It does not rewrite a frozen
            snapshot.
          </p>
          {data.listing_id && (
            <Link className="btn btn-secondary" to={`/apply/${data.listing_id}?edit=1`}>
              Edit before next application
            </Link>
          )}
        </div>
      )}
    </Shell>
  );
}
