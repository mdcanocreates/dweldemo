import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { rememberAccessToken } from '../accessToken';
import { useAuth } from '../auth';
import { FrogPageLoader, InlineSpinner } from '../components/FrogPageLoader';
import { ErrorState, Shell } from '../components/Shell';
import { moneyFromCents } from '../format';
import { track } from '../lib/analytics';
import { useDelayedPending } from '../hooks/useDelayedPending';
import {
  answersToIntakePayload,
  answersToProfilePayload,
  intakeFieldsReady,
  loadAnswers,
  mergeServerRecords,
  profileComplete,
  saveAnswers,
  type RenterAnswers,
} from '../intake/answers';

/**
 * N-6 apply — remaining intake fields only (G-0 lives on homepage).
 */
export function ApplyPage() {
  const { listingId = '' } = useParams();
  const [search] = useSearchParams();
  const editOnly = search.get('edit') === '1';
  const { user, loading: authLoading, setSession, refresh } = useAuth();
  const navigate = useNavigate();

  const [bootAnswers, setBootAnswers] = useState<RenterAnswers | null>(null);
  const [answers, setAnswers] = useState<RenterAnswers>(() => loadAnswers());
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hopping, setHopping] = useState(false);
  const [loadingIntake, setLoadingIntake] = useState(true);
  const [accountLoad, setAccountLoad] = useState<'unknown' | 'ok' | 'failed' | 'signed_out'>(
    'unknown',
  );
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const showSubmitFrog = useDelayedPending(hopping, 400);
  const showIntakeInline = useDelayedPending(loadingIntake && !hopping, 400);

  useEffect(() => {
    if (listingId) track('application_started', { product: 'dwel', flow: 'apply' });
  }, [listingId]);

  const persist = useCallback((next: RenterAnswers) => {
    setAnswers(next);
    saveAnswers(next);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    (async () => {
      setLoadingIntake(true);
      const local = loadAnswers();
      try {
        if (!user) {
          if (!cancelled) {
            setBootAnswers(local);
            setAnswers(local);
            setComplete(false);
            setAccountLoad('signed_out');
          }
          return;
        }
        const data = await api.getRenterIntake();
        if (cancelled) return;
        const merged = mergeServerRecords(
          local,
          data.profile,
          (data.intake as Record<string, unknown>) ?? null,
        );
        saveAnswers(merged);
        setBootAnswers(merged);
        setAnswers(merged);
        setComplete(data.complete);
        setAccountLoad('ok');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load intake.');
          setBootAnswers(null);
          setAccountLoad('failed');
        }
      } finally {
        if (!cancelled) setLoadingIntake(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  async function ensureSession(fromAnswers: RenterAnswers): Promise<boolean> {
    if (user) return true;
    const email = fromAnswers.email.trim();
    if (!email) {
      setError('Finish homepage profile chat first — we need your email for a private link.');
      return false;
    }
    const issued = await api.emailCode(email, 'sign_in');
    if (!issued.debug_code) {
      setPendingEmail(email);
      setError('Enter the 6-digit code sent to your email, then continue.');
      return false;
    }
    const verified = await api.verifyEmailCode(email, issued.debug_code, 'sign_in');
    await setSession(verified.session_id);
    await refresh();
    return true;
  }

  async function persistAndInterest(fromAnswers: RenterAnswers) {
    if (!intakeFieldsReady(fromAnswers)) {
      throw new ApiError(
        400,
        'intake_incomplete',
        'Add your current address and employment before submitting. Empty fields are not filled in for you.',
      );
    }
    await api.upsertRenterProfile(answersToProfilePayload(fromAnswers));
    await api.upsertRenterIntake(answersToIntakePayload(fromAnswers, true));
    setComplete(true);
    if (editOnly) {
      navigate('/applications');
      return;
    }
    const result = await api.expressInterest(listingId);
    rememberAccessToken(result.application_id, result.access_token);
    setSubmittedId(result.application_id);
    track('application_submitted', { product: 'dwel', flow: 'apply' });
  }

  async function submitAndInterest(fromAnswers: RenterAnswers = answers) {
    setBusy(true);
    setError(null);
    persist(fromAnswers);
    try {
      if (!user) {
        const ok = await ensureSession(fromAnswers);
        if (!ok) return;
      }
      setHopping(true);
      await persistAndInterest(fromAnswers);
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === 'ny_report_required' || err.code === 'ny_report_expired')
      ) {
        navigate('/screening-choice');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not submit application.');
    } finally {
      setBusy(false);
      setHopping(false);
    }
  }

  if (!authLoading && !loadingIntake && bootAnswers && !profileComplete(bootAnswers) && !editOnly) {
    return <Navigate to="/discover" replace />;
  }

  if (submittedId) {
    return (
      <Shell>
        <p className="section-eyebrow">Submitted</p>
        <h1 className="section-title">Interest sent</h1>
        <p className="muted">Your application dossier was frozen for this listing review.</p>
        <div className="row-between" style={{ marginTop: '1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link className="btn btn-primary" to={`/applications/${submittedId}/details`}>
            View my application
          </Link>
          <Link className="btn btn-secondary" to="/applications">
            Pipeline tracker
          </Link>
        </div>
      </Shell>
    );
  }

  if (showSubmitFrog) {
    return (
      <Shell>
        <FrogPageLoader />
      </Shell>
    );
  }

  if (accountLoad === 'failed') {
    return (
      <Shell>
        <ErrorState title="Account not loaded">
          {error ?? 'Your account could not be loaded.'} This page will not use a browser draft as
          your saved application.
        </ErrorState>
      </Shell>
    );
  }

  if (loadingIntake || !bootAnswers) {
    return (
      <Shell>
        {showIntakeInline ? <InlineSpinner label="Loading your application guide…" /> : null}
      </Shell>
    );
  }

  return (
    <Shell>
      <Link to={`/listings/${listingId}`} style={{ fontWeight: 700 }}>
        ← Back to listing
      </Link>
      <div style={{ marginTop: '1rem' }}>
        <p className="section-eyebrow">Listing application</p>
        <h1 className="section-title">
          {editOnly ? 'Edit application details' : complete ? 'Ready to apply' : 'A few more details'}
        </h1>
        <p className="muted" style={{ maxWidth: '40rem' }}>
          Confirm with your saved profile, then send interest. Screening happens next if the landlord
          advances your application.
        </p>
      </div>

      {error && <ErrorState title="Application error">{error}</ErrorState>}
      {pendingEmail && (
        <form
          className="panel form-grid"
          style={{ marginTop: '1rem', maxWidth: '28rem' }}
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                const verified = await api.verifyEmailCode(pendingEmail, code, 'sign_in');
                await setSession(verified.session_id);
                await refresh();
                setPendingEmail(null);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'That code did not work.');
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <label>
            6-digit code
            <input
              type="text"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(ev) => setCode(ev.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Checking…' : 'Verify and continue'}
          </button>
        </form>
      )}

      {intakeFieldsReady(answers) && complete && !editOnly ? (
        <div className="panel stack" style={{ marginTop: '1.25rem', maxWidth: '40rem' }}>
          <p>
            Profile: {answers.given_name} {answers.family_name} · {answers.email}
          </p>
          <p>
            Address:{' '}
            {[
              answers.current_address_line1,
              answers.current_address_city,
              answers.current_address_state,
              answers.current_address_postal,
            ]
              .filter(Boolean)
              .join(', ')}
          </p>
          <p>
            Employer: {answers.employer_name} · {answers.job_title}
            {answers.monthly_gross_income_dollars
              ? ` · income ${moneyFromCents(Math.round(Number(answers.monthly_gross_income_dollars) * 100))}/mo`
              : ''}
          </p>
          <div className="row-between" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
            <Link className="btn btn-secondary" to="/discover">
              Edit profile
            </Link>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => setComplete(false)}
            >
              Edit address and employment
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void submitAndInterest()}
            >
              {busy ? 'Submitting…' : "I'm interested — submit"}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="panel form-grid"
          style={{ marginTop: '1.25rem', maxWidth: '40rem' }}
          onSubmit={(e) => {
            e.preventDefault();
            void submitAndInterest();
          }}
        >
          <p>
            Current address and employment are saved on your account. They are copied into an
            application only when you submit, and later profile edits do not rewrite that copy.
          </p>
          {!intakeFieldsReady(answers) && <p>Address and employment are still incomplete.</p>}
          <label>
            Street address
            <input
              required
              value={answers.current_address_line1}
              onChange={(e) => persist({ ...answers, current_address_line1: e.target.value })}
            />
          </label>
          <label>
            City
            <input
              required
              value={answers.current_address_city}
              onChange={(e) => persist({ ...answers, current_address_city: e.target.value })}
            />
          </label>
          <label>
            State
            <input
              required
              maxLength={2}
              value={answers.current_address_state}
              onChange={(e) =>
                persist({ ...answers, current_address_state: e.target.value.toUpperCase() })
              }
            />
          </label>
          <label>
            Postal code
            <input
              required
              value={answers.current_address_postal}
              onChange={(e) => persist({ ...answers, current_address_postal: e.target.value })}
            />
          </label>
          <label>
            Employer
            <input
              required
              value={answers.employer_name}
              onChange={(e) => persist({ ...answers, employer_name: e.target.value })}
            />
          </label>
          <label>
            Job title
            <input
              required
              value={answers.job_title}
              onChange={(e) => persist({ ...answers, job_title: e.target.value })}
            />
          </label>
          <label>
            Employer phone
            <input
              value={answers.employer_phone}
              onChange={(e) => persist({ ...answers, employer_phone: e.target.value })}
            />
          </label>
          <label>
            Months at this job
            <input
              inputMode="numeric"
              value={answers.employment_length_months}
              onChange={(e) => persist({ ...answers, employment_length_months: e.target.value })}
            />
          </label>
          <label>
            Monthly income, if you want to include it
            <input
              inputMode="decimal"
              value={answers.monthly_gross_income_dollars}
              onChange={(e) => persist({ ...answers, monthly_gross_income_dollars: e.target.value })}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : editOnly ? 'Save account dossier' : 'Save and submit interest'}
          </button>
        </form>
      )}
    </Shell>
  );
}
