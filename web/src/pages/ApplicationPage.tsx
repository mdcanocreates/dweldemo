import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { readAccessToken } from '../accessToken';
import { api, ApiError } from '../api';
import { ErrorState, Shell } from '../components/Shell';

type AppStatus = {
  application_id: string;
  status: string;
  screening: { status: string | null; order_id: string | null };
};

export function ApplicationPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const accessToken = useMemo(() => readAccessToken(location.search), [location.search]);
  const justCreated = Boolean((location.state as { justCreated?: boolean } | null)?.justCreated);

  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consentVersion, setConsentVersion] = useState<string | null>(null);
  const [screeningNote, setScreeningNote] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(
    null,
  );
  const [income, setIncome] = useState('');
  const [busy, setBusy] = useState<'consent' | 'submit' | null>(null);

  const refresh = useCallback(async () => {
    if (!id || !accessToken) return;
    setStatus(await api.getApplication(id, accessToken));
  }, [id, accessToken]);

  useEffect(() => {
    if (!id) return;
    if (!accessToken) {
      setError(
        'This private application link is incomplete. Open the full link you received when you applied.',
      );
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && err.status === 401
              ? 'This private application link is invalid, expired, or belongs to a different application.'
              : err instanceof ApiError
                ? err.message
                : 'Could not load your application.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, accessToken, refresh]);

  async function onConsent() {
    if (!id || !accessToken || busy) return;
    setBusy('consent');
    setError(null);
    try {
      const result = await api.recordConsent(id, accessToken);
      setConsentVersion(result.disclosure_version);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'disclosure_version_required') {
        setError(
          'Screening is not yet available — disclosure configuration is missing. Your application is saved; return later with this link.',
        );
      } else {
        setError(err instanceof ApiError ? err.message : 'Consent could not be recorded.');
      }
    } finally {
      setBusy(null);
    }
  }

  async function onSubmit() {
    if (!id || !accessToken || busy) return;
    setBusy('submit');
    setError(null);
    setScreeningNote(null);
    const incomeCents = income.trim() ? Math.round(Number(income) * 100) : undefined;
    try {
      const result = await api.submitScreening(
        id,
        accessToken,
        incomeCents && incomeCents > 0 ? { stated_monthly_income_cents: incomeCents } : undefined,
      );
      setScreeningNote({
        kind: 'ok',
        text: `Screening submitted. Application status is now “${result.status}”. Refresh this page for updates.`,
      });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SCREENING_PROVIDER_UNAVAILABLE') {
        setScreeningNote({
          kind: 'warn',
          text: 'Screening is temporarily unavailable. Your application has been saved and no screening request was submitted.',
        });
        try {
          await refresh();
        } catch {
          // keep prior
        }
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Screening could not be submitted. Your application was left unchanged.',
        );
      }
    } finally {
      setBusy(null);
    }
  }

  if (error && !status) {
    return (
      <Shell>
        <ErrorState title="Cannot open application">{error}</ErrorState>
        <p>
          <Link to="/listings">Find a home</Link>
        </p>
      </Shell>
    );
  }

  if (!status) {
    return (
      <Shell>
        <p>Loading application…</p>
      </Shell>
    );
  }

  const stepConsent = Boolean(consentVersion);
  const stepScreening = Boolean(status.screening.status) || screeningNote?.kind === 'ok';

  return (
    <Shell>
      <div className="stack">
        <div>
          <h1>Your application</h1>
          <p>Status: <strong>{status.status}</strong></p>
        </div>

        <div className="progress" aria-label="Application progress">
          <span className="on">Applied</span>
          <span className={stepConsent ? 'on' : undefined}>Consent</span>
          <span className={stepScreening ? 'on' : undefined}>Screening</span>
          <span>Decision</span>
        </div>

        {justCreated && (
          <div className="callout">
            <strong>Your private application link</strong>
            Bookmark or copy this page URL from your browser. It is how you return to consent,
            screening, and status. We do not store it in this device’s local storage.
          </div>
        )}

        <div className="panel stack">
          <div>
            <h2>Status</h2>
            <p>
              Application: <strong>{status.status}</strong>
            </p>
            <p>
              Screening:{' '}
              <strong>{status.screening.status ?? 'not started'}</strong>
            </p>
            <button type="button" className="btn btn-secondary" onClick={() => void refresh()}>
              Refresh status
            </button>
          </div>

          <div>
            <h2>Consent</h2>
            <p>
              Confirm you agree to screening disclosures before a report is ordered. The active
              disclosure version comes from configuration — this form does not invent one.
            </p>
            {consentVersion && <p>Recorded disclosure: {consentVersion}</p>}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== null}
              onClick={() => void onConsent()}
            >
              {busy === 'consent' ? 'Recording…' : 'I agree — record consent'}
            </button>
          </div>

          <div>
            <h2>Screening</h2>
            <div className="form-grid" style={{ maxWidth: '20rem', marginBottom: '0.75rem' }}>
              <label>
                Stated monthly income (optional)
                <span className="hint">Used only if screening is available</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={income}
                  onChange={(e) => setIncome(e.target.value)}
                  inputMode="decimal"
                />
              </label>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== null}
              onClick={() => void onSubmit()}
            >
              {busy === 'submit' ? 'Submitting…' : 'Submit screening'}
            </button>
            {screeningNote && (
              <div className={`callout ${screeningNote.kind === 'warn' ? 'warn' : ''}`} style={{ marginTop: '0.85rem' }}>
                <strong>
                  {screeningNote.kind === 'warn' ? 'Screening unavailable' : 'Screening submitted'}
                </strong>
                {screeningNote.text}
              </div>
            )}
          </div>
        </div>

        {error && <ErrorState title="Something blocked this step">{error}</ErrorState>}

        <p>
          <Link to="/listings">Find a home</Link>
        </p>
      </div>
    </Shell>
  );
}
