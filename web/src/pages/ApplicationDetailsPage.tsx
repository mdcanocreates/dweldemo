import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { ErrorState, Shell } from '../components/Shell';
import { moneyFromCents } from '../format';

type Snapshot = {
  captured_at?: string;
  contact?: {
    given_name?: string | null;
    family_name?: string | null;
    email?: string | null;
    phone_e164?: string | null;
  } | null;
  intake?: Record<string, unknown> | null;
};

export function ApplicationDetailsPage() {
  const { id = '' } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getApplicationDetails>> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

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

  const snap = (data?.snapshot ?? null) as Snapshot | null;
  const intake = (snap?.intake ?? data?.live_intake ?? {}) as Record<string, unknown>;
  const contact = snap?.contact;
  const editListing = data?.listing_id ?? 'edit';

  return (
    <Shell>
      <Link to="/applications" style={{ fontWeight: 700 }}>
        ← Applications
      </Link>
      <p className="section-eyebrow" style={{ marginTop: '1rem' }}>
        Submitted content
      </p>
      <h1 className="section-title">My application</h1>
      {error && <ErrorState title="Unavailable">{error}</ErrorState>}
      {!data && !error && <p>Loading…</p>}
      {data && (
        <div className="stack" style={{ marginTop: '1rem', maxWidth: '40rem' }}>
          <p className="muted">
            Status: <strong>{data.status}</strong>
            {data.snapshot_is_frozen
              ? ` · Frozen snapshot from ${snap?.captured_at ? new Date(snap.captured_at).toLocaleString() : 'submit'}`
              : ' · Showing live dossier (no freeze yet)'}
          </p>
          <div className="panel stack">
            <h2>Contact</h2>
            <p>
              {contact?.given_name ?? '—'} {contact?.family_name ?? ''}
            </p>
            <p>
              {contact?.email ?? '—'} · {contact?.phone_e164 ?? '—'}
            </p>
          </div>
          <div className="panel stack">
            <h2>Address</h2>
            <p>
              {[
                intake.current_address_line1,
                intake.current_address_city,
                intake.current_address_state,
                intake.current_address_postal,
              ]
                .filter(Boolean)
                .join(', ') || '—'}
            </p>
            <p className="muted">Moved in: {String(intake.current_address_move_in ?? '—')}</p>
          </div>
          <div className="panel stack">
            <h2>Employment</h2>
            <p>
              {String(intake.employer_name ?? '—')} · {String(intake.job_title ?? '—')}
            </p>
            <p>
              Phone {String(intake.employer_phone ?? '—')} ·{' '}
              {intake.employment_length_months != null
                ? `${intake.employment_length_months} mo`
                : '—'}
            </p>
            <p>
              Monthly income:{' '}
              {intake.monthly_gross_income_cents != null
                ? moneyFromCents(Number(intake.monthly_gross_income_cents))
                : '—'}
            </p>
          </div>
          <div className="panel stack">
            <h2>Occupants</h2>
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: '0.85rem' }}>
              {JSON.stringify(intake.occupants ?? [], null, 2)}
            </pre>
          </div>
          <div className="panel stack">
            <h2>Pets</h2>
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: '0.85rem' }}>
              {JSON.stringify(intake.pets ?? [], null, 2)}
            </pre>
          </div>
          <div className="panel stack">
            <h2>Emergency contact</h2>
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: '0.85rem' }}>
              {JSON.stringify(intake.emergency_contact ?? null, null, 2)}
            </pre>
          </div>
          <div className="panel stack">
            <h2>Vehicle</h2>
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: '0.85rem' }}>
              {JSON.stringify(intake.vehicle ?? null, null, 2)}
            </pre>
          </div>
          <p className="hint">
            “Edit before next application” updates your reusable dossier only. It does not rewrite
            this listing’s frozen snapshot once a landlord review has started.
          </p>
          <Link className="btn btn-secondary" to={`/apply/${editListing}?edit=1`}>
            Edit before next application
          </Link>
        </div>
      )}
    </Shell>
  );
}
