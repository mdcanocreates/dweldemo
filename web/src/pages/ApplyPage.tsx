import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, type RenterProfile } from '../api';
import { rememberAccessToken } from '../accessToken';
import { useAuth } from '../auth';
import { FrogPageLoader, InlineSpinner } from '../components/FrogPageLoader';
import { GuidedChat } from '../components/GuidedChat';
import { ErrorState, Shell } from '../components/Shell';
import { moneyFromCents } from '../format';
import { useDelayedPending } from '../hooks/useDelayedPending';
import {
  answersToIntakePayload,
  answersToProfilePayload,
  loadAnswers,
  profileComplete,
  saveAnswers,
  type Occupant,
  type Pet,
  type RenterAnswers,
} from '../intake/answers';

function mergeServerIntoAnswers(
  local: RenterAnswers,
  intake: Record<string, unknown> | null,
  profile: RenterProfile | null,
): RenterAnswers {
  const next: RenterAnswers = { ...local };
  if (profile) {
    next.given_name = profile.given_name || next.given_name;
    next.family_name = profile.family_name || next.family_name;
    next.phone = profile.phone_e164 || next.phone;
    next.email = profile.email || next.email;
    if (profile.annual_income_cents) {
      next.annual_income_dollars = String(Math.round(profile.annual_income_cents / 100));
      if (!next.monthly_gross_income_dollars) {
        next.monthly_gross_income_dollars = String(Math.round(profile.annual_income_cents / 12 / 100));
      }
    }
    next.move_in_urgency = profile.move_in_urgency || next.move_in_urgency;
    next.bedrooms_min = String(profile.bedrooms_min ?? next.bedrooms_min);
    if (profile.rent_max_cents) {
      next.rent_max_dollars = String(Math.round(profile.rent_max_cents / 100));
    }
    next.preferred_state = profile.preferred_state || next.preferred_state;
    if (profile.has_pets != null) next.has_pets = profile.has_pets;
    next.household_size = String(profile.household_size ?? next.household_size);
    next.profile_complete = true;
  }
  if (!intake) return next;
  next.current_address_line1 = String(intake.current_address_line1 ?? next.current_address_line1);
  next.current_address_city = String(intake.current_address_city ?? next.current_address_city);
  next.current_address_state = String(
    intake.current_address_state ?? profile?.preferred_state ?? next.current_address_state,
  );
  next.current_address_postal = String(intake.current_address_postal ?? next.current_address_postal);
  next.current_address_move_in = intake.current_address_move_in
    ? String(intake.current_address_move_in).slice(0, 10)
    : next.current_address_move_in;
  next.employer_name = String(intake.employer_name ?? next.employer_name);
  next.job_title = String(intake.job_title ?? next.job_title);
  next.employer_phone = String(intake.employer_phone ?? next.employer_phone);
  if (intake.employment_length_months != null) {
    next.employment_length_months = String(intake.employment_length_months);
  }
  if (intake.monthly_gross_income_cents != null) {
    next.monthly_gross_income_dollars = String(Number(intake.monthly_gross_income_cents) / 100);
  }
  const occ = Array.isArray(intake.occupants) ? (intake.occupants as Occupant[]) : [];
  if (occ.length) next.occupants = occ;
  const petRows = Array.isArray(intake.pets) ? (intake.pets as Pet[]) : [];
  if (petRows.length) next.pets = petRows;
  const ec = (intake.emergency_contact ?? null) as Record<string, string> | null;
  if (ec) {
    next.emergency_name = ec.name ?? next.emergency_name;
    next.emergency_relationship = ec.relationship ?? next.emergency_relationship;
    next.emergency_phone = ec.phone ?? next.emergency_phone;
  }
  const veh = (intake.vehicle ?? null) as Record<string, string> | null;
  if (veh) {
    next.vehicle_make = veh.make ?? next.vehicle_make;
    next.vehicle_model = veh.model ?? next.vehicle_model;
    next.vehicle_plate = veh.plate ?? next.vehicle_plate;
  }
  return next;
}

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
  const [chatKey, setChatKey] = useState(0);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const showSubmitFrog = useDelayedPending(hopping, 400);
  const showIntakeInline = useDelayedPending(loadingIntake && !hopping, 400);

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
          }
          return;
        }
        const data = await api.getRenterIntake();
        if (cancelled) return;
        const merged = mergeServerIntoAnswers(
          local,
          (data.intake as Record<string, unknown>) ?? null,
          data.profile,
        );
        saveAnswers(merged);
        setBootAnswers(merged);
        setAnswers(merged);
        setComplete(data.complete);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load intake.');
          setBootAnswers(local);
          setAnswers(local);
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

      {complete && !editOnly ? (
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
              .join(', ') || '—'}
          </p>
          <p>
            Employer: {answers.employer_name || '—'} · {answers.job_title || '—'} · income{' '}
            {answers.monthly_gross_income_dollars
              ? moneyFromCents(Math.round(Number(answers.monthly_gross_income_dollars) * 100))
              : '—'}
            /mo
          </p>
          <div className="row-between" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setComplete(false);
                setChatKey((k) => k + 1);
              }}
            >
              Edit via chat
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
        <div style={{ marginTop: '1.25rem', maxWidth: '40rem' }}>
          <GuidedChat
            key={chatKey}
            mode="application"
            initialAnswers={bootAnswers}
            busy={busy}
            onAnswersChange={persist}
            onComplete={(a) => void submitAndInterest(a)}
          />
        </div>
      )}
    </Shell>
  );
}
